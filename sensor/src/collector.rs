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
// behind, events go out without the hash rather than wait, and the
// heartbeat reports how many went out that way.
//
// With --yara-rules (S-2), a third session consumes Microsoft-Windows-
// Kernel-File (Create names a file object, Write says bytes landed on
// it) and hands the written file's Win32 path to a scanner thread
// (yara.rs), which reads, hashes and scans it off the ETW callbacks;
// hits go out as yara.match events through the same pipeline. The write
// handler never blocks: what the scanner cannot take is counted
// (yara_dropped) and left unscanned. Off means off: without rules no
// file telemetry is consumed at all.
//
// With --yara-mem on top (S-2, per-process per DIR's decision), a sweep
// thread (memscan.rs) reads the compiled rules from the worker's shared
// slot — one compiler, two consumers — and every --yara-mem-every
// minutes scans each running process's committed memory separately,
// emitting the same yara.match events with the process attribution.
// Like every heavy read it runs off the ETW callbacks, on its own
// thread, with its own budget and counters.
//
// Every minute the heartbeat (heartbeat.rs) also asks both sessions what
// ETW lost (EventsLost, RealTimeBuffersLost, via ControlTraceW) and sends
// the totals to the engine, so a sensor that is silently losing telemetry
// shows up in the machine inventory instead of only in a log line.
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
// minute heartbeat), `sessions` (the session starts with recovery),
// `stop` (STOP_REQUESTED and the stop paths). This file owns the run
// loop that ties them together.

#![cfg(target_os = "windows")]

mod config;
mod enrich;
mod handlers;
mod health;
mod sessions;
mod shared;
mod stop;
mod winimage;

pub use config::{Capture, Delivery};
pub use stop::{stop_sessions, STOP_REQUESTED};

use anyhow::{Context, Result};
use ferrisetw::provider::{kernel_providers, Provider};
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::{KernelTrace, TraceTrait};
use ferrisetw::EventRecord;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::dns::DnsState;
use crate::memscan;
use crate::netreg::ProcessTable;
use crate::ntpath::RecentImages;
use crate::queue::{Pipeline, Spool};
use crate::regnames::KeyNames;
use crate::transport::Sender;
use crate::yara::{self, YaraStats};

