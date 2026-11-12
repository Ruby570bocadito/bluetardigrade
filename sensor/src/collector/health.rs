// The sensor's health report: a sensor.heartbeat event every minute
// that carries the capture set, the queue state and the platform
// version, so the engine's machine inventory can tell a stalled sensor
// from a quiet one.

use crate::heartbeat::{self, Health};
use crate::normalize::{self, EventJson};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::shared::Shared;

/// What the sensor captures at this moment, asked again for every beat:
/// a stream fed by a session that ended (see sessions.rs) leaves the
/// capture label until the session is running again, so the inventory
/// never shows network+dns+registry for a host that lost them.
#[derive(Default)]
pub(super) struct CaptureState {
    /// (label, the liveness of the session that feeds it; None: not
    /// tied to a restartable session)
    streams: Vec<(&'static str, Option<Arc<AtomicBool>>)>,
    /// the ETW sessions whose loss counters each beat reports
    sessions: Vec<(String, Option<Arc<AtomicBool>>)>,
}

impl CaptureState {
    pub(super) fn stream(&mut self, label: &'static str, alive: Option<Arc<AtomicBool>>) {
        self.streams.push((label, alive));
    }

    pub(super) fn session(&mut self, name: &str, alive: Option<Arc<AtomicBool>>) {
        self.sessions.push((name.to_string(), alive));
    }

    fn up(alive: &Option<Arc<AtomicBool>>) -> bool {
        alive.as_ref().is_none_or(|flag| flag.load(Ordering::Acquire))
    }

    pub(super) fn label(&self) -> String {
        self.streams.iter().filter(|(_, alive)| Self::up(alive)).map(|(label, _)| *label).collect::<Vec<_>>().join("+")
    }

