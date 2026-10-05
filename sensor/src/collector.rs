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
//     PID, named through the table; DNS answers also name the domain of
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

#![cfg(target_os = "windows")]

use crate::dns::{self, DnsState};
use crate::heartbeat::{self, Health};
use crate::imagehash::HashCache;
use crate::netreg::{self, ProcessTable};
use crate::ntpath::{DeviceMap, RecentImages};
use crate::normalize::{self, EventJson, HashesJson, NetworkJson, ProcessJson, RegistryJson};
use crate::normalize::{TYPE_NETWORK_CONNECT, TYPE_PROCESS_CREATE, TYPE_REGISTRY_SET};
use crate::procinfo;
use crate::queue::{Pipeline, Spool};
use crate::regnames::KeyNames;
use crate::transport::Sender;
use anyhow::{Context, Result};
use std::collections::HashSet;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ferrisetw::parser::{Parser, Pointer};
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
const EVENT_REG_CREATE_KEY: u16 = 1;
const EVENT_REG_OPEN_KEY: u16 = 2;
const EVENT_REG_SET_VALUE: u16 = 5;
const EVENT_REG_CLOSE_KEY: u16 = 13;
/// CloseKey | SetValueKey | CreateKey | OpenKey keywords: the write and
/// the events that name its key.
const KERNEL_REGISTRY_KEYWORDS: u64 = 0x1 | 0x100 | 0x1000 | 0x2000;
/// Key handles remembered by name, and writes waiting for their key.
const REGISTRY_NAMES_CAP: usize = 65_536;
const REGISTRY_PARKED_CAP: usize = 4096;

const DNS_CLIENT: &str = "1c95126e-7eea-49a9-a3fe-a378b03ddb4d";
/// DNS-Client reports some queries first with this status (invalid
/// parameter) and no answer, then again with the result: the first is
/// not a resolution outcome and is ignored.
const DNS_STATUS_INVALID_PARAMETER: u32 = 87;

/// Microsoft-Windows-Kernel-Process: event 1 (ProcessStart) carries the
/// image path, so short-lived processes get one too.
const KERNEL_PROCESS: &str = "22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716";
/// WINEVENT_KEYWORD_PROCESS
const KERNEL_PROCESS_KEYWORD: u64 = 0x10;
const EVENT_KP_PROCESS_START: u16 = 1;
/// Images kept per PID, for how long, and how long the enrichment thread
/// waits for the image of a process that exited before it was read.
const RECENT_IMAGES_CAP: usize = 8192;
const RECENT_IMAGES_KEEP: Duration = Duration::from_secs(120);
const IMAGE_WAIT: Duration = Duration::from_secs(2);
/// "DNS query is completed": name, status and answers, in the context
/// of the process that asked.
const EVENT_DNS_QUERY_COMPLETED: u16 = 3008;

/// Image hashing: binaries remembered, the largest file hashed, and the
/// process starts that may wait for the enrichment thread.
const HASH_CACHE_CAP: usize = 4096;
const HASH_MAX_BYTES: u64 = 100 << 20;
const ENRICH_QUEUE: usize = 2048;

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
    /// DNS queries (and the domain of TCP connections)
    pub dns: bool,
    /// SHA-256 of the image of each process start
    pub hash: bool,
    /// print how registry keys containing this fragment are named
    /// (diagnostics for the key-name resolution)
    pub debug_registry: Option<String>,
    /// running under the Windows service manager (no console: no Ctrl+C
    /// handler; the heartbeat reports it)
    pub as_service: bool,
}

/// A process start waiting for its image hash.
struct Pending {
    event: EventJson,
    /// None: the process exited before its image could be read; the
    /// enrichment thread waits briefly for Kernel-Process to name it
    image: Option<String>,
    pid: u32,
    kernel_name: String,
    queued: Instant,
}

