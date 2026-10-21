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

/// Sends a sensor.heartbeat now and every heartbeat::INTERVAL_SECS until
/// `stop` is set. Heartbeats travel the same queue and spool as events.
/// Each beat also asks the named ETW sessions what they lost (EventsLost,
/// RealTimeBuffersLost; PLAN-DETALLADO §2.5) and carries it with the
/// image-hash thread's denials.
pub(super) fn start_heartbeat(ctx: Arc<Shared>, capture: String, run_mode: &'static str, queue_cap: usize, sessions: Vec<String>, stop: Arc<AtomicBool>) -> Option<JoinHandle<()>> {
    let os = os_label();
    let started = Instant::now();
    let mut warned: HashSet<String> = HashSet::new();
    std::thread::Builder::new()
        .name("heartbeat".into())
        .spawn(move || loop {
            let stats = ctx.pipeline.stats();
            let (etw_events_lost, etw_buffers_lost) = etw_lost_counts(&sessions, &mut warned);
            // the YARA worker's counters (zeros and no bundle sha while
            // scanning is off — YaraStats::get is the only reader)
            let (yara_rules, yara_scans, yara_matches, yara_errors, yara_dropped, yara_rules_sha) = ctx
                .yara_stats
                .as_ref()
                .map(|s| s.get())
                .unwrap_or((0, 0, 0, 0, 0, String::new()));
            let health = Health {
                kind: "etw",
                version: env!("CARGO_PKG_VERSION"),
                os: os.clone(),
                capture: capture.clone(),
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
