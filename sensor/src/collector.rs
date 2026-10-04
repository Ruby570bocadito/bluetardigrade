// collector.rs: Windows-only ETW consumption with ferrisetw.
//
// Two real-time sessions feed one delivery pipeline:
//
//   - a kernel trace with the process provider. Each Process/Start
//     (opcode 1) becomes a process.create event: the kernel event is the
//     one that carries the command line and the parent PID (the
//     Microsoft-Windows-Kernel-Process manifest provider has neither).
//     Starts, the rundown of processes already running (opcodes 3/4)
//     and ends (opcode 2) also maintain a PID -> name table.
//   - a user trace with Microsoft-Windows-Kernel-Network (TCP connection
//     attempts, IPv4 and IPv6) and Microsoft-Windows-Kernel-Registry
//     (SetValueKey). Both are filtered by event id inside the kernel;
//     registry writes are further limited to the keys detections read
//     (netreg.rs). They only carry a PID, named through the table.
//
// The network/registry session is best effort: if it cannot start, the
// sensor says so and keeps streaming process events. On Windows 8+ both
// run as named sessions, so they do not take the single "NT Kernel
// Logger" slot. Field decoding lives in procinfo.rs and netreg.rs.

#![cfg(target_os = "windows")]

use crate::heartbeat::{self, Health};
use crate::netreg::{self, ProcessTable};
use crate::normalize::{self, EventJson, NetworkJson, ProcessJson, RegistryJson};
use crate::normalize::{TYPE_NETWORK_CONNECT, TYPE_PROCESS_CREATE, TYPE_REGISTRY_SET};
use crate::procinfo;
use crate::queue::{Pipeline, Spool};
use crate::transport::Sender;
use anyhow::{Context, Result};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ferrisetw::parser::Parser;
use ferrisetw::provider::{kernel_providers, EventFilter, Provider};
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::{KernelTrace, TraceTrait, UserTrace};
use ferrisetw::EventRecord;

/// Kernel Process opcodes: 1 Start, 2 End, 3/4 rundown of processes
/// already running when the session starts or stops.
const OPCODE_PROCESS_START: u8 = 1;
const OPCODE_PROCESS_END: u8 = 2;
const OPCODE_PROCESS_DC_START: u8 = 3;
const OPCODE_PROCESS_DC_END: u8 = 4;

/// Session names (Windows 8+; older systems force "NT Kernel Logger").
const SESSION_NAME: &str = "bluetardigrade-sensor";
const NETREG_SESSION_NAME: &str = "bluetardigrade-sensor-netreg";

const KERNEL_NETWORK: &str = "7dd42a49-5329-4832-8dfd-43d979153a88";
/// KERNEL_NETWORK_KEYWORD_IPV4 | KERNEL_NETWORK_KEYWORD_IPV6
const KERNEL_NETWORK_KEYWORDS: u64 = 0x10 | 0x20;
/// TCPv4 / TCPv6 "connection attempted".
const EVENT_TCP4_CONNECT: u16 = 12;
const EVENT_TCP6_CONNECT: u16 = 28;

const KERNEL_REGISTRY: &str = "70eb4f03-c1de-4f73-a051-33d13d5413bd";
const EVENT_REG_SET_VALUE: u16 = 5;

/// Names kept for PID lookups (a busy host runs a few hundred processes;
/// the table only forgets once this is exceeded).
const PROCESS_TABLE_CAP: usize = 8192;

/// Delivery settings: the bounded queue between the ETW threads and the
/// network, and the optional on-disk spool behind it (see queue.rs).
pub struct Delivery {
    pub queue_cap: usize,
    pub spool: Option<PathBuf>,
    pub spool_max_bytes: u64,
}

/// Which telemetry beyond process creation to capture.
pub struct Capture {
    pub network: bool,
    pub registry: bool,
    /// forward every SetValueKey instead of the detection-relevant keys
    pub registry_all: bool,
}

/// Shared state of the ETW callbacks.
struct Shared {
    host: String,
    own_pid: u32,
    pipeline: Arc<Pipeline>,
    processes: Mutex<ProcessTable>,
    registry_all: bool,
}

impl Shared {
    fn process_name(&self, pid: u32) -> String {
        match self.processes.lock() {
            Ok(table) => table.name(pid),
            Err(_) => format!("pid {pid}"),
        }
    }

    fn emit(&self, event: &EventJson) {
        match serde_json::to_string(event) {
            Ok(line) => self.pipeline.push(line),
            Err(err) => eprintln!("[SENSOR] serialize failed: {err}"),
        }
    }
}

