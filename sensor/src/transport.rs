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
// Without TLS the token is never sent off the machine: "AUTH <token>" and
// "ENROLL <token> <host>" in clear over a network hand the credential to
// whoever can read the path. A plain connection carries a token only to
// a loopback engine, unless the operator opts in explicitly with
// --allow-plaintext-token (a lab, a link already protected below).
//
// The sender is shareable across threads because ETW callbacks run on
// the provider's own thread; a Mutex guards the socket.

use anyhow::{bail, Context, Result};
use std::io::{BufWriter, Read, Write};
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);

/// Ceiling for the TCP connect itself. The operating system's own (21 s
/// and more towards a host that drops the SYN) would hold the delivery
/// thread past the wait a shutdown gives it to spill the queue.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// How the connection to the engine is protected.
#[derive(Clone, Copy)]
pub struct Wire<'a> {
    /// CA bundle the engine's certificate must chain to (TLS); None: plain TCP
    pub tls_ca: Option<&'a Path>,
    /// --allow-plaintext-token: send the token without TLS to an engine
    /// that is not on this machine
    pub allow_plaintext_token: bool,
}

/// Ceiling for one event write on the live stream. A healthy engine
/// drains a LAN write in milliseconds, so a write that sits this long
/// means the peer stopped reading (zero window) or the path is
/// silently dead. The stream keeps pure blocking READS (the sensor
/// never reads after the handshake), but a bounded WRITE is what lets
/// `send_line` honor the stop flag: without it, a wedged connection
/// blocks the delivery thread inside `write_all` forever, shutdown
/// can no longer spill the queue to the spool (the drain thread never
/// reaches its stop check), and the heartbeats share the same stalled
/// queue — the engine would declare "sensor sin señal" for a sensor
/// that is alive. 30 s leaves headroom over the 10 s handshake
/// timeout for a large burst over a slow link while still bounding
/// the stall.
const STREAM_WRITE_TIMEOUT: Duration = Duration::from_secs(30);

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
    /// Timeouts for the live event stream: reads back to blocking
    /// (nothing reads the socket again), writes bounded by
    /// STREAM_WRITE_TIMEOUT so a wedged peer cannot hold the delivery
    /// thread past the stop flag. The handshake phase ran on the
    /// AUTH_TIMEOUT the raw socket got in `open`; this profile
    /// replaces it once the wire is ready for events.
    fn set_stream_timeouts(&mut self) -> std::io::Result<()> {
        match self {
            Stream::Plain(s) => {
                s.set_read_timeout(None)?;
                s.set_write_timeout(Some(STREAM_WRITE_TIMEOUT))?;
            }
            Stream::Tls(s) => {
                s.get_mut().set_read_timeout(None)?;
                s.get_mut().set_write_timeout(Some(STREAM_WRITE_TIMEOUT))?;
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
    allow_plaintext_token: bool,
    writer: Mutex<Option<BufWriter<Stream>>>,
}

impl Sender {
    pub fn connect(addr: &str, token: Option<&str>, wire: Wire) -> Result<Self> {
        // Configuration is checked up front and fails loudly: an
        // unreadable or invalid CA bundle, a TLS certificate that does
        // not verify, a token that would travel in clear and a rejected
        // token never fix themselves. An engine that is simply not
        // listening yet (boot order, network still coming up), or that
        // cut the connection or went silent in the middle of the
        // handshake (it is restarting), is not a reason to die: the
        // sensor starts, events wait in the queue/spool, and send_line
        // keeps dialing with backoff.
        if let Some(ca) = wire.tls_ca {
            let pem = std::fs::read(ca)
                .with_context(|| format!("reading TLS CA bundle {}", ca.display()))?;
            load_ca_certificates(&pem, ca)?;
        }
        if token.is_some() {
            check_token_channel(addr, wire)?;
        }
        let writer = match dial(addr, token, wire) {
            Ok(stream) => Some(BufWriter::new(stream)),
            Err(err) if err.downcast_ref::<PendingApproval>().is_some() => {
                eprintln!("[SENSOR] {err}");
                None
            }
            Err(err) if is_transient(&err) => {
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
            tls_ca: wire.tls_ca.map(Path::to_path_buf),
            allow_plaintext_token: wire.allow_plaintext_token,
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
            let wire = Wire { tls_ca: self.tls_ca.as_deref(), allow_plaintext_token: self.allow_plaintext_token };
            match dial(&self.addr, self.token.as_deref(), wire) {
                Ok(stream) => {
                    *self.writer.lock().expect("transport mutex poisoned") =
                        Some(BufWriter::new(stream));
                    // say so: after a run of failures the operator would
                    // otherwise assume the sensor is still disconnected
                    eprintln!("[SENSOR] reconnected to {} - delivering queued events", self.addr);
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

/// The engine knows this sensor's credential but an administrator has
/// not approved it yet (enrollment). Transient like an unreachable
/// engine: events wait in the queue/spool and the sensor keeps asking.
#[derive(Debug)]
pub struct PendingApproval {
    addr: String,
}

impl std::fmt::Display for PendingApproval {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "engine {} has this sensor waiting for approval in the console (Equipos); events wait in the queue/spool until then",
            self.addr
        )
    }
}

impl std::error::Error for PendingApproval {}

/// The engine accepted the connection and then cut it or went silent
/// before the handshake (TLS, AUTH or ENROLL) finished: it is starting,
/// stopping or overloaded. Transient like an unreachable engine — the
/// engine never answered, so nothing was refused.
#[derive(Debug)]
struct HandshakeInterrupted {
    addr: String,
    phase: &'static str,
    detail: String,
}

impl std::fmt::Display for HandshakeInterrupted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} with {} interrupted before the engine answered: {}", self.phase, self.addr, self.detail)
    }
}

impl std::error::Error for HandshakeInterrupted {}

/// A token would have crossed the network in clear. Final: it is the
/// configuration that must change.
#[derive(Debug)]
struct PlaintextTokenRefused {
    addr: String,
}

impl std::fmt::Display for PlaintextTokenRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "refusing to send the token to {} without TLS: it would cross the network in clear. Give the engine's CA with --tls-ca <ca.pem> (or SF_INGEST_CA), or accept the risk explicitly with --allow-plaintext-token",
            self.addr
        )
    }
}