    fn live_sessions(&self) -> Vec<String> {
        self.sessions.iter().filter(|(_, alive)| Self::up(alive)).map(|(name, _)| name.clone()).collect()
    }
}

/// Sends a sensor.heartbeat now and every heartbeat::INTERVAL_SECS until
/// `stop` is set. Heartbeats travel the same queue and spool as events.
/// Each beat also asks the named ETW sessions what they lost (EventsLost,
/// RealTimeBuffersLost; PLAN-DETALLADO §2.5) and carries it with the
/// image-hash thread's denials.
pub(super) fn start_heartbeat(ctx: Arc<Shared>, capture: CaptureState, run_mode: &'static str, queue_cap: usize, stop: Arc<AtomicBool>) -> Option<JoinHandle<()>> {
    let os = os_label();
    let started = Instant::now();
    let mut warned: HashSet<String> = HashSet::new();
    std::thread::Builder::new()
        .name("heartbeat".into())
        .spawn(move || loop {
            let stats = ctx.pipeline.stats();
            let (etw_events_lost, etw_buffers_lost) = etw_lost_counts(&capture.live_sessions(), &mut warned);
            // the YARA worker's counters (zeros and no bundle sha while
            // scanning is off — YaraStats::get is the only reader);
            // get_mem is the memory scanner's shadow (all zeros while
            // --yara-mem is off)
            let (yara_rules, yara_scans, yara_matches, yara_errors, yara_dropped, yara_rules_sha) = ctx
                .yara_stats
                .as_ref()
                .map(|s| s.get())
                .unwrap_or((0, 0, 0, 0, 0, String::new()));
            let (yara_mem_sweeps, yara_mem_scans, yara_mem_matches, yara_mem_skipped) =
                ctx.yara_stats.as_ref().map(|s| s.get_mem()).unwrap_or((0, 0, 0, 0));
            let health = Health {
                kind: "etw",
                version: env!("CARGO_PKG_VERSION"),
                os: os.clone(),
                capture: capture.label(),
                interval_s: heartbeat::INTERVAL_SECS,
                uptime_s: started.elapsed().as_secs(),
                queue_cap,
                spooled: stats.spooled,
                dropped: stats.dropped,
                etw_events_lost,
                etw_buffers_lost,
                hash_dropped: ctx.hash_dropped.load(Ordering::Relaxed),
                yara_rules,
                yara_rules_sha,
                yara_scans,
                yara_matches,
                yara_dropped,
                yara_errors,
                yara_mem_sweeps,
                yara_mem_scans,
                yara_mem_matches,
                yara_mem_skipped,
                run_mode,
            };
            ctx.emit(&EventJson {
                id: normalize::new_uuid(),
                timestamp: normalize::now_rfc3339(),
                r#type: heartbeat::TYPE_HEARTBEAT.into(),
                source: "etw".into(),
                host: ctx.host.clone(),
                user: None,
                process: None,
                network: None,
                registry: None,
                file: None,
                attributes: Some(heartbeat::attributes(&health)),
                tags: vec!["sensor:etw".into()],
            });
            // sleep in one-second steps so shutdown stays prompt
            for _ in 0..heartbeat::INTERVAL_SECS {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        })
        .ok()
}

/// Events and real-time buffers ETW lost, summed over the named capture
/// sessions (PLAN-DETALLADO §2.5). A session that cannot answer (it was
/// stopped a moment ago, or the query failed) contributes zero the same
/// way a just-restarted session does: the counters are cumulative per
/// session instance, so a recovery resets them to a lower number.
fn etw_lost_counts(sessions: &[String], warned: &mut HashSet<String>) -> (u64, u64) {
    let mut events = 0u64;
    let mut buffers = 0u64;
    for name in sessions {
        match session_lost_counts(name) {
            Some((lost, buffers_lost)) => {
                events += lost;
                buffers += buffers_lost;
            }
            None => {
                // the query failing on our own live session is
                // pathological: say it once per session, never spam
                if warned.insert(name.clone()) {
                    eprintln!("[SENSOR] warning: ETW session {name} did not report its loss counters");
                }
            }
        }
    }
    (events, buffers)
}

/// EventsLost and RealTimeBuffersLost of one named session, via the
/// session query (ControlTraceW, EVENT_TRACE_CONTROL_QUERY). The session
/// is real-time (no log file), so LogBuffersLost does not apply.
fn session_lost_counts(name: &str) -> Option<(u64, u64)> {
    use windows_sys::Win32::System::Diagnostics::Etw::{
        ControlTraceW, CONTROLTRACE_HANDLE, EVENT_TRACE_CONTROL_QUERY, EVENT_TRACE_PROPERTIES, WNODE_FLAG_TRACED_GUID,
    };
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    // the query writes the session name and the log file name behind the
    // struct: a quarter KiB for each, far above any name this sensor uses
    const NAME_ROOM: usize = 256;
    let struct_size = std::mem::size_of::<EVENT_TRACE_PROPERTIES>();
    // u64 words keep the 8-byte alignment the struct's GUIDs need
    let mut buf = vec![0u64; (struct_size + 2 * NAME_ROOM).div_ceil(8)];
    let total = (buf.len() * std::mem::size_of::<u64>()) as u32;
    let props = buf.as_mut_ptr().cast::<EVENT_TRACE_PROPERTIES>();
    // SAFETY: props points at the zeroed, correctly aligned front of buf;
    // the offsets below leave room inside buf for both names, and
    // ControlTraceW writes only within Wnode.BufferSize bytes of it.
    let err = unsafe {
        (*props).Wnode.BufferSize = total;
        (*props).Wnode.Flags = WNODE_FLAG_TRACED_GUID;
        (*props).LoggerNameOffset = struct_size as u32;
        (*props).LogFileNameOffset = (struct_size + NAME_ROOM) as u32;
        ControlTraceW(CONTROLTRACE_HANDLE::default(), wide.as_ptr(), props, EVENT_TRACE_CONTROL_QUERY)
    };
    if err != 0 {
        return None;
    }
    // SAFETY: props is still the front of buf and the call succeeded.
    unsafe { Some(((*props).EventsLost as u64, (*props).RealTimeBuffersLost as u64)) }
}

/// Windows version from HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion.
fn os_label() -> String {
    heartbeat::os_label(
        read_current_version("ProductName").as_deref(),
        read_current_version("DisplayVersion").as_deref(),
        read_current_version("CurrentBuildNumber").as_deref(),
    )
}

fn read_current_version(value: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0".encode_utf16().collect();
    let name: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let mut buf = [0u16; 256];
    let mut len: u32 = (buf.len() * 2) as u32;
    // SAFETY: both names are NUL-terminated UTF-16; buf is writable for
    // `len` bytes and RegGetValueW writes at most that much.
    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut len,
        )
    };
    if rc != 0 {
        return None;
    }
    let chars = ((len as usize) / 2).min(buf.len());
    let text = String::from_utf16_lossy(&buf[..chars]);
    Some(text.trim_end_matches('\0').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_capture_label_follows_the_sessions_that_are_alive() {
        let netreg = Arc::new(AtomicBool::new(true));
        let file = Arc::new(AtomicBool::new(true));
        let mut state = CaptureState::default();
        state.stream("process", None);
        state.stream("sha256", None);
        state.stream("network", Some(Arc::clone(&netreg)));
        state.stream("dns", Some(Arc::clone(&netreg)));
        state.stream("registry", Some(Arc::clone(&netreg)));
        state.stream("yara", Some(Arc::clone(&file)));
        state.session("kernel", None);
        state.session("netreg", Some(Arc::clone(&netreg)));
        state.session("file", Some(Arc::clone(&file)));
        assert_eq!(state.label(), "process+sha256+network+dns+registry+yara");
        assert_eq!(state.live_sessions(), ["kernel", "netreg", "file"]);
        // the network/registry session dies: its streams are not announced
        netreg.store(false, Ordering::Release);
        assert_eq!(state.label(), "process+sha256+yara");
        assert_eq!(state.live_sessions(), ["kernel", "file"]);
        // ...and come back with it
        netreg.store(true, Ordering::Release);
        file.store(false, Ordering::Release);
        assert_eq!(state.label(), "process+sha256+network+dns+registry");
        assert_eq!(state.live_sessions(), ["kernel", "netreg"]);
    }
}
