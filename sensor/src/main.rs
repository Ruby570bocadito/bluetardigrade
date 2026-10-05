// security-sensor: ETW sensor for the bluetardigrade engine.
//
// Single operating mode: native (Windows). Opens ETW real-time sessions
// over the Microsoft-Windows-Kernel-* providers and streams normalized
// events to the engine (NDJSON over TCP). There is no simulated mode:
// on any other platform the sensor refuses to run instead of making
// data up.
//
// Usage:
//   security-sensor --addr 127.0.0.1:7777 [--token <shared-token>]
//                   [--tls-ca <ca.pem>] [--queue <events>]
//                   [--spool <file>] [--spool-max-mb <MiB>]
//                   [--no-network] [--no-registry] [--registry-all]
//                   [--no-dns] [--no-hash] [--debug-registry <fragment>]
//                   [--service] [--log <file>] [--token-file <file>]
//
// --service runs the sensor under the Windows service manager (installed
// once with 'sf-etw -Install', which asks for administrator rights; after
// that it starts with Windows, no elevated window needed). --log sends
// the output to a file (a service has no console) and --token-file reads
// the ingest token from a file, so it never appears in the service's
// command line. A manual sensor refuses to start while the service runs:
// both would use the same ETW sessions.
//
// Besides process creation the sensor captures TCP connection attempts
// (network.connect), DNS queries (network.connect with protocol dns;
// the answers also name the domain of the TCP connections that follow)
// and writes to the registry keys detections read (registry.set);
// --no-network / --no-dns / --no-registry turn each off and
// --registry-all forwards every registry value write (noisy). Process
// starts carry the full image path and, unless --no-hash, its SHA-256
// (computed off the ETW threads, cached, files over 100 MiB skipped).
//
// Delivery never runs on the ETW thread: events wait in a bounded
// in-memory queue (--queue, default 50000) while the engine is
// unreachable, then in the optional on-disk spool (--spool or
// SF_SENSOR_SPOOL, capped by --spool-max-mb, default 256); past both
// they are dropped and the drops are reported.
//
// The token can also come from the SF_INGEST_TOKEN environment
// variable (same var the engine and the other sensors honor); the
// command line wins when both are set. With --tls-ca (or the
// SF_INGEST_CA environment variable) the connection to the engine is
// TLS and the engine's certificate must chain to the given CA bundle;
// there is no skip-verification mode: an unverifiable engine is a
// refused connection, not a trusted one.

// Normalization and transport are exercised only by the ETW collector,
// which is Windows-only; gating the modules keeps non-Windows builds
// warning-free without a single #[allow(dead_code)].
#[cfg(target_os = "windows")]
mod normalize;
#[cfg(target_os = "windows")]
mod transport;

#[cfg(target_os = "windows")]
mod collector;
#[cfg(target_os = "windows")]
mod service;

// The delivery queue and the kernel event decoders are
// platform-independent so their tests run on any host; outside Windows
// they are only compiled for those tests.
#[cfg(any(target_os = "windows", test))]
mod dns;
#[cfg(any(target_os = "windows", test))]
mod heartbeat;
#[cfg(any(target_os = "windows", test))]
mod imagehash;
#[cfg(any(target_os = "windows", test))]
mod netreg;
#[cfg(any(target_os = "windows", test))]
mod ntpath;
#[cfg(any(target_os = "windows", test))]
mod procinfo;
#[cfg(any(target_os = "windows", test))]
mod queue;
#[cfg(any(target_os = "windows", test))]
mod regnames;

