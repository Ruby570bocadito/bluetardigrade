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
//     attempts, IPv4 and IPv6), Microsoft-Windows-DNS-Client (query
//     completed) and Microsoft-Windows-Kernel-Registry (SetValueKey).
//     All are filtered by event id inside the kernel; registry writes are
//     named from the key open/create/close events (regnames.rs: the write
//     event itself carries no key name), then limited to the keys
//     detections read (netreg.rs) and repeated
//     DNS queries are reported once a minute (dns.rs). They only carry a
//     PID, named through the table; registry writes also carry the
//     writer's user (its process's owner, same table) — which is what
//     resolves a key rooted in an unseen base ("?") to that user's
//     HKU\<SID>, and DNS answers also name the domain of
//     the TCP connections that follow.
//
// Process starts carry the full image path (queried from the live
// process in the callback, a couple of system calls; for a process that
// already exited, from Microsoft-Windows-Kernel-Process event 1, which
// the user trace also consumes) and its SHA-256,
// computed on a separate enrichment thread with a cache (imagehash.rs)
// so file reads never stall the ETW consumers. When that thread falls
// behind, events go out without the hash rather than wait.
//
// The network/registry session is best effort: if it cannot start, the
// sensor says so and keeps streaming process events. On Windows 8+ both
// run as named sessions, so they do not take the single "NT Kernel
// Logger" slot. Field decoding lives in procinfo.rs and netreg.rs.
//
// Layout: `config` (session tuning and the run's Delivery/Capture
// settings), `shared` (the state every callback shares), `enrich`
// (the image-hash thread), `winimage` (NT device / image path queries),
// `handlers` (one decoder per provider callback), `health` (the
// minute heartbeat). This file owns the session lifecycle: start with
// recovery, the run loop, and the stop paths.

#![cfg(target_os = "windows")]

mod config;
mod enrich;
mod handlers;
mod health;
mod shared;
mod winimage;

pub use config::{Capture, Delivery};

use anyhow::{Context, Result};
use ferrisetw::provider::{kernel_providers, EventFilter, Provider};
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::{KernelTrace, TraceTrait, UserTrace};
use ferrisetw::EventRecord;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::dns::DnsState;
use crate::netreg::ProcessTable;
use crate::ntpath::RecentImages;
use crate::queue::{Pipeline, Spool};
use crate::regnames::KeyNames;
use crate::transport::Sender;