use self::config::{
    ENRICH_QUEUE, FILE_NAMES_CAP, FILE_SESSION_NAME, NETREG_SESSION_NAME, PROCESS_TABLE_CAP, REGISTRY_NAMES_CAP,
    REGISTRY_PARKED_CAP, RECENT_IMAGES_CAP, RECENT_IMAGES_KEEP, SESSION_NAME, YARA_QUEUE,
};
use self::enrich::start_enricher;
use self::handlers::handle_process;
use self::health::start_heartbeat;
use self::sessions::{start_filewatch, start_netreg, start_with_recovery};
use self::shared::{emit_to, Shared, FileNames};
use self::stop::install_console_handler;
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
    // YARA (S-2): the worker owns the compiled rules and every file read;
    // the write handler only names files. Every successful load is
    // published to a shared slot the memory scanner consumes (one
    // compiler, two consumers). Nothing here without --yara-rules: no
    // rules directory, no worker, no file session, no memory sweeps.
    let (yara_tx, yara_stats, yara_thread, yara_slot) = match &capture.yara {
        Some(config) => {
            let stats = Arc::new(YaraStats::default());
            let (tx, rx) = sync_channel(YARA_QUEUE);
            let pipeline_for_yara = Arc::clone(&pipeline);
            let slot: yara::RulesSlot = Arc::new(Mutex::new(None));
            match yara::start_worker(
                hostname(),
                config.clone(),
                rx,
                Arc::clone(&stats),
                move |event| emit_to(&pipeline_for_yara, &event),
                Arc::clone(&slot),
            ) {
                Some(thread) => (Some(tx), Some(stats), Some(thread), Some(slot)),
                None => {
                    eprintln!("[SENSOR] warning: YARA scanning unavailable (thread could not start)");
                    (None, None, None, Some(slot))
                }
            }
        }
        None => (None, None, None, None),
    };
    // YARA memory sweeps (--yara-mem): the thread takes the rules from
    // the worker's slot and sweeps on its own cadence, off the ETW
    // callbacks like every other heavy read. Needs the file worker alive:
    // no worker, no rules are ever loaded, so a sweep thread would idle.
    let mem_thread = match (&capture.yara_mem, &yara_stats, &yara_thread, &yara_slot) {
        (Some(mem), Some(stats), Some(_), Some(slot)) => {
            let pipeline_for_mem = Arc::clone(&pipeline);
            let mem_stop = Arc::new(AtomicBool::new(false));
            let handle = memscan::start_memscan(
                hostname(),
                mem.clone(),
                Arc::clone(slot),
                Arc::clone(stats),
                move |event| emit_to(&pipeline_for_mem, &event),
                Arc::clone(&mem_stop),
            );
            handle.map(|thread| (thread, mem_stop))
        }
        _ => None,
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
        hash_dropped: AtomicU64::new(0),
        hash_enabled: capture.hash,
        filenames: Mutex::new(FileNames::new(FILE_NAMES_CAP)),
        yara: Mutex::new(yara_tx),
        yara_stats: yara_stats.clone(),
        yara_config: capture.yara.clone(),
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
    // The file session (YARA): independent from netreg on purpose - a
    // chatty file provider cannot starve DNS or registry, and neither
    // session's failure costs the other.
    let filewatch = if yara_stats.is_some() { start_filewatch(&ctx) } else { None };
    let yara_live = filewatch.is_some();
    let streams = [
        (true, "process", "process starts"),
        (capture.hash, "sha256", "image hashes"),
        (live && capture.network, "network", "TCP connections"),
        (live && dns_live, "dns", "DNS queries"),
        (live && capture.registry, "registry", "registry writes"),
        (yara_live, "yara", "YARA file scans"),
    ];
    let what = streams.iter().filter(|s| s.0).map(|s| s.2).collect::<Vec<_>>().join(", ");
    eprintln!("[SENSOR] ETW sessions active - streaming {what}");

    // health report for the engine's machine inventory, every minute
    let capture_label = streams.iter().filter(|s| s.0).map(|s| s.1).collect::<Vec<_>>().join("+");
    // the memory sweep is not an ETW session, but the capture label
    // names it so the inventory shows what the host really runs
    let capture_label = if mem_thread.is_some() { format!("{capture_label}+yara-mem") } else { capture_label };
    let heartbeat_stop = Arc::new(AtomicBool::new(false));
    // the sessions whose ETW loss the heartbeat reports: the kernel one
    // always runs, the network/registry one only when it started
    let mut sessions = vec![String::from(SESSION_NAME)];
    if live {
        sessions.push(String::from(NETREG_SESSION_NAME));
    }
    if yara_live {
        sessions.push(String::from(FILE_SESSION_NAME));
    }
    let run_mode = if capture.as_service { "service" } else { "console" };
    let heartbeat_thread = start_heartbeat(Arc::clone(&ctx), capture_label.to_string(), run_mode, queue_cap, sessions, Arc::clone(&heartbeat_stop));

    // The kernel session must stay alive while events are processed;
    // dropping `trace` stops it. process_from_handle blocks on this
    // thread until the trace is stopped or ProcessTrace fails.
    let _session = trace;
    let result = KernelTrace::process_from_handle(handle).map_err(|e| anyhow::anyhow!("ETW processing ended: {e:?}"));
    if let Some((netreg_trace, netreg_thread)) = netreg {
        drop(netreg_trace); // stops the session, ProcessTrace returns
        let _ = netreg_thread.join();
    }
    if let Some((file_trace, file_thread)) = filewatch {
        drop(file_trace); // stops the session, ProcessTrace returns
        let _ = file_thread.join();
    }
    heartbeat_stop.store(true, Ordering::Relaxed);
    if let Some(thread) = heartbeat_thread {
        let _ = thread.join();
    }
    // the sweep thread wakes up once a second: it notices its stop flag
    // within one tick
    if let Some((thread, mem_stop)) = mem_thread {
        mem_stop.store(true, Ordering::Relaxed);
        let _ = thread.join();
    }
    // closing the hand-offs lets both worker threads drain and finish
    if let Ok(mut tx) = ctx.enrich.lock() {
        tx.take();
    }
    if let Some(thread) = enricher {
        let _ = thread.join();
    }
    if let Ok(mut tx) = ctx.yara.lock() {
        tx.take();
    }
    if let Some(thread) = yara_thread {
        let _ = thread.join();
    }
    // hand everything still in memory to the engine or the spool
    pipeline.shutdown(delivery_thread, Duration::from_secs(10));
    let stats = pipeline.stats();
    eprintln!("[SENSOR] ETW session ended: {} events spooled, {} dropped", stats.spooled, stats.dropped);
    result.map(|_| ())
}

pub fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".into())
}