use anyhow::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let mut addr = String::from("127.0.0.1:7777");
    let mut token: Option<String> = None;
    let mut tls_ca: Option<PathBuf> = None;
    // process-start events are a few hundred bytes: 50 000 of them is
    // hours of a busy host held in a bounded ~25 MB
    let mut queue_cap: usize = 50_000;
    let mut spool: Option<PathBuf> = None;
    let mut spool_max_mb: u64 = 256;
    let mut network = true;
    let mut registry = true;
    let mut registry_all = false;
    let mut debug_registry: Option<String> = None;
    let mut service_mode = false;
    let mut log: Option<PathBuf> = None;
    let mut token_file: Option<PathBuf> = None;
    let mut dns = true;
    let mut hash = true;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--addr" => {
                addr = args.next().unwrap_or_else(|| {
                    eprintln!("--addr requires a value");
                    std::process::exit(2);
                });
            }
            "--token" => {
                token = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--token requires a value");
                    std::process::exit(2);
                }));
            }
            "--tls-ca" => {
                tls_ca = Some(PathBuf::from(args.next().unwrap_or_else(|| {
                    eprintln!("--tls-ca requires a value");
                    std::process::exit(2);
                })));
            }
            "--queue" => {
                queue_cap = parse_number(args.next(), "--queue");
            }
            "--spool" => {
                spool = Some(PathBuf::from(args.next().unwrap_or_else(|| {
                    eprintln!("--spool requires a value");
                    std::process::exit(2);
                })));
            }
            "--no-network" => network = false,
            "--no-registry" => registry = false,
            "--registry-all" => registry_all = true,
            "--debug-registry" => {
                debug_registry = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--debug-registry requires a key fragment, e.g. CurrentVersion\\Run");
                    std::process::exit(2);
                }));
            }
            "--service" => service_mode = true,
            "--log" => {
                log = Some(PathBuf::from(args.next().unwrap_or_else(|| {
                    eprintln!("--log requires a file path");
                    std::process::exit(2);
                })));
            }
            "--token-file" => {
                token_file = Some(PathBuf::from(args.next().unwrap_or_else(|| {
                    eprintln!("--token-file requires a file path");
                    std::process::exit(2);
                })));
            }
            "--no-dns" => dns = false,
            "--no-hash" => hash = false,
            "--spool-max-mb" => {
                spool_max_mb = parse_number(args.next(), "--spool-max-mb");
            }
            other => {
                eprintln!("unknown argument: {other}");
                eprintln!(
                    "usage: security-sensor --addr <ip:port> [--token <shared-token>] [--tls-ca <ca.pem>] [--queue <events>] [--spool <file>] [--spool-max-mb <MiB>] [--no-network] [--no-registry] [--registry-all] [--no-dns] [--no-hash] [--debug-registry <fragment>] [--service] [--log <file>] [--token-file <file>]"
                );
                std::process::exit(2);
            }
        }
    }
    // a service has no console: everything below goes to the log file
    #[cfg(target_os = "windows")]
    if let Some(path) = &log {
        if let Err(err) = service::log_to_file(path) {
            eprintln!("--log {}: {err}", path.display());
            std::process::exit(2);
        }
        eprintln!("[SENSOR] started {} (pid {}){}", normalize::now_rfc3339(), std::process::id(), if service_mode { " as a Windows service" } else { "" });
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (&log, service_mode);
    if token.is_none() {
        if let Some(path) = &token_file {
            match std::fs::read_to_string(path) {
                Ok(text) => token = text.trim_start_matches('\u{feff}').lines().next().map(|l| l.trim().to_string()).filter(|t| !t.is_empty()),
                Err(err) => {
                    eprintln!("--token-file {}: {err}", path.display());
                    std::process::exit(2);
                }
            }
        }
    }
    if token.is_none() {
        token = std::env::var("SF_INGEST_TOKEN").ok().filter(|t| !t.is_empty());
    }
    if spool.is_none() {
        spool = std::env::var("SF_SENSOR_SPOOL")
            .ok()
            .filter(|p| !p.is_empty())
            .map(PathBuf::from);
    }
    if tls_ca.is_none() {
        tls_ca = std::env::var("SF_INGEST_CA")
            .ok()
            .filter(|p| !p.is_empty())
            .map(PathBuf::from);
    }

    let captured = [
        (true, "process"),
        (hash, "sha256"),
        (network, "network"),
        (dns, "dns"),
        (registry, if registry_all { "registry-all" } else { "registry" }),
    ]
        .iter()
        .filter(|(on, _)| *on)
        .map(|(_, name)| *name)
        .collect::<Vec<_>>()
        .join("+");
    eprintln!("[SENSOR] addr={addr} auth={} tls={} queue={queue_cap} spool={} capture={captured}",
        if token.is_some() { "token" } else { "none" },
        if tls_ca.is_some() { "verified-ca" } else { "off" },
        spool
            .as_ref()
            .map(|p| format!("{} (max {spool_max_mb} MiB)", p.display()))
            .unwrap_or_else(|| "off".into()));

    if let Some(fragment) = &debug_registry {
        eprintln!("[SENSOR] registry diagnostics: printing how keys containing {fragment:?} are named");
    }

    if !cfg!(target_os = "windows") {
        eprintln!(
            "[SENSOR] error: ETW telemetry is only available on Windows; refusing to run without real data"
        );
        std::process::exit(1);
    }

    #[cfg(target_os = "windows")]
    {
        // the service and a manual sensor would share the ETW sessions: the
        // second one would stop the first one's sessions to start its own
        if !service_mode && service::service_running() {
            eprintln!("[SENSOR] the sensor already runs as a Windows service ({}); see 'sf-etw -Status', or stop it with 'sf-etw -Stop' before starting one by hand", service::SERVICE_NAME);
            std::process::exit(1);
        }
        let delivery = collector::Delivery {
            queue_cap,
            spool,
            spool_max_bytes: spool_max_mb.saturating_mul(1 << 20),
        };
        let capture = collector::Capture { network, registry, registry_all, dns, hash, debug_registry, as_service: service_mode };
        if service_mode {
            return service::run(
                Box::new(move || collector::run(&addr, token.as_deref(), tls_ca.as_deref(), delivery, capture)),
                collector::stop_sessions,
            );
        }
        collector::run(&addr, token.as_deref(), tls_ca.as_deref(), delivery, capture)
    }
    #[cfg(not(target_os = "windows"))]
    {
        unreachable!("guarded by cfg!(target_os) above")
    }
}

/// Parses a positive integer flag value or exits with a usage error.
fn parse_number<T: std::str::FromStr + PartialOrd + Default>(value: Option<String>, flag: &str) -> T {
    match value.as_deref().map(str::parse::<T>) {
        Some(Ok(n)) if n > T::default() => n,
        _ => {
            eprintln!("{flag} requires a positive integer");
            std::process::exit(2);
        }
    }
}
