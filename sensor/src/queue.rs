// queue.rs: decouples event capture from delivery.
//
// The ETW callback runs on the provider's processing thread. Sending
// from it directly meant that an unreachable engine (reconnect backoff
// up to 30 s per attempt) stalled the consumer, the real-time session's
// buffers filled and Windows silently discarded events: the outage of
// the engine became a telemetry gap on every host. The callback now
// only pushes the serialized line into a bounded in-memory queue and a
// dedicated thread does the (blocking, retrying) delivery.
//
// When the queue is full the line goes to an optional on-disk spool
// (--spool), so an engine outage longer than the queue survives even a
// sensor restart; without a spool, or past its size cap, the line is
// dropped and counted, and the drops are reported on stderr. Once the
// spool holds data, every new line is appended there too until it has
// been drained, so delivery order is preserved: queue, then spool, then
// whatever arrived after. Draining renames the spool to
// `<spool>.draining` first; a crash mid-drain replays that file at the
// next start. Replays can repeat lines already delivered, which the
// engine absorbs: stored evidence is first-write-wins by event id.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How often the drain thread checks the spool while the queue is idle.
const IDLE_POLL: Duration = Duration::from_millis(500);

/// Minimum interval between two drop reports on stderr.
const REPORT_EVERY: Duration = Duration::from_secs(10);

/// On-disk overflow for the queue. Every operation opens and closes the
/// file under the owner's mutex, so the drain thread can rename it
/// without racing an open handle (Windows refuses to rename open files).
pub struct Spool {
    path: PathBuf,
    max_bytes: u64,
    size: u64,
}

impl Spool {
    pub fn new(path: PathBuf, max_bytes: u64) -> io::Result<Self> {
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            fs::create_dir_all(dir)?;
        }
        let size = match fs::metadata(&path) {
            Ok(m) => m.len(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => 0,
            Err(e) => return Err(e),
        };
        Ok(Self {
            path,
            max_bytes,
            size,
        })
    }

    fn draining_path(&self) -> PathBuf {
        let mut p = self.path.clone().into_os_string();
        p.push(".draining");
        PathBuf::from(p)
    }

    /// Appends one line; Ok(false) when the cap is reached.
    fn append(&mut self, line: &str) -> io::Result<bool> {
        let needed = line.len() as u64 + 1;
        if self.size + needed > self.max_bytes {
            return Ok(false);
        }
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        f.write_all(line.as_bytes())?;
        f.write_all(b"\n")?;
        self.size += needed;
        Ok(true)
    }

    /// Moves the current spool aside for draining. None when empty.
    fn take(&mut self) -> io::Result<Option<PathBuf>> {
        if self.size == 0 {
            return Ok(None);
        }
        let dst = self.draining_path();
        fs::rename(&self.path, &dst)?;
        self.size = 0;
        Ok(Some(dst))
    }
}

struct Shared {
    spool: Option<Mutex<Spool>>,
    /// set while the spool holds undelivered lines: new lines follow
    /// them there instead of overtaking them through the queue
    spooling: AtomicBool,
    dropped: AtomicU64,
    spooled: AtomicU64,
}

