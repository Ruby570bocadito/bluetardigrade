// security-sensor: ETW sensor for the security-framework engine.
//
// Single operating mode: native (Windows). Opens ETW real-time sessions
// over the Microsoft-Windows-Kernel-* providers and streams normalized
// events to the engine (NDJSON over TCP). There is no simulated mode:
// on any other platform the sensor refuses to run instead of making
// data up.
//
// Usage:
//   security-sensor --addr 127.0.0.1:7777 [--token <shared-token>]
//
// The token can also come from the SF_INGEST_TOKEN environment
// variable (same var the engine and the other sensors honor); the
// command line wins when both are set.

// Normalization and transport are exercised only by the ETW collector,
// which is Windows-only; gating the modules keeps non-Windows builds
// warning-free without a single #[allow(dead_code)].
#[cfg(target_os = "windows")]
mod normalize;
#[cfg(target_os = "windows")]
mod transport;

#[cfg(target_os = "windows")]
mod collector;

use anyhow::Result;

fn main() -> Result<()> {
    let mut addr = String::from("127.0.0.1:7777");
    let mut token: Option<String> = None;
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
            other => {
                eprintln!("unknown argument: {other}");
                eprintln!("usage: security-sensor --addr <ip:port> [--token <shared-token>]");
                std::process::exit(2);
            }
        }
    }
    if token.is_none() {
        token = std::env::var("SF_INGEST_TOKEN").ok().filter(|t| !t.is_empty());
    }

    eprintln!("[SENSOR] addr={addr} auth={}",
        if token.is_some() { "token" } else { "none" });

    if !cfg!(target_os = "windows") {
        eprintln!(
            "[SENSOR] error: ETW telemetry is only available on Windows; refusing to run without real data"
        );
        std::process::exit(1);
    }

    #[cfg(target_os = "windows")]
    {
        collector::run(&addr, token.as_deref())
    }
    #[cfg(not(target_os = "windows"))]
    {
        unreachable!("guarded by cfg!(target_os) above")
    }
}
