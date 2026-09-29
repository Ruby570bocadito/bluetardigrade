// security-sensor: ETW sensor for the security-framework engine.
//
// Two operating modes:
//   * native (default, Windows): opens ETW real-time sessions over the
//     Microsoft-Windows-Kernel-* providers and streams normalized
//     events to the engine (NDJSON over TCP).
//   * --simulate (any platform): replays a small scenario of synthetic
//     events so the transport and the engine can be tested without
//     kernel telemetry.
//
// Usage:
//   security-sensor --addr 127.0.0.1:7777 [--simulate]

mod normalize;
mod transport;

#[cfg(target_os = "windows")]
mod collector;

use anyhow::Result;

fn main() -> Result<()> {
    let mut addr = String::from("127.0.0.1:7777");
    let mut simulate = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--addr" => {
                addr = args.next().unwrap_or_else(|| {
                    eprintln!("--addr requires a value");
                    std::process::exit(2);
                });
            }
            "--simulate" => simulate = true,
            other => {
                eprintln!("unknown argument: {other}");
                eprintln!("usage: security-sensor --addr <ip:port> [--simulate]");
                std::process::exit(2);
            }
        }
    }

    eprintln!("[SENSOR] addr={addr} simulate={simulate}");

    if simulate || !cfg!(target_os = "windows") {
        if !simulate {
            eprintln!(
                "[SENSOR] note: ETW is only available on Windows; falling back to --simulate"
            );
        }
        run_simulated(&addr)
    } else {
        #[cfg(target_os = "windows")]
        {
            collector::run(&addr)
        }
        #[cfg(not(target_os = "windows"))]
        {
            unreachable!("guarded by cfg!(target_os) above")
        }
    }
}

fn run_simulated(addr: &str) -> Result<()> {
    let sender = transport::Sender::connect(addr)?;
    let scenario = normalize::simulate_scenario();
    for ev in &scenario {
        let line = serde_json::to_string(ev)?;
        sender.send_line(&line)?;
        eprintln!("[SENSOR] sent: {} {}", ev.r#type, event_label(ev));
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    eprintln!("[SENSOR] scenario complete");
    Ok(())
}

fn event_label(ev: &normalize::EventJson) -> String {
    if let Some(p) = &ev.process {
        p.name.clone()
    } else if let Some(n) = &ev.network {
        n.domain.clone().unwrap_or_else(|| n.destination_ip.clone())
    } else {
        "-".to_string()
    }
}