impl std::error::Error for PlaintextTokenRefused {}

/// Whether an error only means "not yet": the engine is unreachable, cut
/// the handshake short, or the sensor still waits for approval. Anything
/// else is final.
pub fn is_transient(err: &anyhow::Error) -> bool {
    err.downcast_ref::<EngineUnreachable>().is_some()
        || err.downcast_ref::<HandshakeInterrupted>().is_some()
        || err.downcast_ref::<PendingApproval>().is_some()
}

/// Whether `addr` (host:port) names this machine: `localhost` or a
/// loopback IP literal. Any other name counts as remote without being
/// resolved — what it resolves to can change after the check.
pub fn addr_is_loopback(addr: &str) -> bool {
    let Ok(host) = server_name(addr) else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok_and(|ip| crate::netreg::is_loopback(&ip))
}

/// The start-up check for a sensor that holds a token (ingest or
/// enrollment): without TLS it may only talk to an engine on this
/// machine, unless the operator opted in. Checked before the first dial
/// so the refusal does not depend on the engine being up.
pub fn check_token_channel(addr: &str, wire: Wire) -> Result<()> {
    if wire.tls_ca.is_some() || wire.allow_plaintext_token || addr_is_loopback(addr) {
        return Ok(());
    }
    Err(PlaintextTokenRefused { addr: addr.to_string() }.into())
}

/// The same rule on the connection actually made, right before a token
/// is written to it: the peer's address decides, not the configured name
/// (`localhost` is trusted by name above; here it must really be local).
fn refuse_plaintext_token(stream: &Stream, addr: &str, wire: Wire) -> Result<()> {
    let Stream::Plain(tcp) = stream else {
        return Ok(());
    };
    let peer = tcp.peer_addr().ok().map(|p| p.ip());
    if plaintext_token_allowed(peer, wire) {
        return Ok(());
    }
    Err(PlaintextTokenRefused { addr: addr.to_string() }.into())
}