/// Runs the blocking ETW event loop. It returns only on fatal errors.
/// token (when set) is the shared ingest token sent on every
/// (re)connection to the engine. tls_ca (when set) upgrades every
/// (re)connection to TLS with the engine's certificate verified
/// against that CA bundle (no skip-verification mode).
pub fn run(addr: &str, token: Option<&str>, tls_ca: Option<&Path>, delivery: Delivery, capture: Capture) -> Result<()> {
    // Configuration errors (CA bundle, TLS verification, rejected token)
    // fail loudly here; an engine that is not listening yet does not:
    // the sensor starts and the queue/spool hold events until it is.
    let sender = Sender::connect(addr, token, tls_ca)?;
    let spool = match delivery.spool {
        Some(path) => Some(
            Spool::new(path.clone(), delivery.spool_max_bytes)
                .with_context(|| format!("opening spool {}", path.display()))?,
        ),
        None => None,
    };
    let queue_cap = delivery.queue_cap;
    // Delivery runs on its own thread: the ETW callbacks only push, so
    // an unreachable engine can no longer stall the trace consumers
    // (which made Windows drop events from the real-time buffers).
    let stopping = Arc::new(AtomicBool::new(false));
    let transport_stop = Arc::clone(&stopping);
    let (pipeline, delivery_thread) = Pipeline::start(
        delivery.queue_cap,
        spool,
        stopping,
        move |line: &str| sender.send_line(line, &transport_stop),
    );
    let pipeline = Arc::new(pipeline);
    let ctx = Arc::new(Shared {
        host: hostname(),
        own_pid: std::process::id(),
        pipeline: Arc::clone(&pipeline),
        processes: Mutex::new(ProcessTable::new(PROCESS_TABLE_CAP)),
        registry_all: capture.registry_all,
    });

    // The provider is rebuilt for each start attempt (a stale session
    // from a previous run is stopped and the start retried once).
    let process_provider = || {
        let ctx = Arc::clone(&ctx);
        Provider::kernel(&kernel_providers::PROCESS_PROVIDER)
            .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_process(record, schema_locator, &ctx))
            .build()
    };
    let (trace, handle) = start_with_recovery(SESSION_NAME, || {
        KernelTrace::new().named(String::from(SESSION_NAME)).enable(process_provider()).start()
    })?;
    // Ctrl+C / closing the console stops the sessions instead of leaving
    // them running in the kernel after the process is gone.
    install_console_handler();

    let netreg = if capture.network || capture.registry {
        start_netreg(&ctx, &capture)
    } else {
        None
    };
    let what = match (&netreg, capture.network, capture.registry) {
        (Some(_), true, true) => "process starts, TCP connections and registry writes",
        (Some(_), true, false) => "process starts and TCP connections",
        (Some(_), false, true) => "process starts and registry writes",
        _ => "process starts",
    };
    eprintln!("[SENSOR] ETW sessions active - streaming {what}");

    // health report for the engine's machine inventory, every minute
    let capture_label = match (&netreg, capture.network, capture.registry) {
        (Some(_), true, true) => "process+network+registry",
        (Some(_), true, false) => "process+network",
        (Some(_), false, true) => "process+registry",
        _ => "process",
    };
    let heartbeat_stop = Arc::new(AtomicBool::new(false));
    let heartbeat_thread = start_heartbeat(Arc::clone(&ctx), capture_label.to_string(), queue_cap, Arc::clone(&heartbeat_stop));

    // The kernel session must stay alive while events are processed;
    // dropping `trace` stops it. process_from_handle blocks on this
    // thread until the trace is stopped or ProcessTrace fails.
    let _session = trace;
    let result = KernelTrace::process_from_handle(handle).map_err(|e| anyhow::anyhow!("ETW processing ended: {e:?}"));
    if let Some((netreg_trace, netreg_thread)) = netreg {
        drop(netreg_trace); // stops the session, ProcessTrace returns
        let _ = netreg_thread.join();
    }
    heartbeat_stop.store(true, Ordering::Relaxed);
    if let Some(thread) = heartbeat_thread {
        let _ = thread.join();
    }
    // hand everything still in memory to the engine or the spool
    pipeline.shutdown(delivery_thread, Duration::from_secs(10));
    let stats = pipeline.stats();
    eprintln!("[SENSOR] ETW session ended: {} events spooled, {} dropped", stats.spooled, stats.dropped);
    result.map(|_| ())
}

