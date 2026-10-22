// The ETW session starts: one builder per session (the network/DNS/
// registry session, the YARA file-watch session) and the recovery
// wrapper they share — a named session left behind by a previous run
// that was killed (kernel sessions outlive their process) is stopped
// and the start retried once. The kernel process trace is started
// directly from the run loop through the same wrapper.

use anyhow::Result;
use ferrisetw::provider::{EventFilter, Provider};
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::{TraceTrait, UserTrace};
use ferrisetw::EventRecord;
use std::sync::Arc;

use super::config::{
    DNS_CLIENT, EVENT_DNS_QUERY_COMPLETED, EVENT_FILE_CREATE, EVENT_FILE_WRITE, EVENT_KP_PROCESS_START,
    EVENT_REG_CLOSE_KEY, EVENT_REG_CREATE_KEY, EVENT_REG_OPEN_KEY, EVENT_REG_SET_VALUE, EVENT_TCP4_CONNECT,
    EVENT_TCP6_CONNECT, FILE_SESSION_NAME, KERNEL_FILE, KERNEL_FILE_KEYWORDS, KERNEL_NETWORK,
    KERNEL_NETWORK_KEYWORDS, KERNEL_PROCESS, KERNEL_PROCESS_KEYWORD, KERNEL_REGISTRY, KERNEL_REGISTRY_KEYWORDS,
    NETREG_SESSION_NAME,
};
use super::handlers::{handle_dns, handle_file, handle_network, handle_process_image, handle_registry};
use super::shared::Shared;

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

/// Starts the network/DNS/registry/process-image session on its own
/// thread. Best effort: a failure is reported and None returned.
pub(super) fn start_netreg(ctx: &Arc<Shared>, network: bool, dns: bool, registry: bool, images: bool) -> Option<(UserTrace, std::thread::JoinHandle<()>)> {
    let build = || {
        let mut builder = UserTrace::new().named(String::from(NETREG_SESSION_NAME));
        if images {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_PROCESS)
                    .any(KERNEL_PROCESS_KEYWORD)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_KP_PROCESS_START]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_process_image(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if network {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(KERNEL_NETWORK)
                    .any(KERNEL_NETWORK_KEYWORDS)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_TCP4_CONNECT, EVENT_TCP6_CONNECT]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_network(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if dns {
            let ctx = Arc::clone(ctx);
            builder = builder.enable(
                Provider::by_guid(DNS_CLIENT)
                    .any(u64::MAX)
                    .add_filter(EventFilter::ByEventIds(vec![EVENT_DNS_QUERY_COMPLETED]))
                    .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| handle_dns(record, schema_locator, &ctx))
                    .build(),
            );
        }
        if registry {
            let ctx = Arc::clone(ctx);
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
    match start_with_recovery(NETREG_SESSION_NAME, build) {
        Ok((trace, handle)) => {
            let thread = std::thread::Builder::new()
                .name("etw-netreg".into())
                .spawn(move || {
                    if let Err(e) = UserTrace::process_from_handle(handle) {
                        eprintln!("[SENSOR] network/registry session ended: {e:?}");
                    }
                })
                .ok()?;
            Some((trace, thread))
        }
        Err(err) => {
            let what = [(network, "network"), (dns, "DNS"), (registry, "registry"), (images, "process-image")]
                .iter()
                .filter(|w| w.0)
                .map(|w| w.1)
                .collect::<Vec<_>>()
                .join("+");
            eprintln!("[SENSOR] warning: the {what} session could not start ({err})");
            None
        }
    }
}

/// Starts the file-write session (Microsoft-Windows-Kernel-File, the
/// YARA lane) on its own thread. Best effort: a failure is reported and
/// None returned; the sensor keeps every other stream.
pub(super) fn start_filewatch(ctx: &Arc<Shared>) -> Option<(UserTrace, std::thread::JoinHandle<()>)> {
    let build = || {
        let ctx = Arc::clone(ctx);
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
    match start_with_recovery(FILE_SESSION_NAME, build) {
        Ok((trace, handle)) => {
            let thread = std::thread::Builder::new()
                .name("etw-filewatch".into())
                .spawn(move || {
                    if let Err(e) = UserTrace::process_from_handle(handle) {
                        eprintln!("[SENSOR] file session ended: {e:?}");
                    }
                })
                .ok()?;
            Some((trace, thread))
        }
        Err(err) => {
            eprintln!("[SENSOR] warning: the file session could not start ({err})");
            None
        }
    }
}
