// transport.rs: NDJSON-over-TCP delivery with automatic reconnection
// and exponential backoff. The engine must never be a hard dependency
// of the sensor: if it is down, the sensor keeps retrying instead of
// losing its session (buffering with disk spill arrives in phase 1).
//
// The sender is shareable across threads because ETW callbacks run on
// the provider's own thread; a Mutex guards the socket.

use anyhow::{Context, Result};
use std::io::{BufWriter, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

pub struct Sender {
    addr: String,
    writer: Mutex<Option<BufWriter<TcpStream>>>,
}

impl Sender {
    pub fn connect(addr: &str) -> Result<Self> {
        let stream = dial(addr)?;
        Ok(Self {
            addr: addr.to_string(),
            writer: Mutex::new(Some(BufWriter::new(stream))),
        })
    }

    /// Send one NDJSON line (without the trailing newline), blocking
    /// until the engine accepts it. Reconnects with backoff on error.
    pub fn send_line(&self, line: &str) -> Result<()> {
        let mut backoff: u64 = 1;
        loop {
            {
                let mut guard = self.writer.lock().expect("transport mutex poisoned");
                if let Some(w) = guard.as_mut() {
                    let res = (|| -> std::io::Result<()> {
                        w.write_all(line.as_bytes())?;
                        w.write_all(b"\n")?;
                        w.flush()
                    })();
                    if res.is_ok() {
                        return Ok(());
                    }
                    *guard = None; // drop the dead socket
                }
            }
            eprintln!(
                "[SENSOR] transport error - reconnecting to {} in {backoff}s",
                self.addr
            );
            std::thread::sleep(Duration::from_secs(backoff));
            backoff = (backoff * 2).min(30);
            match dial(&self.addr) {
                Ok(stream) => {
                    *self.writer.lock().expect("transport mutex poisoned") =
                        Some(BufWriter::new(stream));
                }
                Err(err) => eprintln!("[SENSOR] reconnect failed: {err:#}"),
            }
        }
    }
}

fn dial(addr: &str) -> Result<TcpStream> {
    TcpStream::connect(addr).with_context(|| format!("dial {addr}"))
}
