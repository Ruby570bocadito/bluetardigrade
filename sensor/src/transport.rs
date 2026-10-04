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
// Transport encryption: when a CA bundle is configured (--tls-ca /
// SF_INGEST_CA), every (re)connection upgrades to TLS and the engine's
// certificate must chain to one of the bundle's roots (and only to them:
// the system trust store is disabled). TLS sits below
// the AUTH handshake, so the wire protocol is unchanged; there is
// deliberately no skip-verification mode — a sensor that cannot verify
// the engine refuses to connect instead of streaming host telemetry
// into a channel it cannot authenticate.
//
// The sender is shareable across threads because ETW callbacks run on
// the provider's own thread; a Mutex guards the socket.

use anyhow::{bail, Context, Result};
use std::io::{BufWriter, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);

/// The wire to the engine: plain TCP, or TLS with a verified CA when
/// the operator configured one. TLS lives below the AUTH handshake
/// and the NDJSON protocol — neither changes, only the transport
/// underneath does. The TLS state is boxed: it is far larger than a
/// socket, and the enum is as big as its largest variant.
enum Stream {
    Plain(TcpStream),
    Tls(Box<native_tls::TlsStream<TcpStream>>),
}

impl Stream {
    /// Socket-level timeouts for the handshake phase: the TLS
    /// handshake and the AUTH exchange inherit them from the raw
    /// socket, so a hung engine cannot stall the sensor forever.
    /// Cleared again for the event stream (blocking semantics).
    fn set_timeouts(&mut self, timeout: Option<Duration>) -> std::io::Result<()> {
        match self {
            Stream::Plain(s) => {
                s.set_read_timeout(timeout)?;
                s.set_write_timeout(timeout)?;
            }
            Stream::Tls(s) => {
                s.get_mut().set_read_timeout(timeout)?;
                s.get_mut().set_write_timeout(timeout)?;
            }
        }
        Ok(())
    }
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Stream::Plain(s) => s.read(buf),
            Stream::Tls(s) => s.read(buf),
        }
    }
}

impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Stream::Plain(s) => s.write(buf),
            Stream::Tls(s) => s.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Stream::Plain(s) => s.flush(),
            Stream::Tls(s) => s.flush(),
        }
    }
}

pub struct Sender {
    addr: String,
    token: Option<String>,
    tls_ca: Option<PathBuf>,
    writer: Mutex<Option<BufWriter<Stream>>>,
}

impl Sender {
    pub fn connect(addr: &str, token: Option<&str>, tls_ca: Option<&Path>) -> Result<Self> {
        // Configuration is checked up front and fails loudly: an
        // unreadable or invalid CA bundle, a TLS certificate that does
        // not verify and a rejected token never fix themselves. An
        // engine that is simply not listening yet (boot order, network
        // still coming up, engine restarting) is not a reason to die:
        // the sensor starts, events wait in the queue/spool, and
        // send_line keeps dialing with backoff.
        if let Some(ca) = tls_ca {
            let pem = std::fs::read(ca)
                .with_context(|| format!("reading TLS CA bundle {}", ca.display()))?;
            load_ca_certificates(&pem, ca)?;
        }
        let writer = match dial(addr, token, tls_ca) {
            Ok(stream) => Some(BufWriter::new(stream)),
            Err(err) if err.downcast_ref::<EngineUnreachable>().is_some() => {
                eprintln!(
                    "[SENSOR] engine {addr} not reachable yet ({err:#}); events wait in the queue/spool until it is"
                );
                None
            }
            Err(err) => return Err(err),
        };
        Ok(Self {
            addr: addr.to_string(),
            token: token.map(str::to_string),
            tls_ca: tls_ca.map(Path::to_path_buf),
            writer: Mutex::new(writer),
        })
    }

    /// Send one NDJSON line (without the trailing newline), blocking
    /// until the engine accepts it. Reconnects with backoff on error;
    /// every reconnect repeats the TLS upgrade (when configured) and
    /// the AUTH handshake. Once `stop` is set it makes one last write
    /// attempt and gives up with an error instead of retrying, so a
    /// shutdown can spill the line to the spool.
    pub fn send_line(&self, line: &str, stop: &AtomicBool) -> Result<()> {
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
            if stop.load(Ordering::Acquire) {
                bail!("sensor stopping: engine {} unreachable", self.addr);
            }
            eprintln!(
                "[SENSOR] transport error - reconnecting to {} in {backoff}s",
                self.addr
            );
            // sleep in short steps so a shutdown is not held for up to 30 s
            let until = std::time::Instant::now() + Duration::from_secs(backoff);
            while std::time::Instant::now() < until && !stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(100));
            }
            if stop.load(Ordering::Acquire) {
                bail!("sensor stopping: engine {} unreachable", self.addr);
            }
            backoff = (backoff * 2).min(30);
            match dial(&self.addr, self.token.as_deref(), self.tls_ca.as_deref()) {
                Ok(stream) => {
                    *self.writer.lock().expect("transport mutex poisoned") =
                        Some(BufWriter::new(stream));
                }
                Err(err) => eprintln!("[SENSOR] reconnect failed: {err:#}"),
            }
        }
    }
}

