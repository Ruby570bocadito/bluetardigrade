// collector.rs: Windows-only ETW consumption with ferrisetw.
// Opens a real-time kernel trace with the process provider and streams
// each Process/Start (opcode 1) to the engine as NDJSON. The kernel
// event is the one that carries the command line and the parent PID:
// the Microsoft-Windows-Kernel-Process manifest provider used before
// has neither (its ProcessStart has ImageName and ParentProcessID, no
// CommandLine), so the 46 rule conditions on process.command_line could
// never match this sensor's events. On Windows 8+ the trace runs as a
// named system-logger session, so it does not take the single "NT
// Kernel Logger" slot. Field decoding lives in procinfo.rs.

#![cfg(target_os = "windows")]

use crate::normalize::{self, EventJson, ProcessJson, TYPE_PROCESS_CREATE};
use crate::procinfo;
use crate::queue::{Pipeline, Spool};
use crate::transport::Sender;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use ferrisetw::parser::Parser;
use ferrisetw::provider::{kernel_providers, Provider};
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::{KernelTrace, TraceTrait};
use ferrisetw::EventRecord;

/// Opcode of the kernel Process/Start event (2 = End, 3/4 = the
/// rundown of processes already running when the session starts).
const OPCODE_PROCESS_START: u8 = 1;

/// Name of the kernel session (Windows 8+; older systems force "NT
/// Kernel Logger").
const SESSION_NAME: &str = "bluetardigrade-sensor";

/// Delivery settings: the bounded queue between the ETW thread and the
/// network, and the optional on-disk spool behind it (see queue.rs).
pub struct Delivery {
    pub queue_cap: usize,
    pub spool: Option<PathBuf>,
    pub spool_max_bytes: u64,
}

/// Runs the blocking ETW event loop. It returns only on fatal errors.
/// token (when set) is the shared ingest token sent on every
/// (re)connection to the engine. tls_ca (when set) upgrades every
/// (re)connection to TLS with the engine's certificate verified
/// against that CA bundle (no skip-verification mode).
pub fn run(addr: &str, token: Option<&str>, tls_ca: Option<&Path>, delivery: Delivery) -> Result<()> {
    // The first connection is still made up front: a wrong address,
    // token or CA must fail loudly at startup, not inside the queue.
    let sender = Sender::connect(addr, token, tls_ca)?;
    let spool = match delivery.spool {
        Some(path) => Some(
            Spool::new(path.clone(), delivery.spool_max_bytes)
                .with_context(|| format!("opening spool {}", path.display()))?,
        ),
        None => None,
    };
    // Delivery runs on its own thread: the ETW callback only pushes,
    // so an unreachable engine can no longer stall the trace consumer
    // (which made Windows drop events from the real-time buffers).
    let (pipeline, _delivery_thread) =
        Pipeline::start(delivery.queue_cap, spool, move |line: &str| sender.send_line(line));
    let pipeline = Arc::new(pipeline);
    let capture = Arc::clone(&pipeline);
    let host = hostname();

    // The provider is rebuilt for each start attempt (a stale session
    // from a previous run is stopped and the start retried once).
    let make_provider = || {
        let capture = Arc::clone(&capture);
        let host = host.clone();
        Provider::kernel(&kernel_providers::PROCESS_PROVIDER)
            .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| {
                handle_record(record, schema_locator, &host, &capture)
            })
            .build()
    };

    // ferrisetw's TraceError implements neither Display nor
    // std::error::Error, so anyhow's `?` cannot lift it: map errors
    // explicitly through their Debug form.
    let start = || {
        KernelTrace::new()
            .named(String::from(SESSION_NAME))
            .enable(make_provider())
            .start()
    };
    let started = match start() {
        // A kernel session outlives the process that created it: a
        // previous sensor that was killed (or crashed) leaves the name
        // taken. Stop that orphan and try once more.
        Err(e) if format!("{e:?}").contains("AlreadyExist") => {
            eprintln!("[SENSOR] stopping the ETW session left behind by a previous run ({SESSION_NAME})");
            if let Err(stop_err) = ferrisetw::trace::stop_trace_by_name(SESSION_NAME) {
                eprintln!(
                    "[SENSOR] could not stop it ({stop_err:?}): run the sensor elevated, or stop it with 'logman stop {SESSION_NAME} -ets'"
                );
            }
            start()
        }
        other => other,
    };
    let (trace, handle) = started.map_err(|e| {
        let detail = format!("{e:?}");
        if detail.contains("-2147024891") {
            // E_ACCESSDENIED: kernel sessions need elevation
            anyhow::anyhow!("starting ETW trace: access denied - run the sensor from an elevated (Administrator) prompt ({detail})")
        } else {
            anyhow::anyhow!("starting ETW trace: {detail}")
        }
    })?;
    // Ctrl+C / closing the console stops the session instead of leaving
    // it running in the kernel after the process is gone.
    install_console_handler();

    eprintln!("[SENSOR] ETW session active - streaming kernel process start events");
    // The session must stay alive while events are processed; dropping
    // `trace` stops it. process_from_handle blocks on the current
    // thread until the trace is stopped or ProcessTrace fails.
    let _session = trace;
    let result = KernelTrace::process_from_handle(handle)
        .map_err(|e| anyhow::anyhow!("ETW processing ended: {e:?}"));
    let stats = pipeline.stats();
    eprintln!(
        "[SENSOR] ETW session ended: {} events spooled, {} dropped",
        stats.spooled, stats.dropped
    );
    result.map(|_| ())
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".into())
}