fn plaintext_token_allowed(peer: Option<IpAddr>, wire: Wire) -> bool {
    wire.allow_plaintext_token || peer.is_some_and(|ip| crate::netreg::is_loopback(&ip))
}

/// TCP connect with a ceiling, over every address the name resolves to.
fn connect(addr: &str) -> Result<TcpStream> {
    let unreachable = |source: std::io::Error| EngineUnreachable { addr: addr.to_string(), source };
    let mut last = std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "the address resolves to nothing");
    for target in addr.to_socket_addrs().map_err(unreachable)? {
        match TcpStream::connect_timeout(&target, CONNECT_TIMEOUT) {
            Ok(tcp) => return Ok(tcp),
            Err(err) => last = err,
        }
    }
    Err(unreachable(last).into())
}

/// Dial and, when a CA bundle is configured, upgrade to TLS, with the
/// handshake-phase timeouts set on the raw socket so the TLS handshake
/// and the first exchange are bounded by the same deadline.
fn open(addr: &str, wire: Wire) -> Result<Stream> {
    let tcp = connect(addr)?;
    tcp.set_read_timeout(Some(AUTH_TIMEOUT))?;
    tcp.set_write_timeout(Some(AUTH_TIMEOUT))?;
    Ok(match wire.tls_ca {
        None => Stream::Plain(tcp),
        Some(ca) => Stream::Tls(Box::new(tls_connect(addr, tcp, ca)?)),
    })
}

/// An I/O failure while waiting for the engine's answer: the connection
/// was cut or timed out (transient). An answer that is there but is not
/// one (InvalidData) stays a plain, final error.
fn answer_error(err: std::io::Error, addr: &str, phase: &'static str) -> anyhow::Error {
    if err.kind() == std::io::ErrorKind::InvalidData {
        return anyhow::Error::new(err).context(format!("{phase} with {addr}"));
    }
    HandshakeInterrupted { addr: addr.to_string(), phase, detail: err.to_string() }.into()
}

/// What the engine answers to ENROLL.
#[derive(Debug, serde::Deserialize)]
pub struct Enrollment {
    #[serde(default)]
    pub ack: String,
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub credential: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub error: String,
}

/// Exchanges an enrollment token for a credential of this sensor's own
/// ("ENROLL <token> <host>"). The engine closes the connection after
/// answering; the sensor then connects with AUTH <credential>.
pub fn enroll(addr: &str, token: &str, host: &str, wire: Wire) -> Result<Enrollment> {
    check_token_channel(addr, wire)?;
    let mut stream = open(addr, wire)?;
    refuse_plaintext_token(&stream, addr, wire)?;
    stream
        .write_all(format!("ENROLL {token} {host}\n").as_bytes())
        .map_err(|err| answer_error(err, addr, "ENROLL handshake"))?;
    let line = read_line_capped(&mut stream, 1024).map_err(|err| answer_error(err, addr, "ENROLL handshake"))?;
    let answer: Enrollment =
        serde_json::from_str(&line).with_context(|| format!("engine {addr} answered ENROLL with something unexpected: {line}"))?;
    if answer.ack != "enrolled" || answer.credential.is_empty() {
        bail!("engine {addr} refused the enrollment: {}", if answer.error.is_empty() { &line } else { &answer.error });
    }
    Ok(answer)
}

