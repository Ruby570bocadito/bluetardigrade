// security-sensor: ETW sensor for the security-framework engine.
//
// Single operating mode: native (Windows). Opens ETW real-time sessions
// over the Microsoft-Windows-Kernel-* providers and streams normalized
// events to the engine (NDJSON over TCP). There is no simulated mode:
// on any other platform the sensor refuses to run instead of making
// data up.
//
// Usage:
//   security-sensor --addr 127.0.0.1:7777

mod normalize;
mod transport;

#[cfg(target_os = "windows")]
mod collector;

use anyhow::Result;

fn main() -> Result<()> {
    let mut addr = String::from("127.0.0.1:7777");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--addr" => {
                addr = args.next().unwrap_or_else(|| {
                    eprintln!("--addr requires a value");
                    std::process::exit(2);
                });
            }
            other => {
                eprintln!("unknown argument: {other}");
                eprintln!("usage: security-sensor --addr <ip:port>");
                std::process::exit(2);
            }
        }
    }

    eprintln!("[SENSOR] addr={addr}");

    if !cfg!(target_os = "windows") {
        eprintln!(
            "[SENSOR] error: ETW telemetry is only available on Windows; refusing to run without real data"
        );
        std::process::exit(1);
    }

    #[cfg(target_os = "windows")]
    {
        collector::run(&addr)
    }
    #[cfg(not(target_os = "windows"))]
    {
        unreachable!("guarded by cfg!(target_os) above")
    }
}