/// Shared state of the ETW callbacks.
struct Shared {
    host: String,
    own_pid: u32,
    pipeline: Arc<Pipeline>,
    processes: Mutex<ProcessTable>,
    registry_all: bool,
    dns: Mutex<DnsState>,
    /// hand-off to the image-hash thread (None: hashing off or stopped)
    enrich: Mutex<Option<SyncSender<Pending>>>,
    /// image paths from Kernel-Process, by PID
    images: Arc<Mutex<RecentImages>>,
    devices: DeviceMap,
    /// the Kernel-Process provider is running (worth waiting for)
    images_live: AtomicBool,
    /// registry key handles -> names, and writes waiting for their key
    regkeys: Mutex<KeyNames<EventJson>>,
    /// --debug-registry: lowercase fragment and the handles it matched
    debug_registry: Option<(String, Mutex<HashSet<usize>>)>,
}

impl Shared {
    fn process_name(&self, pid: u32) -> String {
        match self.processes.lock() {
            Ok(table) => table.name(pid),
            Err(_) => format!("pid {pid}"),
        }
    }

    fn emit(&self, event: &EventJson) {
        emit_to(&self.pipeline, event);
    }

    /// Queues a process start for its image (when it is still missing)
    /// and hash, or emits it as it is when there is nothing to wait for,
    /// hashing is off or the enrichment thread is behind.
    fn emit_enriched(&self, event: EventJson, image: Option<String>, pid: u32, kernel_name: String) {
        if image.is_none() && !self.images_live.load(Ordering::Relaxed) {
            self.emit(&event);
            return;
        }
        let pending = Pending { event, image, pid, kernel_name, queued: Instant::now() };
        let rejected = match self.enrich.lock() {
            Ok(guard) => match guard.as_ref() {
                Some(tx) => match tx.try_send(pending) {
                    Ok(()) => return,
                    Err(TrySendError::Full(p) | TrySendError::Disconnected(p)) => p,
                },
                None => pending,
            },
            Err(_) => pending,
        };
        self.emit(&rejected.event);
    }

    fn recent_image(&self, pid: u32) -> Option<String> {
        self.images.lock().ok().and_then(|m| m.get(pid, Instant::now()))
    }

    fn domain_for(&self, ip: &IpAddr) -> Option<String> {
        self.dns.lock().ok().and_then(|st| st.domain_for(ip, Instant::now()))
    }
}

fn emit_to(pipeline: &Pipeline, event: &EventJson) {
    match serde_json::to_string(event) {
        Ok(line) => pipeline.push(line),
        Err(err) => eprintln!("[SENSOR] serialize failed: {err}"),
    }
}

/// The enrichment thread: finds the image of processes that exited
/// before it could be read (waiting up to IMAGE_WAIT from the event for
/// Kernel-Process to report it), hashes each image (cached by path, size
/// and modification time) and emits the event.
fn start_enricher(pipeline: Arc<Pipeline>, rx: Receiver<Pending>, images: Arc<Mutex<RecentImages>>) -> Option<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("image-hash".into())
        .spawn(move || {
            let mut cache = HashCache::new(HASH_CACHE_CAP, HASH_MAX_BYTES);
            for Pending { mut event, image, pid, kernel_name, queued } in rx {
                let image = image.or_else(|| wait_for_image(&images, pid, &kernel_name, queued));
                if let (Some(process), Some(path)) = (event.process.as_mut(), image) {
                    if process.image.is_none() {
                        if let Some(name) = procinfo::name_from_image(&kernel_name, &path) {
                            process.name = name;
                        }
                        process.image = Some(path.clone());
                    }
                    if let Some(digest) = cache.sha256(&path) {
                        process.hashes = Some(HashesJson::sha256(digest));
                    }
                }
                emit_to(&pipeline, &event);
            }
        })
        .ok()
}

