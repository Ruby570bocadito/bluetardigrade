// transport.rs: NDJSON-over-TCP delivery with automatic reconnection
// and exponential backoff. The engine must never be a hard dependency
// of the sensor: if it is down, the sensor keeps retrying instead of
// losing its session (buffering with disk spill arrives in phase 1).
//
// Shared-token auth: when a token is configured, EVERY (re)connection
// starts with an "AUTH <token>" line and waits for the engine's ok ack
// before any event is sent; a rejection aborts the sensor instead of
// streaming into a closed socket.
//
// The sender is shareable across threads because ETW callbacks run on
// the provider's own thread; a Mutex guards the socket.

use anyhow::{bail, Context, Result};
use std::io::{BufWriter, Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Sender {
    addr: String,
    token: Option<String>,
    writer: Mutex<Option<BufWriter<TcpStream>>>,
}

impl Sender {
    pub fn connect(addr: &str, token: Option<&str>) -> Result<Self> {
        let stream = dial(addr, token)?;
        Ok(Self {
            addr: addr.to_string(),
            token: token.map(str::to_string),
            writer: Mutex::new(Some(BufWriter::new(stream))),
        })
    }

    /// Send one NDJSON line (without the trailing newline), blocking
    /// until the engine accepts it. Reconnects with backoff on error;
    /// every reconnect repeats the AUTH handshake.
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
            match dial(&self.addr, self.token.as_deref()) {
                Ok(stream) => {
                    *self.writer.lock().expect("transport mutex poisoned") =
                        Some(BufWriter::new(stream));
                }
                Err(err) => eprintln!("[SENSOR] reconnect failed: {err:#}"),
            }
        }
    }
}

/// Dial and, when a token is configured, run the AUTH handshake before
/// returning the stream. An auth rejection is fatal (misconfiguration,
/// not a transient fault): the engine answered and said no.
fn dial(addr: &str, token: Option<&str>) -> Result<TcpStream> {
    let mut stream = TcpStream::connect(addr).with_context(|| format!("dial {addr}"))?;
    let Some(token) = token else {
        return Ok(stream);
    };
    stream.set_read_timeout(Some(AUTH_TIMEOUT))?;
    stream.set_write_timeout(Some(AUTH_TIMEOUT))?;
    stream
        .write_all(format!("AUTH {token}\n").as_bytes())
        .with_context(|| format!("AUTH handshake to {addr}"))?;
    let ack = read_ack_line(&mut stream)
        .with_context(|| format!("reading AUTH ack from {addr}"))?;
    if !ack.contains("\"ack\":\"ok\"") {
        bail!("engine {addr} rejected the ingest token: {ack}");
    }
    // back to blocking semantics for the event stream: clears both the
    // read and write timeouts set for the handshake
    stream.set_read_timeout(None)?;
    stream.set_write_timeout(None)?;
    Ok(stream)
}

/// Read one newline-terminated ack line (bounded) without pulling a
/// BufReader into the connection's ownership.
fn read_ack_line(stream: &mut TcpStream) -> Result<String> {
    let mut buf = Vec::with_capacity(64);
    let mut byte = [0u8; 1];
    while buf.len() < 256 {
        let n = stream.read(&mut byte)?;
        if n == 0 {
            bail!("connection closed before an ack arrived");
        }
        if byte[0] == b'\n' {
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
        buf.push(byte[0]);
    }
    bail!("ack line exceeded 256 bytes")
}