/// Starts a named session; a session left behind by a previous run that
/// was killed (kernel sessions outlive their process) is stopped and the
/// start retried once.
fn start_with_recovery<R, E: std::fmt::Debug>(name: &str, start: impl Fn() -> std::result::Result<R, E>) -> Result<R> {
    // ferrisetw's TraceError implements neither Display nor
    // std::error::Error, so anyhow's `?` cannot lift it: map errors
    // explicitly through their Debug form.
    let started = match start() {
        Err(e) if format!("{e:?}").contains("AlreadyExist") => {
            eprintln!("[SENSOR] stopping the ETW session left behind by a previous run ({name})");
            if let Err(stop_err) = ferrisetw::trace::stop_trace_by_name(name) {
                eprintln!("[SENSOR] could not stop it ({stop_err:?}): run the sensor elevated, or stop it with 'logman stop {name} -ets'");
            }
            start()
        }
        other => other,
    };
    started.map_err(|e| {
        let detail = format!("{e:?}");
        if detail.contains("-2147024891") {
            // E_ACCESSDENIED: kernel sessions need elevation
            anyhow::anyhow!("starting ETW trace {name}: access denied - run the sensor from an elevated (Administrator) prompt ({detail})")
        } else {
            anyhow::anyhow!("starting ETW trace {name}: {detail}")
        }
    })
}

/// Starts the network/registry session on its own thread. Best effort:
/// a failure is reported and the sensor continues with process events.
fn start_netreg(ctx: &Arc<Shared>, capture: &Capture) -> Option<(UserTrace, std::thread::JoinHandle<()>)> {
    let build = || {
        let mut builder = UserTrace::new().named(String::from(NETREG_SESSION_NAME));
        if capture.network {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_NETWORK)
                    .any(KERNEL_NETWORK_KEYWORDS)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_TCP4_CONNECT, EVENT_TCP6_CONNECT]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_network(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if capture.registry {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_REGISTRY)
                    // every keyword: the event-id filter below is what
                    // keeps only SetValueKey, inside the kernel
                    .any(u64::MAX)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_REG_SET_VALUE]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_registry(record, schema_locator, &ctx))
                    .build(),
            );
        }
        builder.start()
    };
    match start_with_recovery(NETREG_SESSION_NAME, build) {
        Ok((trace, handle)) => {
            let thread = std::thread::Builder::new()
                .name("etw-netreg".into())
                .spawn(move || {
                    if let Err(e) = UserTrace::process_from_handle(handle) {
                        eprintln!("[SENSOR] network/registry session ended: {e:?}");
                    }
                })
                .ok()?;
            Some((trace, thread))
        }
        Err(err) => {
            eprintln!("[SENSOR] warning: network and registry capture unavailable ({err}); continuing with process events only");
            None
        }
    }
}

/// Sends a sensor.heartbeat now and every heartbeat::INTERVAL_SECS until
/// `stop` is set. Heartbeats travel the same queue and spool as events.
fn start_heartbeat(ctx: Arc<Shared>, capture: String, queue_cap: usize, stop: Arc<AtomicBool>) -> Option<JoinHandle<()>> {
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

fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".into())
}

/// RFC 3339 time of an ETW record (the record's own time, not the
/// processing clock: kernel buffering can delay delivery by seconds).
fn record_time(record: &EventRecord) -> String {
    // decoded from the raw FILETIME: ferrisetw 1.2.0's timestamp()
    // drops the low dword
    procinfo::filetime_to_rfc3339(record.raw_timestamp()).unwrap_or_else(normalize::now_rfc3339)
}

/// Kernel process events: Start becomes a process.create event; Start,
/// End and the rundown keep the PID -> name table current.
fn handle_process(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    let opcode = record.opcode();
    if !matches!(opcode, OPCODE_PROCESS_START | OPCODE_PROCESS_END | OPCODE_PROCESS_DC_START | OPCODE_PROCESS_DC_END) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    // ProcessID is the one field every useful event must carry; the
    // rest degrade gracefully (ppid 0 is skipped on serialization,
    // missing CommandLine serializes as absent).
    let Ok(pid) = parser.try_parse::<u32>("ProcessId") else {
        return;
    };
    if opcode == OPCODE_PROCESS_END {
        if let Ok(mut table) = ctx.processes.lock() {
            table.remove(pid);
        }
        return;
    }
    let short_name = parser.try_parse::<String>("ImageFileName").unwrap_or_default();
    let command_line = parser.try_parse::<String>("CommandLine").ok().filter(|c| !c.is_empty());
    let name = procinfo::process_name(&short_name, command_line.as_deref().unwrap_or(""));
    if let Ok(mut table) = ctx.processes.lock() {
        table.insert(pid, name.clone());
    }
    if opcode != OPCODE_PROCESS_START {
        return; // rundown: names only, these processes did not just start
    }
    let ppid = parser.try_parse::<u32>("ParentId").unwrap_or(0);
    // owner of the NEW process (the kernel's WBEM SID), not the account
    // that runs the sensor
    let user = parser.try_parse::<Vec<u8>>("UserSID").ok().and_then(|b| procinfo::sid_from_wbem(&b));
    ctx.emit(&EventJson {
        id: normalize::new_uuid(),
        timestamp: record_time(record),
        r#type: TYPE_PROCESS_CREATE.into(),
        source: "etw".into(),
        host: ctx.host.clone(),
        user,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: ppid as i32,
            name,
            command_line,
            // the kernel event has no full image path; argv[0] is
            // caller-controlled, so it is not reported as one
            image: None,
            hashes: None, // phase 1: compute sha256 on image write
        }),
        network: None,
        registry: None,
        attributes: None,
        tags: vec!["sensor:etw".into()],
    });
}