impl Shared {
    fn spill(&self, line: &str) {
        let Some(spool) = &self.spool else {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let mut s = spool.lock().unwrap_or_else(|p| p.into_inner());
        match s.append(line) {
            Ok(true) => {
                self.spooling.store(true, Ordering::Release);
                self.spooled.fetch_add(1, Ordering::Relaxed);
            }
            Ok(false) | Err(_) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

/// The capture side: cheap, non-blocking pushes from the ETW callback.
pub struct Pipeline {
    tx: SyncSender<String>,
    shared: Arc<Shared>,
}

/// Counters for tests and the shutdown report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stats {
    pub dropped: u64,
    pub spooled: u64,
}

impl Pipeline {
    /// Starts the drain thread. `send` delivers one line and may block
    /// (the transport retries until the engine accepts it); an Err is
    /// logged and the line is not retried by the queue.
    pub fn start<F>(capacity: usize, spool: Option<Spool>, send: F) -> (Self, JoinHandle<()>)
    where
        F: FnMut(&str) -> anyhow::Result<()> + Send + 'static,
    {
        let (tx, rx) = sync_channel(capacity.max(1));
        let pending = spool
            .as_ref()
            .map(|s| s.size > 0 || s.draining_path().exists())
            .unwrap_or(false);
        let shared = Arc::new(Shared {
            spool: spool.map(Mutex::new),
            spooling: AtomicBool::new(pending),
            dropped: AtomicU64::new(0),
            spooled: AtomicU64::new(0),
        });
        let worker = Arc::clone(&shared);
        let handle = std::thread::Builder::new()
            .name("sensor-delivery".into())
            .spawn(move || drain_loop(rx, worker, send))
            .expect("spawning the delivery thread");
        (Self { tx, shared }, handle)
    }

    /// Hands one line to the delivery thread without blocking on the
    /// network: queue, else spool, else counted drop.
    pub fn push(&self, line: String) {
        if self.shared.spooling.load(Ordering::Acquire) {
            self.shared.spill(&line);
            return;
        }
        match self.tx.try_send(line) {
            Ok(()) => {}
            Err(TrySendError::Full(line)) => self.shared.spill(&line),
            Err(TrySendError::Disconnected(_)) => {
                self.shared.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn stats(&self) -> Stats {
        Stats {
            dropped: self.shared.dropped.load(Ordering::Relaxed),
            spooled: self.shared.spooled.load(Ordering::Relaxed),
        }
    }
}

fn drain_loop<F>(rx: Receiver<String>, shared: Arc<Shared>, mut send: F)
where
    F: FnMut(&str) -> anyhow::Result<()>,
{
    let mut deliver = |line: &str| {
        if let Err(err) = send(line) {
            eprintln!("[SENSOR] send failed: {err:#}");
        }
    };
    let mut reported = 0u64;
    let mut last_report = Instant::now();
    // a drain interrupted by a crash or a stop is replayed first
    if let Some(spool) = &shared.spool {
        let leftover = spool
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .draining_path();
        if leftover.exists() {
            replay(&leftover, &mut deliver);
        }
    }
    loop {
        match rx.recv_timeout(IDLE_POLL) {
            Ok(line) => deliver(&line),
            Err(RecvTimeoutError::Timeout) => drain_spool(&shared, &mut deliver),
            Err(RecvTimeoutError::Disconnected) => {
                drain_spool(&shared, &mut deliver);
                return;
            }
        }
        let dropped = shared.dropped.load(Ordering::Relaxed);
        if dropped != reported && last_report.elapsed() >= REPORT_EVERY {
            eprintln!(
                "[SENSOR] WARNING: {} events dropped so far (queue full{})",
                dropped,
                if shared.spool.is_some() {
                    " and spool at its cap"
                } else {
                    "; no --spool configured"
                }
            );
            reported = dropped;
            last_report = Instant::now();
        }
    }
}

/// Delivers the spool once the in-memory queue is idle. The spool is
/// renamed under the lock and `spooling` cleared in the same critical
/// section, so lines pushed afterwards go to the queue and are sent
/// after the drained file (this thread drains it to the end first).
fn drain_spool<F: FnMut(&str)>(shared: &Shared, deliver: &mut F) {
    let Some(spool) = &shared.spool else { return };
    let taken = {
        let mut s = spool.lock().unwrap_or_else(|p| p.into_inner());
        let taken = s.take();
        if matches!(taken, Ok(_)) {
            shared.spooling.store(false, Ordering::Release);
        }
        taken
    };
    match taken {
        Ok(Some(path)) => replay(&path, deliver),
        Ok(None) => {}
        Err(err) => eprintln!("[SENSOR] spool rotation failed, retrying later: {err}"),
    }
}

fn replay<F: FnMut(&str)>(path: &Path, deliver: &mut F) {
    match File::open(path) {
        Ok(f) => {
            for line in BufReader::new(f).lines() {
                match line {
                    Ok(l) if !l.is_empty() => deliver(&l),
                    Ok(_) => {}
                    Err(err) => {
                        // a torn last line (crash mid-append) ends the replay
                        eprintln!(
                            "[SENSOR] spool {} unreadable past this point: {err}",
                            path.display()
                        );
                        break;
                    }
                }
            }
            if let Err(err) = fs::remove_file(path) {
                eprintln!(
                    "[SENSOR] could not remove drained spool {}: {err}",
                    path.display()
                );
            }
        }
        Err(err) => eprintln!("[SENSOR] could not open spool {}: {err}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sf-queue-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("spool.ndjson")
    }

    /// A send function gated by a channel: the test decides when the
    /// "engine" accepts each line.
    fn gated() -> (
        impl FnMut(&str) -> anyhow::Result<()> + Send + 'static,
        Arc<Mutex<Vec<String>>>,
        SyncSender<()>,
    ) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let (gate_tx, gate_rx) = sync_channel::<()>(1024);
        let sink = Arc::clone(&got);
        let send = move |line: &str| {
            gate_rx.recv().ok();
            sink.lock().unwrap().push(line.to_string());
            Ok(())
        };
        (send, got, gate_tx)
    }

    fn wait_for(got: &Arc<Mutex<Vec<String>>>, n: usize) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let v = got.lock().unwrap().clone();
            if v.len() >= n || Instant::now() > deadline {
                return v;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn push_never_blocks_and_counts_drops_without_spool() {
        let (send, got, gate) = gated();
        let (p, _h) = Pipeline::start(2, None, send);
        let start = Instant::now();
        for i in 0..10 {
            p.push(format!("l{i}"));
        }
        assert!(
            start.elapsed() < Duration::from_millis(500),
            "push blocked on a stalled engine"
        );
        // one line may already sit in the stalled send, two in the queue
        let dropped = p.stats().dropped;
        assert!((7..=8).contains(&dropped), "dropped = {dropped}");
        for _ in 0..10 {
            gate.send(()).unwrap();
        }
        let v = wait_for(&got, 10 - dropped as usize);
        assert_eq!(v.len(), 10 - dropped as usize);
        assert_eq!(v[0], "l0");
    }

    #[test]
    fn overflow_spools_and_preserves_order() {
        let path = tmp("order");
        let (send, got, gate) = gated();
        let (p, _h) = Pipeline::start(2, Some(Spool::new(path.clone(), 1 << 20).unwrap()), send);
        for i in 0..20 {
            p.push(format!("l{i:02}"));
        }
        assert_eq!(p.stats().dropped, 0);
        assert!(p.stats().spooled > 0);
        for _ in 0..40 {
            gate.send(()).unwrap();
        }
        let v = wait_for(&got, 20);
        let want: Vec<String> = (0..20).map(|i| format!("l{i:02}")).collect();
        assert_eq!(v, want, "delivery order changed through the spool");
        // drained spool files are removed
        let deadline = Instant::now() + Duration::from_secs(2);
        while (path.exists() || path.with_extension("ndjson.draining").exists())
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!path.exists());
    }

    #[test]
    fn spool_cap_drops_and_counts() {
        let path = tmp("cap");
        let (send, _got, _gate) = gated();
        let (p, _h) = Pipeline::start(1, Some(Spool::new(path, 16).unwrap()), send);
        for i in 0..10 {
            p.push(format!("line-{i}")); // 7 bytes each with newline
        }
        let s = p.stats();
        assert_eq!(s.spooled, 2, "cap of 16 bytes holds two 7-byte lines");
        assert!(s.dropped >= 6, "dropped = {}", s.dropped);
    }

    #[test]
    fn leftover_spool_survives_a_restart() {
        let path = tmp("restart");
        fs::write(&path, "old-1\nold-2\n").unwrap();
        let mut draining = path.clone().into_os_string();
        draining.push(".draining");
        fs::write(PathBuf::from(&draining), "older-0\n").unwrap();
        let (tx, rx) = channel::<String>();
        let send = move |line: &str| {
            tx.send(line.to_string()).unwrap();
            Ok(())
        };
        let (p, _h) = Pipeline::start(8, Some(Spool::new(path.clone(), 1 << 20).unwrap()), send);
        // a new line while old data is pending queues up behind it
        p.push("new-3".into());
        let mut got = Vec::new();
        for _ in 0..4 {
            got.push(rx.recv_timeout(Duration::from_secs(5)).unwrap());
        }
        assert_eq!(got, ["older-0", "old-1", "old-2", "new-3"]);
    }
}