/// Decodes one kernel process event and hands it to the delivery queue.
fn handle_record(record: &EventRecord, schema_locator: &SchemaLocator, host: &str, capture: &Pipeline) {
    if record.opcode() != OPCODE_PROCESS_START {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    // ProcessID is the one field every useful event must carry;
    // the rest degrade gracefully (ppid 0 is skipped on
    // serialization, missing CommandLine serializes as absent).
    let Ok(pid) = parser.try_parse::<u32>("ProcessId") else {
        return;
    };
    let ppid = parser.try_parse::<u32>("ParentId").unwrap_or(0);
    let short_name = parser
        .try_parse::<String>("ImageFileName")
        .unwrap_or_default();
    let command_line = parser
        .try_parse::<String>("CommandLine")
        .ok()
        .filter(|c| !c.is_empty());
    let name = procinfo::process_name(&short_name, command_line.as_deref().unwrap_or(""));
    // owner of the NEW process (the kernel's WBEM SID), not the
    // account that runs the sensor
    let user = parser
        .try_parse::<Vec<u8>>("UserSID")
        .ok()
        .and_then(|b| procinfo::sid_from_wbem(&b));

    let event = EventJson {
        id: normalize::new_uuid(),
        // Forensics-grade ordering: the ETW record's own time,
        // not the processing clock (kernel buffering can delay
        // delivery by seconds). Decoded from the raw FILETIME:
        // ferrisetw 1.2.0's timestamp() drops the low dword.
        timestamp: procinfo::filetime_to_rfc3339(record.raw_timestamp())
            .unwrap_or_else(normalize::now_rfc3339),
        r#type: TYPE_PROCESS_CREATE.into(),
        source: "etw".into(),
        host: host.to_string(),
        user,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: ppid as i32,
            name,
            command_line,
            // the kernel event has no full image path; argv[0]
            // is caller-controlled, so it is not reported as one
            image: None,
            hashes: None, // phase 1: compute sha256 on image write
        }),
        network: None,
        tags: vec!["sensor:etw".into()],
    };
    match serde_json::to_string(&event) {
        Ok(line) => capture.push(line),
        Err(err) => eprintln!("[SENSOR] serialize failed: {err}"),
    }
}

/// Stops the kernel session on Ctrl+C, Ctrl+Break or console close, so
/// ProcessTrace returns and the sensor exits through its normal path
/// (session ended, counters reported) without leaving the session
/// running in the kernel.
fn install_console_handler() {
    unsafe extern "system" fn on_console_event(_ctrl_type: u32) -> windows_sys::core::BOOL {
        let _ = ferrisetw::trace::stop_trace_by_name(SESSION_NAME);
        1 // handled: the main thread finishes once ProcessTrace returns
    }
    // SAFETY: registers a plain function with the documented signature;
    // the handler only calls ControlTrace through ferrisetw.
    let ok = unsafe { windows_sys::Win32::System::Console::SetConsoleCtrlHandler(Some(on_console_event), 1) };
    if ok == 0 {
        eprintln!("[SENSOR] warning: could not install the Ctrl+C handler; stop the session with 'logman stop {SESSION_NAME} -ets' after exiting");
    }
}
