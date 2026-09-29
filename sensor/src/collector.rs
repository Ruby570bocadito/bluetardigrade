// collector.rs: Windows-only ETW consumption with ferrisetw.
// Opens a real-time user trace over the Microsoft-Windows-Kernel-Process
// manifest provider and streams each ProcessStart (event id 1) to the
// engine as NDJSON. The manifest provider is chosen over the kernel
// logger's process events because its start event carries the command
// line, which the kernel DSTART events do not. Additional providers
// (Kernel-File, Kernel-Network, Sysmon) plug into the same pattern in
// phase 1.

#![cfg(target_os = "windows")]

use crate::normalize::{self, EventJson, ProcessJson, TYPE_PROCESS_CREATE};
use crate::transport::Sender;
use anyhow::Result;
use std::sync::Arc;

use ferrisetw::parser::Parser;
use ferrisetw::provider::Provider;
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::{TraceTrait, UserTrace};
use ferrisetw::EventRecord;

/// Microsoft-Windows-Kernel-Process manifest provider GUID.
const KERNEL_PROCESS_PROVIDER_GUID: &str = "22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716";

/// Event id 1 of the Kernel-Process provider: ProcessStart.
const EVENT_ID_PROCESS_START: u16 = 1;

/// Runs the blocking ETW event loop. It returns only on fatal errors.
/// token (when set) is the shared ingest token sent on every
/// (re)connection to the engine.
pub fn run(addr: &str, token: Option<&str>) -> Result<()> {
    let sender = Arc::new(Sender::connect(addr, token)?);
    let host = hostname();
    let user = current_user();

    let provider = Provider::by_guid(KERNEL_PROCESS_PROVIDER_GUID)
        .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| {
            if record.event_id() != EVENT_ID_PROCESS_START {
                return;
            }
            let Ok(schema) = schema_locator.event_schema(record) else {
                return;
            };
            let parser = Parser::create(record, &schema);
            // ProcessID is the one field every useful event must carry;
            // the rest degrade gracefully (ppid 0 is skipped on
            // serialization, missing CommandLine serializes as absent).
            let Ok(pid) = parser.try_parse::<u32>("ProcessID") else {
                return;
            };
            let ppid = parser.try_parse::<u32>("ParentID").unwrap_or(0);
            let image = parser
                .try_parse::<String>("ImageName")
                .unwrap_or_default();
            let command_line = parser.try_parse::<String>("CommandLine").ok();

            let name = image
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or(&image)
                .to_string();

            let event = EventJson {
                id: normalize::new_uuid(),
                timestamp: normalize::now_rfc3339(),
                r#type: TYPE_PROCESS_CREATE.into(),
                source: "etw".into(),
                host: host.clone(),
                user: user.clone(),
                process: Some(ProcessJson {
                    pid: pid as i32,
                    ppid: ppid as i32,
                    name,
                    command_line,
                    image: Some(image),
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
        .build();

    // ferrisetw's TraceError implements neither Display nor
    // std::error::Error, so anyhow's `?` cannot lift it: map errors
    // explicitly through their Debug form.
    let (trace, handle) = UserTrace::new()
        .named(String::from("security-framework-sensor"))
        .enable(provider)
        .start()
        .map_err(|e| anyhow::anyhow!("starting ETW trace: {e:?}"))?;

    eprintln!(
        "[SENSOR] ETW session active - streaming Microsoft-Windows-Kernel-Process events"
    );
    // The session must stay alive while events are processed; dropping
    // `trace` stops it. process_from_handle blocks on the current
    // thread until the trace is stopped or ProcessTrace fails.
    let _session = trace;
    UserTrace::process_from_handle(handle)
        .map_err(|e| anyhow::anyhow!("ETW processing ended: {e:?}"))?;
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