/// The TCP connect itself failed: nobody is listening (yet) or the
/// network is not up. Transient by nature, unlike TLS and AUTH errors.
#[derive(Debug)]
struct EngineUnreachable {
    addr: String,
    source: std::io::Error,
}

impl std::fmt::Display for EngineUnreachable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // the io error itself is the source: anyhow's {:#} appends it
        write!(f, "dial {}", self.addr)
    }
}

impl std::error::Error for EngineUnreachable {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

/// Dial and, when a CA bundle is configured, upgrade to TLS; then,
/// when a token is configured, run the AUTH handshake on top. An auth
/// rejection is fatal (misconfiguration, not a transient fault): the
/// engine answered and said no.
fn dial(addr: &str, token: Option<&str>, tls_ca: Option<&Path>) -> Result<Stream> {
    let tcp = TcpStream::connect(addr).map_err(|source| EngineUnreachable {
        addr: addr.to_string(),
        source,
    })?;
    // Handshake-phase timeouts go on the raw socket so both the TLS
    // handshake and the AUTH exchange are bounded by the same deadline.
    tcp.set_read_timeout(Some(AUTH_TIMEOUT))?;
    tcp.set_write_timeout(Some(AUTH_TIMEOUT))?;
    let mut stream = match tls_ca {
        None => Stream::Plain(tcp),
        Some(ca) => Stream::Tls(Box::new(tls_connect(addr, tcp, ca)?)),
    };
    let Some(token) = token else {
        // no AUTH: back to blocking semantics for the event stream
        stream.set_timeouts(None)?;
        return Ok(stream);
    };
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
    stream.set_timeouts(None)?;
    Ok(stream)
}

/// TLS upgrade with a pinned CA bundle: the engine's certificate must
/// chain to one of the roots in the file (a self-signed engine cert is
/// the intended deployment) and the address's host part is the server
/// name the certificate is validated against (IP-SAN certificates
/// work; there is no skip-verification mode by design).
fn tls_connect(
    addr: &str,
    tcp: TcpStream,
    ca_path: &Path,
) -> Result<native_tls::TlsStream<TcpStream>> {
    let ca_pem = std::fs::read(ca_path)
        .with_context(|| format!("reading TLS CA bundle {}", ca_path.display()))?;
    let mut builder = native_tls::TlsConnector::builder();
    // Trust ONLY the operator's bundle. native-tls keeps the system
    // roots by default, so any certificate a public or enterprise CA
    // (AD CS autoenrollment) issued for the engine's name would have
    // been accepted too: whoever can obtain one could sit between the
    // sensor and the engine.
    builder.disable_built_in_roots(true);
    for cert in load_ca_certificates(&ca_pem, ca_path)? {
        builder.add_root_certificate(cert);
    }
    let connector = builder.build().context("building TLS connector")?;
    let name = server_name(addr)?;
    connector
        .connect(&name, tcp)
        .with_context(|| format!("TLS handshake with {addr} (CA {})", ca_path.display()))
}

/// Split a PEM CA bundle (one or more CERTIFICATE blocks — an engine
/// chain legitimately ships intermediates alongside the root) into
/// certificates for the connector's root store.
fn load_ca_certificates(ca_pem: &[u8], ca_path: &Path) -> Result<Vec<native_tls::Certificate>> {
    let text = std::str::from_utf8(ca_pem)
        .with_context(|| format!("TLS CA bundle {} is not valid UTF-8", ca_path.display()))?;
    let mut certs = Vec::new();
    let mut body: Option<String> = None;
    for line in text.lines() {
        match line.trim() {
            "-----BEGIN CERTIFICATE-----" => {
                if body.is_some() {
                    bail!(
                        "TLS CA bundle {} has a BEGIN inside an open block",
                        ca_path.display()
                    );
                }
                body = Some(String::new());
            }
            "-----END CERTIFICATE-----" => {
                let der = body
                    .take()
                    .with_context(|| format!("TLS CA bundle {} has an END without a BEGIN", ca_path.display()))?;
                let pem = format!("-----BEGIN CERTIFICATE-----\n{der}\n-----END CERTIFICATE-----");
                certs.push(native_tls::Certificate::from_pem(pem.as_bytes())
                    .with_context(|| format!("invalid certificate in TLS CA bundle {}", ca_path.display()))?);
            }
            l if body.is_some() => {
                let b = body.as_mut().expect("checked in the match guard");
                if !b.is_empty() {
                    b.push('\n');
                }
                b.push_str(l);
            }
            _ => {} // comments and whitespace outside blocks are ignored
        }
    }
    if certs.is_empty() {
        bail!("TLS CA bundle {} contains no certificates", ca_path.display());
    }
    Ok(certs)
}

/// The host part of `host:port`, used as the TLS server name for SNI
/// and certificate validation. Bracketed IPv6 is unbracketed; the
/// last-colon split keeps full-form unbracketed IPv6 hosts intact.
fn server_name(addr: &str) -> Result<String> {
    let Some((host, _port)) = addr.rsplit_once(':') else {
        bail!("address {addr} has no port (expected host:port)");
    };
    let host = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    if host.is_empty() {
        bail!("address {addr} has an empty host part");
    }
    Ok(host.to_string())
}

/// Read one newline-terminated ack line (bounded) without pulling a
/// BufReader into the connection's ownership.
fn read_ack_line(stream: &mut Stream) -> Result<String> {
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
