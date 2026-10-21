// security-sensor: ETW sensor for the bluetardigrade engine.
//
// Operating modes: native ETW capture (Windows) and, since S-2, the
// on-demand `scan` subcommand (YARA over files, no ETW, no engine).
// Native mode opens ETW real-time sessions over the Microsoft-Windows-
// Kernel-* providers and streams normalized events to the engine (NDJSON
// over TCP). There is no simulated mode: on any other platform the
// capture refuses to run instead of making data up (the `scan`
// subcommand runs wherever the binary compiles: it reads what it is
// given, it invents nothing).
//
// Usage:
//   security-sensor --addr 127.0.0.1:7777 [--token <shared-token>]
//                   [--tls-ca <ca.pem>] [--queue <events>]
//                   [--spool <file>] [--spool-max-mb <MiB>]
//                   [--no-network] [--no-registry] [--registry-all]
//                   [--no-dns] [--no-hash] [--debug-registry <fragment>]
//                   [--yara-rules <dir>] [--yara-max-mb <MiB>]
//                   [--service] [--log <file>] [--token-file <file>]
//                   [--enroll-token <token> | --enroll-token-file <file>]
//   security-sensor scan <PATH>... --rules <dir> [--max-mb <MiB>]
//
// --service runs the sensor under the Windows service manager (installed
// once with 'sf-etw -Install', which asks for administrator rights; after
// that it starts with Windows, no elevated window needed). --log sends
// the output to a file (a service has no console) and --token-file reads
// the ingest token from a file, so it never appears in the service's
// command line. A manual sensor refuses to start while the service runs:
// both would use the same ETW sessions.
//
// Enrollment: with --enroll-token (or --enroll-token-file, or the
// SF_ENROLL_TOKEN environment variable) and an empty or missing
// --token-file, the sensor joins the fleet on its first start: it trades
// the enrollment token for a credential of its own, stores it in
// --token-file and deletes the enrollment token file. Until an
// administrator approves the host in the console the engine holds it
// off and events wait in the queue/spool.
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
// YARA (S-2): with --yara-rules <dir> the sensor compiles every
// *.yar/*.yara file under the directory (a rule the engine distributed
// there; an optional bundle.json names the bundle version) and scans
// every file written on the host (Microsoft-Windows-Kernel-File), with
// a size cap (--yara-max-mb, default 16 MiB) and a bounded queue: what
// the scanner cannot take is counted in the heartbeat (yara_dropped),
// never waited on. Hits go out as yara.match events with the file's
// path, size and SHA-256. The rules directory is re-checked every
// minute, so a new bundle lands without restarting the sensor. The
// `scan` subcommand runs the same rules on demand over files or
// directories and prints the same yara.match events as NDJSON.
//
// Delivery never runs on the ETW thread: events wait in a bounded
// in-memory queue (--queue, default 50000) while the engine is
// unreachable, then in the optional on-disk spool (--spool or
// SF_SENSOR_SPOOL, capped by --spool-max-mb, default 256); past both
// they are dropped and the drops are reported. The heartbeat also
// reports what ETW itself lost (events and real-time buffers) and how
// many process starts went out without their hash because the hashing
// thread could not keep up.
//
// The token can also come from the SF_INGEST_TOKEN environment
// variable (same var the engine and the other sensors honor); the
// command line wins when both are set. With --tls-ca (or the
// SF_INGEST_CA environment variable) the connection to the engine is
// TLS and the engine's certificate must chain to the given CA bundle;
// there is no skip-verification mode: an unverifiable engine is a
// refused connection, not a trusted one.

// Transport is exercised only by the ETW collector (Windows-only).
// normalize moves with the YARA scanner below: the yara.match event is
// built outside Windows too (tests, and the scan subcommand in the
// Windows binary). Gating keeps non-Windows builds warning-free without
// a single #[allow(dead_code)].
#[cfg(any(target_os = "windows", test))]
mod normalize;
#[cfg(target_os = "windows")]
mod transport;

#[cfg(target_os = "windows")]
mod collector;
#[cfg(target_os = "windows")]
mod enrollment;
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
// YARA scanning (S-2): rule loading, the scan worker and the yara.match
// event. Platform-independent (the scanner runs off the ETW callbacks),
// exercised on any host through its tests and, in the Windows binary,
// through the `scan` subcommand.
#[cfg(any(target_os = "windows", test))]
mod yara;
#[cfg(any(target_os = "windows", test))]
mod scan;