use self::config::{
    ENRICH_QUEUE, EVENT_DNS_QUERY_COMPLETED, EVENT_KP_PROCESS_START, EVENT_REG_CLOSE_KEY, EVENT_REG_CREATE_KEY,
    EVENT_REG_OPEN_KEY, EVENT_REG_SET_VALUE, EVENT_TCP4_CONNECT, EVENT_TCP6_CONNECT, KERNEL_NETWORK,
    KERNEL_NETWORK_KEYWORDS, KERNEL_PROCESS, KERNEL_PROCESS_KEYWORD, KERNEL_REGISTRY, KERNEL_REGISTRY_KEYWORDS,
    NETREG_SESSION_NAME, PROCESS_TABLE_CAP, REGISTRY_NAMES_CAP, REGISTRY_PARKED_CAP, RECENT_IMAGES_CAP,
    RECENT_IMAGES_KEEP, SESSION_NAME,
};
use self::enrich::start_enricher;
use self::handlers::{handle_dns, handle_network, handle_process, handle_process_image, handle_registry};
use self::health::start_heartbeat;
use self::shared::Shared;
use self::winimage::device_map;

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
    let images = Arc::new(Mutex::new(RecentImages::new(RECENT_IMAGES_CAP, RECENT_IMAGES_KEEP)));
    let (enrich_tx, enricher) = if capture.hash {
        let (tx, rx) = sync_channel(ENRICH_QUEUE);
        match start_enricher(Arc::clone(&pipeline), rx, Arc::clone(&images)) {
            Some(thread) => (Some(tx), Some(thread)),
            None => {
                eprintln!("[SENSOR] warning: image hashing unavailable (thread could not start)");
                (None, None)
            }
        }
    } else {
        (None, None)
    };
    let ctx = Arc::new(Shared {
        host: hostname(),
        own_pid: std::process::id(),
        pipeline: Arc::clone(&pipeline),
        processes: Mutex::new(ProcessTable::new(PROCESS_TABLE_CAP)),
        registry_all: capture.registry_all,
        dns: Mutex::new(DnsState::new()),
        enrich: Mutex::new(enrich_tx),
        images,
        devices: device_map(),
        images_live: AtomicBool::new(false),
        regkeys: Mutex::new(KeyNames::new(REGISTRY_NAMES_CAP, REGISTRY_PARKED_CAP)),
        debug_registry: capture.debug_registry.as_ref().map(|f| (f.to_ascii_lowercase(), Mutex::new(HashSet::new()))),
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
    // them running in the kernel after the process is gone; a service is
    // stopped through the service manager instead (service.rs).
    if !capture.as_service {
        install_console_handler();
    }

    // Network, DNS, registry and the Kernel-Process image provider share
    // one session, and ferrisetw aborts the start on the first provider
    // that fails: if it cannot start, DNS and then the image provider are
    // left out, so one failing provider never costs the others.
    let mut dns_live = false;
    let mut netreg = None;
    let attempts = [(capture.dns, true), (false, true), (false, false)];
    for (i, &(dns, images)) in attempts.iter().enumerate() {
        if i > 0 && attempts[i - 1] == (dns, images) {
            continue; // DNS was not requested: the first retry is the same
        }
        if !(capture.network || capture.registry || dns || images) {
            continue;
        }
        if i > 0 {
            eprintln!("[SENSOR] retrying the session without {}", if images { "DNS" } else { "process images" });
            let _ = ferrisetw::trace::stop_trace_by_name(NETREG_SESSION_NAME);
        }
        if let Some(session) = start_netreg(&ctx, capture.network, dns, capture.registry, images) {
            dns_live = dns;
            ctx.images_live.store(images, Ordering::Relaxed);
            netreg = Some(session);
            break;
        }
    }
    let live = netreg.is_some();
    if !live && (capture.network || capture.registry || capture.dns) {
        eprintln!("[SENSOR] warning: continuing with process events only");
    }
    let streams = [
        (true, "process", "process starts"),
        (capture.hash, "sha256", "image hashes"),
        (live && capture.network, "network", "TCP connections"),
        (live && dns_live, "dns", "DNS queries"),
        (live && capture.registry, "registry", "registry writes"),
    ];
    let what = streams.iter().filter(|s| s.0).map(|s| s.2).collect::<Vec<_>>().join(", ");
    eprintln!("[SENSOR] ETW sessions active - streaming {what}");

    // health report for the engine's machine inventory, every minute
    let capture_label = streams.iter().filter(|s| s.0).map(|s| s.1).collect::<Vec<_>>().join("+");
    let heartbeat_stop = Arc::new(AtomicBool::new(false));
    let run_mode = if capture.as_service { "service" } else { "console" };
    let heartbeat_thread = start_heartbeat(Arc::clone(&ctx), capture_label.to_string(), run_mode, queue_cap, Arc::clone(&heartbeat_stop));

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
    // closing the hand-off lets the hash thread drain and finish
    if let Ok(mut tx) = ctx.enrich.lock() {
        tx.take();
    }
    if let Some(thread) = enricher {
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

/// Starts the network/DNS/registry/process-image session on its own
/// thread. Best effort: a failure is reported and None returned.
fn start_netreg(ctx: &Arc<Shared>, network: bool, dns: bool, registry: bool, images: bool) -> Option<(UserTrace, std::thread::JoinHandle<()>)> {
    let build = || {
        let mut builder = UserTrace::new().named(String::from(NETREG_SESSION_NAME));
        if images {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_PROCESS)
                    .any(KERNEL_PROCESS_KEYWORD)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_KP_PROCESS_START]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_process_image(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if network {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_NETWORK)
                    .any(KERNEL_NETWORK_KEYWORDS)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_TCP4_CONNECT, EVENT_TCP6_CONNECT]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_network(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if dns {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(config::DNS_CLIENT)
                    .any(u64::MAX)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_DNS_QUERY_COMPLETED]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_dns(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if registry {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_REGISTRY)
                    .any(KERNEL_REGISTRY_KEYWORDS)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_REG_CREATE_KEY, EVENT_REG_OPEN_KEY, EVENT_REG_SET_VALUE, EVENT_REG_CLOSE_KEY]))
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
            let what = [(network, "network"), (dns, "DNS"), (registry, "registry"), (images, "process-image")]
                .iter()
                .filter(|w| w.0)
                .map(|w| w.1)
                .collect::<Vec<_>>()
                .join("+");
            eprintln!("[SENSOR] warning: the {what} session could not start ({err})");
            None
        }
    }
}

/// Set by stop_sessions: a stop asked for before the sessions exist
/// (the first-start enrollment) is seen too.
pub static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".into())
}

/// Stops both ETW sessions: ProcessTrace returns and run() finishes
/// through its normal path (queue drained, counters reported). Used by
/// the Ctrl+C handler and by the service's Stop control.
pub fn stop_sessions() {
    STOP_REQUESTED.store(true, Ordering::Release);
    let _ = ferrisetw::trace::stop_trace_by_name(NETREG_SESSION_NAME);
    let _ = ferrisetw::trace::stop_trace_by_name(SESSION_NAME);
}

/// Stops both sessions on Ctrl+C, Ctrl+Break or console close, so
/// ProcessTrace returns and the sensor exits through its normal path
/// (session ended, counters reported) without leaving a session running
/// in the kernel.
fn install_console_handler() {
    unsafe extern "system" fn on_console_event(_ctrl_type: u32) -> windows_sys::core::BOOL {
        stop_sessions();
        1 // handled: the main thread finishes once ProcessTrace returns
    }
    // SAFETY: registers a plain function with the documented signature;
    // the handler only calls ControlTrace through ferrisetw.
    let ok = unsafe { windows_sys::Win32::System::Console::SetConsoleCtrlHandler(Some(on_console_event), 1) };
    if ok == 0 {
        eprintln!("[SENSOR] warning: could not install the Ctrl+C handler; stop the sessions with 'logman stop {SESSION_NAME} -ets' and 'logman stop {NETREG_SESSION_NAME} -ets' after exiting");
    }
}