/// Polls the Kernel-Process images for pid until one matching the
/// kernel's name shows up or the wait from `queued` runs out. Items are
/// handled in order, so the wait never stacks beyond IMAGE_WAIT.
fn wait_for_image(images: &Mutex<RecentImages>, pid: u32, kernel_name: &str, queued: Instant) -> Option<String> {
    let deadline = queued + IMAGE_WAIT;
    loop {
        let now = Instant::now();
        if let Some(path) = images.lock().ok().and_then(|m| m.get(pid, now)) {
            // an entry under a reused PID names another process: keep waiting
            if procinfo::name_from_image(kernel_name, &path).is_some() {
                return Some(path);
            }
        }
        if now >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// NT device prefixes of the drive letters, to turn Kernel-Process image
/// names ("\Device\HarddiskVolume3\...") into Win32 paths.
fn device_map() -> DeviceMap {
    use windows_sys::Win32::Storage::FileSystem::QueryDosDeviceW;
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let drive = format!("{}:", letter as char);
        let name: Vec<u16> = drive.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buf = [0u16; 512];
        // SAFETY: name is NUL-terminated UTF-16 and buf is writable for the
        // length passed; the call writes at most that many characters.
        let n = unsafe { QueryDosDeviceW(name.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
        if n == 0 {
            continue;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let target = String::from_utf16_lossy(&buf[..end]);
        if !target.is_empty() {
            drives.push((target, drive));
        }
    }
    DeviceMap::new(drives, &std::env::var("SystemRoot").unwrap_or_else(|_| String::from(r"C:\Windows")))
}

/// Full Win32 path of a running process's image, from the kernel (not
/// argv[0], which the caller controls). None when the process already
/// exited or cannot be opened.
fn image_path(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if pid <= 4 {
        return None; // Idle and System have no image file
    }
    // SAFETY: OpenProcess has no pointer arguments; a null handle is
    // checked before use and every opened handle is closed below.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: buf is writable for `len` UTF-16 units and the call writes
    // at most that many, updating len to the characters written.
    let ok = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) };
    // SAFETY: handle came from OpenProcess and is closed exactly once.
    unsafe { CloseHandle(handle) };
    if ok == 0 || len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]))
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
                Provider::by_guid(DNS_CLIENT)
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

/// Sends a sensor.heartbeat now and every heartbeat::INTERVAL_SECS until
/// `stop` is set. Heartbeats travel the same queue and spool as events.
fn start_heartbeat(ctx: Arc<Shared>, capture: String, run_mode: &'static str, queue_cap: usize, stop: Arc<AtomicBool>) -> Option<JoinHandle<()>> {
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
    // The kernel event has no full image path and argv[0] is
    // caller-controlled: the path comes from the live process, for starts
    // and for the start-up rundown (those processes are running). It is
    // kept only when it matches the kernel's name (a process that already
    // exited may have had its PID reused), and then names the process
    // exactly: the kernel's name is cut at 14 characters.
    // a process that already exited is named by Kernel-Process, when its
    // event came first; otherwise the enrichment thread waits for it
    let verify = |path: String| procinfo::name_from_image(&short_name, &path).map(|name| (path, name));
    let verified = match opcode {
        OPCODE_PROCESS_START => image_path(pid).and_then(verify).or_else(|| ctx.recent_image(pid).and_then(verify)),
        OPCODE_PROCESS_DC_START => image_path(pid).and_then(verify),
        _ => None,
    };
    let (image, name) = match verified {
        Some((path, name)) => (Some(path), name),
        None => (None, procinfo::process_name(&short_name, command_line.as_deref().unwrap_or(""))),
    };
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
    let event = EventJson {
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
            image: image.clone(),
            hashes: None, // filled by the enrichment thread
        }),
        network: None,
        registry: None,
        attributes: None,
        tags: vec!["sensor:etw".into()],
    };
    ctx.emit_enriched(event, image, pid, short_name);
}

