// collector.rs: Windows-only ETW consumption with ferrisetw.
// Opens a real-time session over the Microsoft-Windows-Kernel-Process
// provider, maps each record to the unified schema and streams it to
// the engine. Additional providers (Kernel-File, Kernel-Network,
// Sysmon) plug into the same pattern in phase 1.

#![cfg(target_os = "windows")]

use crate::normalize::{self, EventJson, ProcessJson, TYPE_PROCESS_CREATE};
use crate::transport::Sender;
use anyhow::Result;
use std::sync::Arc;

use ferrisetw::event::process_start_event::ProcessStartEvent;
use ferrisetw::parser::Parser;
use ferrisetw::provider::Provider;
use ferrisetw::query::{BuildEventStream, EventStream};

/// Runs the blocking ETW event loop. It returns only on fatal errors.
/// token (when set) is the shared ingest token sent on every
/// (re)connection to the engine.
pub fn run(addr: &str, token: Option<&str>) -> Result<()> {
    let sender = Arc::new(Sender::connect(addr, token)?);
    let host = hostname();
    let user = current_user();

    let kernel_process = Provider::kernel_process();
    let stream = EventStream::build()
        .set_name("security-framework-sensor")
        .set_timeout(2)
        .watch(&kernel_process)
        .add_callback(move |record| {
            let start = ProcessStartEvent::from_record(record);
            let Ok(ev) = start else { return };
            let event = EventJson {
                id: normalize::new_uuid(),
                timestamp: normalize::now_rfc3339(),
                r#type: TYPE_PROCESS_CREATE.into(),
                source: "etw".into(),
                host: host.clone(),
                user: user.clone(),
                process: Some(ProcessJson {
                    pid: ev.process_id() as i32,
                    ppid: ev.parent_id() as i32,
                    name: ev.process_name().to_string_lossy().into_owned(),
                    command_line: Some(ev.command_line().to_string_lossy().into_owned()),
                    image: Some(ev.image_name().to_string_lossy().into_owned()),
                    hashes: None, // phase 1: compute sha256 on image write
                }),
                network: None,
                tags: vec!["sensor:etw".into()],
            };
            match serde_json::to_string(&event) {
                Ok(line) => {
                    if let Err(err) = sender.send_line(&line) {
                        eprintln!("[SENSOR] send failed: {err:#}");
                    }
                }
                Err(err) => eprintln!("[SENSOR] serialize failed: {err}"),
            }
        })
        .build()?;

    eprintln!("[SENSOR] ETW session active - streaming kernel process events");
    stream.process(); // blocks forever
    Ok(())
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".into())
}

fn current_user() -> Option<String> {
    std::env::var("USERNAME")
        .ok()
        .map(|u| format!("{}\\{}", std::env::var("USERDOMAIN").unwrap_or_default(), u))
}
