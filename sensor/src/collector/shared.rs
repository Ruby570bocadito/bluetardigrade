// The shared state of the ETW callbacks: one `Arc<Shared>` handed to
// every provider callback, holding the delivery pipeline, the PID
// tables and the small caches the handlers coordinate through.

use crate::dns::DnsState;
use crate::netreg::ProcessTable;
use crate::ntpath::{DeviceMap, RecentImages};
use crate::normalize::EventJson;
use crate::queue::Pipeline;
use crate::regnames::KeyNames;
use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::enrich::Pending;

/// Shared state of the ETW callbacks.
pub(super) struct Shared {
    pub(super) host: String,
    pub(super) own_pid: u32,
    pub(super) pipeline: Arc<Pipeline>,
    pub(super) processes: Mutex<ProcessTable>,
    pub(super) registry_all: bool,
    pub(super) dns: Mutex<DnsState>,
    /// hand-off to the image-hash thread (None: hashing off or stopped)
    pub(super) enrich: Mutex<Option<SyncSender<Pending>>>,
    /// image paths from Kernel-Process, by PID
    pub(super) images: Arc<Mutex<RecentImages>>,
    pub(super) devices: DeviceMap,
    /// the Kernel-Process provider is running (worth waiting for)
    pub(super) images_live: AtomicBool,
    /// registry key handles -> names, and writes waiting for their key
    pub(super) regkeys: Mutex<KeyNames<EventJson>>,
    /// --debug-registry: lowercase fragment and the handles it matched
    pub(super) debug_registry: Option<(String, Mutex<HashSet<usize>>)>,
}

impl Shared {
    pub(super) fn process_name(&self, pid: u32) -> String {
        match self.processes.lock() {
            Ok(table) => table.name(pid),
            Err(_) => format!("pid {pid}"),
        }
    }

    /// The owner SID of a process, when a start or rundown event
    /// carried it — the writer's hive for registry events.
    pub(super) fn process_user(&self, pid: u32) -> Option<String> {
        self.processes.lock().ok().and_then(|table| table.user(pid))
    }

    pub(super) fn emit(&self, event: &EventJson) {
        emit_to(&self.pipeline, event);
    }

    /// Queues a process start for its image (when it is still missing)
    /// and hash, or emits it as it is when there is nothing to wait for,
    /// hashing is off or the enrichment thread is behind.
    pub(super) fn emit_enriched(&self, event: EventJson, image: Option<String>, pid: u32, kernel_name: String) {
        if image.is_none() && !self.images_live.load(Ordering::Relaxed) {
            self.emit(&event);
            return;
        }
        let pending = Pending { event, image, pid, kernel_name, queued: Instant::now() };
        let rejected = match self.enrich.lock() {
            Ok(guard) => match guard.as_ref() {
                Some(tx) => match tx.try_send(pending) {
                    Ok(()) => return,
                    Err(TrySendError::Full(p) | TrySendError::Disconnected(p)) => p,
                },
                None => pending,
            },
            Err(_) => pending,
        };
        self.emit(&rejected.event);
    }

    pub(super) fn recent_image(&self, pid: u32) -> Option<String> {
        self.images.lock().ok().and_then(|m| m.get(pid, Instant::now()))
    }

    pub(super) fn domain_for(&self, ip: &IpAddr) -> Option<String> {
        self.dns.lock().ok().and_then(|st| st.domain_for(ip, Instant::now()))
    }
}

pub(super) fn emit_to(pipeline: &Pipeline, event: &EventJson) {
    match serde_json::to_string(event) {
        Ok(line) => pipeline.push(line),
        Err(err) => eprintln!("[SENSOR] serialize failed: {err}"),
    }
}