/// Kernel-Process ProcessStart: remembers the image of every new process,
/// for the ones that exit before the kernel trace's event is handled.
fn handle_process_image(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    if record.event_id() != EVENT_KP_PROCESS_START {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let (Ok(pid), Ok(nt)) = (parser.try_parse::<u32>("ProcessID"), parser.try_parse::<String>("ImageName")) else {
        return;
    };
    if let Some(path) = ctx.devices.to_dos(&nt) {
        if let Ok(mut images) = ctx.images.lock() {
            images.insert(pid, path, Instant::now());
        }
    }
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
            // the name this address was resolved from, when the lookup
            // went through the DNS client shortly before
            domain: ctx.domain_for(&daddr),
        }),
        registry: None,
        attributes: None,
        tags: vec!["sensor:etw".into()],
    });
}

/// DNS-Client "query completed" -> network.connect with protocol dns.
fn handle_dns(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    if record.event_id() != EVENT_DNS_QUERY_COMPLETED {
        return;
    }
    let pid = record.process_id();
    if pid == ctx.own_pid {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let Some(name) = parser.try_parse::<String>("QueryName").ok().and_then(|raw| dns::query_name(&raw)) else {
        return;
    };
    let status = parser.try_parse::<u32>("QueryStatus").ok();
    if status == Some(DNS_STATUS_INVALID_PARAMETER) {
        return; // the unanswered first report of a query; the result follows
    }
    let results = parser.try_parse::<String>("QueryResults").unwrap_or_default();
    let ips = dns::answer_ips(&results);
    let forward = match ctx.dns.lock() {
        Ok(mut st) => st.observe(pid, &name, &ips, Instant::now()),
        Err(_) => true,
    };
    if !forward {
        return;
    }
    let mut attributes = std::collections::BTreeMap::new();
    if let Ok(qtype) = parser.try_parse::<u32>("QueryType") {
        attributes.insert("dns_query_type".to_string(), qtype.to_string());
    }
    if let Some(status) = status {
        // 0 answered, 9003 name does not exist, 1460 timeout...
        attributes.insert("dns_status".to_string(), status.to_string());
    }
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
            protocol: Some("dns".into()),
            source_ip: None,
            source_port: 0,
            // first answer, like the Sysmon sensor's first A record
            destination_ip: ips.first().map(|ip| ip.to_string()).unwrap_or_default(),
            destination_port: 0,
            domain: Some(name),
        }),
        registry: None,
        attributes: (!attributes.is_empty()).then_some(attributes),
        tags: vec!["sensor:etw".into()],
    });
}