use anyhow::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    // The `scan` subcommand (S-2, on demand) does not share the capture
    // flags: it parses its own, works wherever the binary compiles, and
    // never opens ETW or connects to the engine.
    let mut raw: Vec<String> = std::env::args().skip(1).collect();
    if raw.first().map(String::as_str) == Some("scan") {
        let rest = raw.split_off(1);
        #[cfg(any(target_os = "windows", test))]
        {
            std::process::exit(scan::run(rest));
        }
        #[cfg(not(any(target_os = "windows", test)))]
        {
            let _ = rest;
            eprintln!("scan: only the Windows binary carries the YARA scanner");
            std::process::exit(2);
        }
    }
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
    let mut enroll_token: Option<String> = None;
    let mut enroll_token_file: Option<PathBuf> = None;
    let mut dns = true;
    let mut hash = true;
    let mut yara_rules: Option<PathBuf> = None;
    let mut yara_max_mb: u64 = 16; // MiB; yara::MAX_FILE_BYTES_DEFAULT pins this in a test
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
            "--enroll-token" => {
                enroll_token = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--enroll-token requires a value");
                    std::process::exit(2);
                }));
            }
            "--enroll-token-file" => {
                enroll_token_file = Some(PathBuf::from(args.next().unwrap_or_else(|| {
                    eprintln!("--enroll-token-file requires a file path");
                    std::process::exit(2);
                })));
            }
            "--no-dns" => dns = false,
            "--no-hash" => hash = false,
            "--yara-rules" => {
                yara_rules = Some(PathBuf::from(args.next().unwrap_or_else(|| {
                    eprintln!("--yara-rules requires a directory");
                    std::process::exit(2);
                })));
            }
            "--yara-max-mb" => {
                yara_max_mb = parse_number(args.next(), "--yara-max-mb");
            }
            "--spool-max-mb" => {
                spool_max_mb = parse_number(args.next(), "--spool-max-mb");
            }
            other => {
                eprintln!("unknown argument: {other}");
                eprintln!(
                    "usage: security-sensor [--addr <ip:port>] [--token <shared-token>] [--tls-ca <ca.pem>] [--queue <events>] [--spool <file>] [--spool-max-mb <MiB>] [--no-network] [--no-registry] [--registry-all] [--no-dns] [--no-hash] [--debug-registry <fragment>] [--yara-rules <dir>] [--yara-max-mb <MiB>] [--service] [--log <file>] [--token-file <file>] [--enroll-token <token> | --enroll-token-file <file>] | scan <PATH>... --rules <dir> [--max-mb <MiB>]"
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
    let _ = (&log, service_mode, yara_max_mb);
    // the credential: --token, then --token-file; an enrollment token
    // only matters while --token-file holds nothing yet
    if enroll_token.is_none() {
        if let Some(path) = &enroll_token_file {
            match std::fs::read_to_string(path) {
                Ok(text) => enroll_token = first_line(&text),
                // already enrolled: the file is deleted after the exchange
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    eprintln!("--enroll-token-file {}: {err}", path.display());
                    std::process::exit(2);
                }
            }
        }
    }
    if enroll_token.is_none() && enroll_token_file.is_none() {
        enroll_token = std::env::var("SF_ENROLL_TOKEN").ok().filter(|t| !t.is_empty());
    }
    let enrolling = enroll_token.is_some();
    if enrolling && token_file.is_none() {
        eprintln!("--enroll-token needs --token-file: the file where the sensor keeps the credential it receives");
        std::process::exit(2);
    }
    if token.is_none() {
        if let Some(path) = &token_file {
            match std::fs::read_to_string(path) {
                Ok(text) => token = first_line(&text),
                // not enrolled yet: the enrollment below creates it
                Err(err) if enrolling && err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    eprintln!("--token-file {}: {err}", path.display());
                    std::process::exit(2);
                }
            }
        }
    }
    let enroll_with = if token.is_none() { enroll_token } else { None };
    if token.is_none() && enroll_with.is_none() {
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
        (yara_rules.is_some(), "yara"),
    ]
        .iter()
        .filter(|(on, _)| *on)
        .map(|(_, name)| *name)
        .collect::<Vec<_>>()
        .join("+");
    eprintln!("[SENSOR] addr={addr} auth={} tls={} queue={queue_cap} spool={} capture={captured}",
        if token.is_some() { "token" } else if enroll_with.is_some() { "enroll" } else { "none" },
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
        // The scanner never touches the sensor's own files: the spool and
        // log it writes, the token it holds, and the rules directory it
        // reads (a match there would only echo the sensor's insides back
        // to the engine). Built before the spool moves into Delivery.
        let yara = yara_rules.map(|rules_dir| {
            let mut exclude = vec![rules_dir.clone()];
            if let Some(path) = &token_file {
                exclude.push(path.clone());
            }
            if let Some(path) = &log {
                exclude.push(path.clone());
            }
            if let Some(path) = &spool {
                exclude.push(path.clone());
            }
            crate::yara::YaraConfig { rules_dir, max_file_bytes: yara_max_mb.saturating_mul(1 << 20), exclude }
        });
        let delivery = collector::Delivery {
            queue_cap,
            spool,
            spool_max_bytes: spool_max_mb.saturating_mul(1 << 20),
        };
        let capture = collector::Capture { network, registry, registry_all, dns, hash, yara, debug_registry, as_service: service_mode };
        let start = move || -> Result<()> {
            let token = match (token, enroll_with, token_file) {
                (Some(token), _, _) => Some(token),
                (None, Some(enroll), Some(file)) => Some(enrollment::obtain_credential(
                    &addr,
                    &enroll,
                    &collector::hostname(),
                    tls_ca.as_deref(),
                    &file,
                    enroll_token_file.as_deref(),
                    &collector::STOP_REQUESTED,
                )?),
                _ => None,
            };
            collector::run(&addr, token.as_deref(), tls_ca.as_deref(), delivery, capture)
        };
        if service_mode {
            return service::run(Box::new(start), collector::stop_sessions);
        }
        start()
    }
    #[cfg(not(target_os = "windows"))]
    {
        unreachable!("guarded by cfg!(target_os) above")
    }
}

/// The first non-empty line of a token file, without a UTF-8 BOM
/// (PowerShell 5 writes one).
fn first_line(text: &str) -> Option<String> {
    text.trim_start_matches('\u{feff}').lines().next().map(|l| l.trim().to_string()).filter(|t| !t.is_empty())
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