/// Kernel-Network TCP connection attempts -> network.connect.
fn handle_network(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    if !matches!(record.event_id(), EVENT_TCP4_CONNECT | EVENT_TCP6_CONNECT) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let Ok(daddr) = parser.try_parse::<IpAddr>("daddr") else {
        return;
    };
    if netreg::is_loopback(&daddr) {
        return;
    }
    // the event's own PID field: the header PID can be System's
    let pid = parser.try_parse::<u32>("PID").unwrap_or_else(|_| record.process_id());
    if pid == ctx.own_pid {
        return;
    }
    let saddr = parser.try_parse::<IpAddr>("saddr").ok();
    let dport = parser.try_parse::<u16>("dport").map(netreg::port_from_wire).unwrap_or(0);
    let sport = parser.try_parse::<u16>("sport").map(netreg::port_from_wire).unwrap_or(0);
    ctx.emit(&EventJson {
        id: normalize::new_uuid(),
        timestamp: record_time(record),
        r#type: TYPE_NETWORK_CONNECT.into(),
        source: "etw".into(),
        host: ctx.host.clone(),
        user: None,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: 0,
            name: ctx.process_name(pid),
            command_line: None,
            image: None,
            hashes: None,
        }),
        network: Some(NetworkJson {
            protocol: Some("tcp".into()),
            source_ip: saddr.map(|ip| ip.to_string()),
            source_port: sport as i32,
            destination_ip: daddr.to_string(),
            destination_port: dport as i32,
            domain: None,
        }),
        registry: None,
        attributes: None,
        tags: vec!["sensor:etw".into()],
    });
}

/// Kernel-Registry SetValueKey on a detection-relevant key -> registry.set.
fn handle_registry(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    if record.event_id() != EVENT_REG_SET_VALUE {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    // only writes that succeeded changed the registry
    if parser.try_parse::<u32>("Status").is_ok_and(|status| status != 0) {
        return;
    }
    let Ok(kernel_key) = parser.try_parse::<String>("KeyName") else {
        return;
    };
    let key = netreg::registry_path(&kernel_key);
    let value_name = parser.try_parse::<String>("ValueName").unwrap_or_default();
    if !ctx.registry_all && !netreg::interesting_registry(&key, &value_name) {
        return;
    }
    let pid = record.process_id();
    if pid == ctx.own_pid {
        return;
    }
    let value = match (parser.try_parse::<u32>("Type"), parser.try_parse::<Vec<u8>>("CapturedData")) {
        (Ok(reg_type), Ok(data)) => netreg::registry_value(reg_type, &data),
        _ => None,
    };
    ctx.emit(&EventJson {
        id: normalize::new_uuid(),
        timestamp: record_time(record),
        r#type: TYPE_REGISTRY_SET.into(),
        source: "etw".into(),
        host: ctx.host.clone(),
        user: None,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: 0,
            name: ctx.process_name(pid),
            command_line: None,
            image: None,
            hashes: None,
        }),
        network: None,
        registry: Some(RegistryJson {
            key,
            value_name: (!value_name.is_empty()).then_some(value_name),
            value,
            operation: "SetValue".into(),
        }),
        attributes: None,
        tags: vec!["sensor:etw".into()],
    });
}

/// Stops both sessions on Ctrl+C, Ctrl+Break or console close, so
/// ProcessTrace returns and the sensor exits through its normal path
/// (session ended, counters reported) without leaving a session running
/// in the kernel.
fn install_console_handler() {
    unsafe extern "system" fn on_console_event(_ctrl_type: u32) -> windows_sys::core::BOOL {
        let _ = ferrisetw::trace::stop_trace_by_name(NETREG_SESSION_NAME);
        let _ = ferrisetw::trace::stop_trace_by_name(SESSION_NAME);
        1 // handled: the main thread finishes once ProcessTrace returns
    }
    // SAFETY: registers a plain function with the documented signature;
    // the handler only calls ControlTrace through ferrisetw.
    let ok = unsafe { windows_sys::Win32::System::Console::SetConsoleCtrlHandler(Some(on_console_event), 1) };
    if ok == 0 {
        eprintln!("[SENSOR] warning: could not install the Ctrl+C handler; stop the sessions with 'logman stop {SESSION_NAME} -ets' and 'logman stop {NETREG_SESSION_NAME} -ets' after exiting");
    }
}