/// Dial and, when a CA bundle is configured, upgrade to TLS; then,
/// when a token is configured, run the AUTH handshake on top. An auth
/// rejection is fatal (misconfiguration, not a transient fault): the
/// engine answered and said no. A host waiting for approval is not.
fn dial(addr: &str, token: Option<&str>, wire: Wire) -> Result<Stream> {
    let mut stream = open(addr, wire)?;
    let Some(token) = token else {
        // no AUTH: the stream profile still bounds event writes
        stream.set_stream_timeouts()?;
        return Ok(stream);
    };
    refuse_plaintext_token(&stream, addr, wire)?;
    stream
        .write_all(format!("AUTH {token}\n").as_bytes())
        .map_err(|err| answer_error(err, addr, "AUTH handshake"))?;
    let ack = read_ack_line(&mut stream).map_err(|err| answer_error(err, addr, "AUTH handshake"))?;
    if ack.contains("\"ack\":\"pending\"") {
        return Err(PendingApproval { addr: addr.to_string() }.into());
    }
    if !ack.contains("\"ack\":\"ok\"") {
        bail!("engine {addr} rejected the ingest token: {ack}");
    }
    // the stream profile: blocking reads, bounded writes (see
    // STREAM_WRITE_TIMEOUT for why the write keeps a ceiling)
    stream.set_stream_timeouts()?;
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
    // a second handle on the socket: after a failed handshake it tells a
    // connection the engine cut from a certificate this side refused
    let probe = tcp.try_clone().ok();
    let started = Instant::now();
    connector.connect(&name, tcp).map_err(|err| {
        if handshake_was_cut(probe.as_ref(), started) {
            HandshakeInterrupted { addr: addr.to_string(), phase: "TLS handshake", detail: err.to_string() }.into()
        } else {
            anyhow::Error::new(err).context(format!("TLS handshake with {addr} (CA {})", ca_path.display()))
        }
    })
}

