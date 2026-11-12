// The ETW session starts: one builder per session (the network/DNS/
// registry session, the YARA file-watch session) and the recovery
// wrapper they share — a named session left behind by a previous run
// that was killed (kernel sessions outlive their process) is stopped
// and the start retried once. The kernel process trace is started
// directly from the run loop through the same wrapper.
//
// Each user-mode session lives on a supervising thread (`Session`): a
// session that ends without a stop request (stopped from outside with
// logman, or ProcessTrace failing) is started again with backoff, and
// while it is down its `alive` flag is off so the heartbeat stops
// announcing streams the sensor is not capturing.

use anyhow::Result;
use ferrisetw::provider::{EventFilter, Provider};
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::{TraceTrait, UserTrace};
use ferrisetw::EventRecord;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::config::{
    DNS_CLIENT, EVENT_DNS_QUERY_COMPLETED, EVENT_FILE_CREATE, EVENT_FILE_WRITE, EVENT_KP_PROCESS_START,
    EVENT_REG_CLOSE_KEY, EVENT_REG_CREATE_KEY, EVENT_REG_OPEN_KEY, EVENT_REG_SET_VALUE, EVENT_TCP4_CONNECT,
    EVENT_TCP6_CONNECT, FILE_SESSION_NAME, KERNEL_FILE, KERNEL_FILE_KEYWORDS, KERNEL_NETWORK,
    KERNEL_NETWORK_KEYWORDS, KERNEL_PROCESS, KERNEL_PROCESS_KEYWORD, KERNEL_REGISTRY, KERNEL_REGISTRY_KEYWORDS,
    NETREG_SESSION_NAME, SESSION_RESTART_MAX, SESSION_RESTART_MIN,
};
use super::handlers::{handle_dns, handle_file, handle_network, handle_process_image, handle_registry};
use super::shared::Shared;
use super::stop::STOP_REQUESTED;

/// Starts a named session; a session left behind by a previous run that
/// was killed (kernel sessions outlive their process) is stopped and the
/// start retried once.
pub(super) fn start_with_recovery<R, E: std::fmt::Debug>(name: &str, start: impl Fn() -> std::result::Result<R, E>) -> Result<R> {
    // ferrisetw's TraceError implements neither Display nor
    // std::error::Error, so anyhow's `?` cannot lift it: map errors
    // explicitly through their Debug form.
    let started = match start() {
        Err(e) if format!("{e:?}").contains("AlreadyExist") => {
            eprintln!("[SENSOR] stopping the ETW session left behind by a previous run ({name})");
            if let Err(stop_err) = ferrisetw::trace::stop_trace_by_name(name) {
                eprintln!("[SENSOR] could not stop it ({stop_err:?}): run the sensor elevated, or stop it with 'logman stop {name} -ets'");
            }
            start()
        }
        other => other,
    };
    started.map_err(|e| {
        let detail = format!("{e:?}");
        if detail.contains("-2147024891") {
            // E_ACCESSDENIED: kernel sessions need elevation
            anyhow::anyhow!("starting ETW trace {name}: access denied - run the sensor from an elevated (Administrator) prompt ({detail})")
        } else {
            anyhow::anyhow!("starting ETW trace {name}: {detail}")
        }
    })
}

/// A user-mode session on its supervising thread.
pub(super) struct Session {
    name: &'static str,
    thread: JoinHandle<()>,
    alive: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    halt: fn(&str),
}

impl Session {
    /// On while the session is consuming events; off from the moment it
    /// ends until a restart succeeds.
    pub(super) fn alive(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.alive)
    }

    /// Stops the session and waits for its thread. The flag goes first:
    /// a restart that was already under way sees it once the session is
    /// up and takes it down again, so the join never waits on a session
    /// nobody stops.
    pub(super) fn stop(self) {
        self.stopping.store(true, Ordering::Release);
        (self.halt)(self.name);
        let _ = self.thread.join();
    }
}

fn stop_by_name(name: &str) {
    let _ = ferrisetw::trace::stop_trace_by_name(name);
}