/// Kernel-Registry: OpenKey/CreateKey/CloseKey name the key handles, and
/// SetValueKey on a detection-relevant key becomes registry.set. The
/// write event carries no key name on current Windows: the key comes from
/// the handle's open (or, for a handle opened before the sensor started,
/// from its close, which the write waits for).
fn handle_registry(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    let id = record.event_id();
    if !matches!(id, EVENT_REG_CREATE_KEY | EVENT_REG_OPEN_KEY | EVENT_REG_SET_VALUE | EVENT_REG_CLOSE_KEY) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let pointer = |name: &str| parser.try_parse::<Pointer>(name).map(|p| *p).unwrap_or(0);
    let now = Instant::now();
    match id {
        EVENT_REG_CREATE_KEY | EVENT_REG_OPEN_KEY => {
            if parser.try_parse::<u32>("Status").is_ok_and(|status| status != 0) {
                return;
            }
            let key_object = pointer("KeyObject");
            let base_object = pointer("BaseObject");
            let base_name = parser.try_parse::<String>("BaseName").unwrap_or_default();
            let relative = parser.try_parse::<String>("RelativeName").unwrap_or_default();
            if let Ok(mut names) = ctx.regkeys.lock() {
                names.opened(key_object, base_object, &base_name, &relative);
                if let Some((fragment, watched)) = &ctx.debug_registry {
                    let named = names.name_of(key_object).unwrap_or("");
                    if named.to_ascii_lowercase().contains(fragment.as_str()) || relative.to_ascii_lowercase().contains(fragment.as_str()) {
                        eprintln!("[REG] {} obj={key_object:#x} base={base_object:#x} base_name=[{base_name}] relative=[{relative}] -> [{named}]", if id == EVENT_REG_OPEN_KEY { "open" } else { "create" });
                        if let Ok(mut w) = watched.lock() {
                            w.insert(key_object);
                        }
                    }
                }
            }
        }
        EVENT_REG_CLOSE_KEY => {
            let key_object = pointer("KeyObject");
            let key_name = parser.try_parse::<String>("KeyName").unwrap_or_default();
            if let Some((_, watched)) = &ctx.debug_registry {
                if watched.lock().is_ok_and(|mut w| w.remove(&key_object)) {
                    eprintln!("[REG] close obj={key_object:#x} key_name=[{key_name}]");
                }
            }
            let named = ctx.regkeys.lock().map(|mut names| names.closed(key_object, &key_name)).unwrap_or_default();
            for (event, kernel_key) in named {
                finish_registry(ctx, event, &kernel_key);
            }
        }
        _ => {
            // only writes that succeeded changed the registry
            if parser.try_parse::<u32>("Status").is_ok_and(|status| status != 0) {
                return;
            }
            let pid = record.process_id();
            if pid == ctx.own_pid {
                return;
            }
            let key_object = pointer("KeyObject");
            let key_name = parser.try_parse::<String>("KeyName").unwrap_or_default();
            let value_name = parser.try_parse::<String>("ValueName").unwrap_or_default();
            let value = match (parser.try_parse::<u32>("Type"), parser.try_parse::<Vec<u8>>("CapturedData")) {
                (Ok(reg_type), Ok(data)) => netreg::registry_value(reg_type, &data),
                _ => None,
            };
            let known = if !key_name.trim_matches(char::from(0)).trim().is_empty() {
                Some(key_name.clone())
            } else {
                ctx.regkeys.lock().ok().and_then(|names| names.name_of(key_object).map(str::to_string))
            };
            if let Some((fragment, watched)) = &ctx.debug_registry {
                let hit = watched.lock().is_ok_and(|w| w.contains(&key_object))
                    || known.as_deref().is_some_and(|k| k.to_ascii_lowercase().contains(fragment.as_str()));
                if hit {
                    eprintln!("[REG] set pid={pid} obj={key_object:#x} key_name=[{key_name}] resolved=[{}] value_name=[{value_name}]", known.as_deref().unwrap_or("(waits for close)"));
                }
            }
            let event = EventJson {
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
                    key: String::new(), // filled once the key is named
                    value_name: (!value_name.is_empty()).then_some(value_name),
                    value,
                    operation: "SetValue".into(),
                }),
                attributes: None,
                tags: vec!["sensor:etw".into()],
            };
            match known {
                Some(kernel_key) => finish_registry(ctx, event, &kernel_key),
                None => {
                    if let Ok(mut names) = ctx.regkeys.lock() {
                        names.park(key_object, event, now);
                    }
                }
            }
        }
    }
    // writes whose handle was not closed in time: without a key they
    // cannot pass the filter; --registry-all forwards them as they are
    let expired = ctx.regkeys.lock().map(|mut names| names.expire(now)).unwrap_or_default();
    if ctx.registry_all {
        for event in &expired {
            ctx.emit(event);
        }
    }
}

/// Names a registry write's key (kernel path -> HKLM/HKU form) and emits
/// it when it touches a key detections read (or with --registry-all).
fn finish_registry(ctx: &Shared, mut event: EventJson, kernel_key: &str) {
    let Some(registry) = event.registry.as_mut() else {
        return;
    };
    registry.key = netreg::registry_path(kernel_key);
    let value_name = registry.value_name.clone().unwrap_or_default();
    if !ctx.registry_all && !netreg::interesting_registry(&registry.key, &value_name) {
        return;
    }
    ctx.emit(&event);
}

/// Stops both ETW sessions: ProcessTrace returns and run() finishes
/// through its normal path (queue drained, counters reported). Used by
/// the Ctrl+C handler and by the service's Stop control.
pub fn stop_sessions() {
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
