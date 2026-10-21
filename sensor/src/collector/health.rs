// The sensor's health report: a sensor.heartbeat event every minute
// that carries the capture set, the queue state and the platform
// version, so the engine's machine inventory can tell a stalled sensor
// from a quiet one.

use crate::heartbeat::{self, Health};
use crate::normalize::{self, EventJson};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::shared::Shared;

/// Sends a sensor.heartbeat now and every heartbeat::INTERVAL_SECS until
/// `stop` is set. Heartbeats travel the same queue and spool as events.
pub(super) fn start_heartbeat(ctx: Arc<Shared>, capture: String, run_mode: &'static str, queue_cap: usize, stop: Arc<AtomicBool>) -> Option<JoinHandle<()>> {
    let os = os_label();
    let started = Instant::now();
    std::thread::Builder::new()
        .name("heartbeat".into())
        .spawn(move || loop {
            let stats = ctx.pipeline.stats();
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