/// Sleeps `wait` in short steps; false when a stop was requested meanwhile.
fn sleep_unless_stopping(wait: Duration, stopping: &AtomicBool) -> bool {
    let until = Instant::now() + wait;
    loop {
        if stopping.load(Ordering::Acquire) || STOP_REQUESTED.load(Ordering::Acquire) {
            return false;
        }
        if Instant::now() >= until {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Starts a session on its own thread and keeps it running: `build`
/// starts it (the trace is created on the thread that owns it), `process`
/// blocks consuming it. None, with the reason on stderr, when the first
/// start fails. `restart` is the first and the longest wait before a
/// restart; `halt` makes `process` return.
fn supervise<T, H, E, PE>(
    name: &'static str,
    what: String,
    restart: (Duration, Duration),
    halt: fn(&str),
    build: impl Fn() -> std::result::Result<(T, H), E> + Send + 'static,
    process: impl Fn(H) -> std::result::Result<(), PE> + Send + 'static,
) -> Option<Session>
where
    E: std::fmt::Debug,
    PE: std::fmt::Debug,
{
    let alive = Arc::new(AtomicBool::new(false));
    let stopping = Arc::new(AtomicBool::new(false));
    let (started_tx, started_rx) = channel::<Result<()>>();
    let (alive_in, stopping_in, what_in) = (Arc::clone(&alive), Arc::clone(&stopping), what.clone());
    let thread = std::thread::Builder::new()
        .name(format!("etw-{name}"))
        .spawn(move || {
            let (alive, stopping, what) = (alive_in, stopping_in, what_in);
            let stop_asked = || stopping.load(Ordering::Acquire) || STOP_REQUESTED.load(Ordering::Acquire);
            let mut current = match start_with_recovery(name, &build) {
                Ok(pair) => {
                    alive.store(true, Ordering::Release);
                    let _ = started_tx.send(Ok(()));
                    pair
                }
                Err(err) => {
                    let _ = started_tx.send(Err(err));
                    return;
                }
            };
            let mut wait = restart.0;
            loop {
                let (trace, handle) = current;
                let began = Instant::now();
                // a stop that raced the (re)start: the session is up but
                // nobody will stop it again, so it is not consumed at all
                let outcome = if stop_asked() { None } else { Some(process(handle)) };
                alive.store(false, Ordering::Release);
                drop(trace); // closes and stops whatever is left of it
                if stop_asked() {
                    return;
                }
                if began.elapsed() >= restart.1 {
                    wait = restart.0; // it had been healthy: start over
                }
                eprintln!(
                    "[SENSOR] warning: the {what} session ({name}) ended without a stop request ({outcome:?}); the heartbeat no longer announces it, restarting in {}s",
                    wait.as_secs()
                );
                current = loop {
                    if !sleep_unless_stopping(wait, &stopping) {
                        return;
                    }
                    wait = (wait * 2).min(restart.1);
                    match start_with_recovery(name, &build) {
                        Ok(pair) => {
                            eprintln!("[SENSOR] the {what} session ({name}) is running again");
                            alive.store(true, Ordering::Release);
                            break pair;
                        }
                        Err(err) => eprintln!("[SENSOR] warning: the {what} session could not restart ({err}); next try in {}s", wait.as_secs()),
                    }
                };
            }
        })
        .ok()?;
    match started_rx.recv() {
        Ok(Ok(())) => Some(Session { name, thread, alive, stopping, halt }),
        Ok(Err(err)) => {
            eprintln!("[SENSOR] warning: the {what} session could not start ({err})");
            let _ = thread.join();
            None
        }
        Err(_) => None, // the thread died before reporting: nothing runs
    }
}

/// Starts the network/DNS/registry/process-image session on its own
/// thread. Best effort: a failure is reported and None returned.
pub(super) fn start_netreg(ctx: &Arc<Shared>, network: bool, dns: bool, registry: bool, images: bool) -> Option<Session> {
    let ctx = Arc::clone(ctx);
    let build = move || {
        let mut builder = UserTrace::new().named(String::from(NETREG_SESSION_NAME));
        if images {
            let ctx = Arc::clone(&ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_PROCESS)
                    .any(KERNEL_PROCESS_KEYWORD)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_KP_PROCESS_START]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_process_image(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if network {
            let ctx = Arc::clone(&ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_NETWORK)
                    .any(KERNEL_NETWORK_KEYWORDS)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_TCP4_CONNECT, EVENT_TCP6_CONNECT]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_network(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if dns {
            let ctx = Arc::clone(&ctx);
            builder = builder.enable(
                Provider::by_guid(DNS_CLIENT)
                    .any(u64::MAX)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_DNS_QUERY_COMPLETED]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_dns(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if registry {
            let ctx = Arc::clone(&ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_REGISTRY)
                    .any(KERNEL_REGISTRY_KEYWORDS)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_REG_CREATE_KEY, EVENT_REG_OPEN_KEY, EVENT_REG_SET_VALUE, EVENT_REG_CLOSE_KEY]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_registry(record, schema_locator, &ctx))
                    .build(),
            );
        }
        builder.start()
    };
    let what = [(network, "network"), (dns, "DNS"), (registry, "registry"), (images, "process-image")]
        .iter()
        .filter(|w| w.0)
        .map(|w| w.1)
        .collect::<Vec<_>>()
        .join("+");
    supervise(NETREG_SESSION_NAME, what, (SESSION_RESTART_MIN, SESSION_RESTART_MAX), stop_by_name, build, UserTrace::process_from_handle)
}

/// Starts the file-write session (Microsoft-Windows-Kernel-File, the
/// YARA lane) on its own thread. Best effort: a failure is reported and
/// None returned; the sensor keeps every other stream.
pub(super) fn start_filewatch(ctx: &Arc<Shared>) -> Option<Session> {
    let ctx = Arc::clone(ctx);
    let build = move || {
        let ctx = Arc::clone(&ctx);
        UserTrace::new()
            .named(String::from(FILE_SESSION_NAME))
            .enable(
                Provider::by_guid(KERNEL_FILE)
                    .any(KERNEL_FILE_KEYWORDS)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_FILE_CREATE, EVENT_FILE_WRITE]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| {
                        handle_file(record, schema_locator, &ctx)
                    })
                    .build(),
            )
            .start()
    };
    supervise(FILE_SESSION_NAME, String::from("file"), (SESSION_RESTART_MIN, SESSION_RESTART_MAX), stop_by_name, build, UserTrace::process_from_handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
    use std::sync::Mutex;

    // The fake session of the test below: `process` blocks until a unit
    // arrives here (the session "ends"), `halt` sends one.
    static END: Mutex<Option<SyncSender<()>>> = Mutex::new(None);

    fn end_session(_name: &str) {
        if let Some(tx) = END.lock().unwrap().as_ref() {
            let _ = tx.send(());
        }
    }

    fn wait_until(what: &str, cond: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !cond() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn a_session_that_dies_is_reported_down_and_started_again() {
        let (tx, rx): (SyncSender<()>, Receiver<()>) = sync_channel(8);
        *END.lock().unwrap() = Some(tx);
        let starts = Arc::new(AtomicUsize::new(0));
        let consuming = Arc::new(AtomicUsize::new(0));
        let (starts_in, consuming_in) = (Arc::clone(&starts), Arc::clone(&consuming));
        let rx = Mutex::new(rx);
        let session = supervise(
            "test-session",
            String::from("test"),
            (Duration::from_millis(300), Duration::from_secs(1)),
            end_session,
            move || -> std::result::Result<((), ()), String> {
                starts_in.fetch_add(1, Ordering::SeqCst);
                Ok(((), ()))
            },
            move |()| -> std::result::Result<(), String> {
                consuming_in.fetch_add(1, Ordering::SeqCst);
                rx.lock().unwrap().recv().map_err(|e| e.to_string())
            },
        )
        .expect("the first start succeeds");
        let alive = session.alive();
        wait_until("the first run", || consuming.load(Ordering::SeqCst) == 1);
        assert!(alive.load(Ordering::Acquire));
        // the session is stopped from outside: down at once, then back
        end_session("test-session");
        wait_until("the session to be reported down", || !alive.load(Ordering::Acquire));
        assert_eq!(starts.load(Ordering::SeqCst), 1, "the restart waits for its backoff");
        wait_until("the restart", || consuming.load(Ordering::SeqCst) == 2);
        assert!(alive.load(Ordering::Acquire));
        assert_eq!(starts.load(Ordering::SeqCst), 2);
        // a requested stop ends it for good
        session.stop();
        assert!(!alive.load(Ordering::Acquire));
        assert_eq!(starts.load(Ordering::SeqCst), 2, "no restart after a requested stop");
    }

    #[test]
    fn a_session_that_cannot_start_is_not_supervised() {
        let session = supervise(
            "test-session-refused",
            String::from("test"),
            (Duration::from_millis(10), Duration::from_millis(10)),
            end_session,
            || -> std::result::Result<((), ()), String> { Err(String::from("no such provider")) },
            |()| -> std::result::Result<(), String> { Ok(()) },
        );
        assert!(session.is_none());
    }
}