/// Why a TLS handshake failed, read off the socket because the TLS
/// library's error does not say: the peer closed or reset the connection
/// (an engine going down or coming up), or nothing arrived until the
/// handshake timeout. A certificate that does not verify fails at once
/// on a connection the engine still holds open — that is not this, and
/// it stays a final error.
fn handshake_was_cut(probe: Option<&TcpStream>, started: Instant) -> bool {
    if started.elapsed() + Duration::from_millis(500) >= AUTH_TIMEOUT {
        return true; // the peer went silent
    }
    let Some(probe) = probe else {
        return false;
    };
    let _ = probe.set_read_timeout(Some(Duration::from_millis(200)));
    let mut byte = [0u8; 1];
    match probe.peek(&mut byte) {
        Ok(0) => true,  // closed by the peer
        Ok(_) => false, // still talking
        Err(err) => !matches!(err.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut),
    }
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
fn read_ack_line(stream: &mut Stream) -> std::io::Result<String> {
    read_line_capped(stream, 256)
}

/// An I/O error means the line never arrived (cut, timeout); an answer
/// longer than `cap` is InvalidData: whatever answered is not the engine.
fn read_line_capped(stream: &mut Stream, cap: usize) -> std::io::Result<String> {
    use std::io::{Error, ErrorKind};
    let mut buf = Vec::with_capacity(64);
    let mut byte = [0u8; 1];
    while buf.len() < cap {
        let n = stream.read(&mut byte)?;
        if n == 0 {
            return Err(Error::new(ErrorKind::UnexpectedEof, "connection closed before an ack arrived"));
        }
        if byte[0] == b'\n' {
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
        buf.push(byte[0]);
    }
    Err(Error::new(ErrorKind::InvalidData, format!("ack line exceeded {cap} bytes")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, TcpListener};

    const PLAIN: Wire = Wire { tls_ca: None, allow_plaintext_token: false };

    /// A one-connection "engine" on a loopback port: reads the first
    /// line the sensor sends and answers with `answer` (None: closes
    /// without a word, like an engine going down mid-handshake).
    fn engine(answer: Option<&'static str>) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let thread = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut got = Vec::new();
            let mut byte = [0u8; 1];
            while conn.read(&mut byte).unwrap_or(0) == 1 && byte[0] != b'\n' {
                got.push(byte[0]);
            }
            if let Some(answer) = answer {
                let _ = conn.write_all(answer.as_bytes());
            }
            String::from_utf8_lossy(&got).into_owned()
        });
        (addr, thread)
    }

    #[test]
    fn loopback_addresses_are_told_from_remote_ones() {
        for local in ["127.0.0.1:7777", "127.8.9.10:7777", "localhost:7777", "LOCALHOST:7777", "[::1]:7777", "[::ffff:127.0.0.1]:7777"] {
            assert!(addr_is_loopback(local), "{local}");
        }
        for remote in ["10.0.0.5:7777", "192.168.1.20:7777", "engine.lab:7777", "[fe80::1]:7777", "localhost.evil.example:7777", "0.0.0.0:7777", "no-port", ":7777"] {
            assert!(!addr_is_loopback(remote), "{remote}");
        }
    }

    #[test]
    fn a_token_never_leaves_the_machine_in_clear_without_the_opt_in() {
        let refused = check_token_channel("10.0.0.5:7777", PLAIN).unwrap_err();
        assert!(refused.downcast_ref::<PlaintextTokenRefused>().is_some());
        assert!(!is_transient(&refused), "a refusal is final, not retried");
        let text = refused.to_string();
        assert!(text.contains("--tls-ca") && text.contains("--allow-plaintext-token"), "{text}");
        // loopback, TLS or the explicit opt-in are the three ways through
        assert!(check_token_channel("127.0.0.1:7777", PLAIN).is_ok());
        assert!(check_token_channel("10.0.0.5:7777", Wire { tls_ca: Some(Path::new("ca.pem")), allow_plaintext_token: false }).is_ok());
        assert!(check_token_channel("10.0.0.5:7777", Wire { tls_ca: None, allow_plaintext_token: true }).is_ok());
        // the same rule on the peer actually reached
        let remote: IpAddr = "10.0.0.5".parse().unwrap();
        assert!(!plaintext_token_allowed(Some(remote), PLAIN));
        assert!(!plaintext_token_allowed(None, PLAIN), "an unknown peer is not trusted");
        assert!(plaintext_token_allowed(Some(IpAddr::V4(Ipv4Addr::LOCALHOST)), PLAIN));
        assert!(plaintext_token_allowed(Some(remote), Wire { tls_ca: None, allow_plaintext_token: true }));
        // enrollment and the first connection refuse before any dial
        // (nothing listens on these addresses: a dial would be "unreachable")
        let err = enroll("10.0.0.5:7777", "enroll-token", "HOST", PLAIN).unwrap_err();
        assert!(err.downcast_ref::<PlaintextTokenRefused>().is_some(), "{err:#}");
        let err = Sender::connect("10.0.0.5:7777", Some("token"), PLAIN).err().expect("refused");
        assert!(err.downcast_ref::<PlaintextTokenRefused>().is_some(), "{err:#}");
    }

    #[test]
    fn an_engine_that_cuts_the_handshake_does_not_stop_the_sensor() {
        let (addr, thread) = engine(None);
        let sender = Sender::connect(&addr, Some("the-token"), PLAIN).expect("a cut handshake is transient at start-up");
        assert!(sender.writer.lock().unwrap().is_none(), "no connection yet: send_line keeps dialing");
        assert_eq!(thread.join().unwrap(), "AUTH the-token");
        // the same cut while enrolling is retried by the caller
        let (addr, thread) = engine(None);
        let err = enroll(&addr, "enroll-token", "HOST", PLAIN).unwrap_err();
        assert!(is_transient(&err), "{err:#}");
        thread.join().unwrap();
    }

    #[test]
    fn a_rejected_token_is_still_fatal() {
        let (addr, thread) = engine(Some("{\"ack\":\"denied\",\"error\":\"unknown token\"}\n"));
        let err = Sender::connect(&addr, Some("wrong"), PLAIN).err().expect("the engine said no");
        assert!(!is_transient(&err), "{err:#}");
        assert!(err.to_string().contains("rejected the ingest token"), "{err:#}");
        thread.join().unwrap();
        // an approved token connects
        let (addr, thread) = engine(Some("{\"ack\":\"ok\"}\n"));
        let sender = Sender::connect(&addr, Some("good"), PLAIN).unwrap();
        assert!(sender.writer.lock().unwrap().is_some());
        thread.join().unwrap();
    }

    #[test]
    fn an_unreachable_engine_fails_the_dial_within_the_connect_timeout() {
        // port 1 (tcpmux): nothing listens there, and unlike a port just
        // released no other test can be handed it meanwhile
        let started = Instant::now();
        let err = dial("127.0.0.1:1", None, PLAIN).err().expect("nothing listens");
        assert!(err.downcast_ref::<EngineUnreachable>().is_some(), "{err:#}");
        assert!(started.elapsed() < CONNECT_TIMEOUT + Duration::from_secs(2));
    }
}
