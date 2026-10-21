// The shared state of the ETW callbacks: one `Arc<Shared>` handed to
// every provider callback, holding the delivery pipeline, the PID
// tables and the small caches the handlers coordinate through.

use crate::dns::DnsState;
use crate::netreg::ProcessTable;
use crate::ntpath::{DeviceMap, RecentImages};
use crate::normalize::EventJson;
use crate::queue::Pipeline;
use crate::regnames::KeyNames;
use crate::yara::{YaraConfig, YaraStats};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    /// process starts that went out without their SHA-256 because the
    /// enrichment thread could not take them; the heartbeat reports it
    pub(super) hash_dropped: AtomicU64,
    /// hashing was requested for this run: the counter only counts the
    /// events denied enrichment when hashing was wanted at all
    pub(super) hash_enabled: bool,
    /// file objects -> names from Kernel-File Create, so a Write event
    /// can name the file it wrote
    pub(super) filenames: Mutex<FileNames>,
    /// hand-off of written files to the YARA worker (None: scanning off
    /// or the worker stopped)
    pub(super) yara: Mutex<Option<SyncSender<String>>>,
    /// the scan worker's counters, read by the heartbeat (None: off)
    pub(super) yara_stats: Option<Arc<YaraStats>>,
    /// the run's YARA settings: the handler pre-filters the excluded
    /// paths before a queue slot is spent on them
    pub(super) yara_config: Option<YaraConfig>,
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
        // a denial here means the hash thread is behind, already stopped
        // or never started: the event still goes out, just without its
        // hash, and the heartbeat counts it (hash_dropped)
        if self.hash_enabled {
            self.hash_dropped.fetch_add(1, Ordering::Relaxed);
        }
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

/// File objects remembered by name: Kernel-File Create (12) carries the
/// name, Write (16) only the object. Bounded the same way as the
/// registry's key names: forget everything when full (objects are opened
/// again and named again).
pub(super) struct FileNames {
    names: HashMap<usize, String>,
    cap: usize,
}

impl FileNames {
    pub(super) fn new(cap: usize) -> Self {
        FileNames { names: HashMap::new(), cap }
    }

    pub(super) fn opened(&mut self, object: usize, name: String) {
        if object == 0 || name.is_empty() {
            return;
        }
        if self.names.len() >= self.cap && !self.names.contains_key(&object) {
            self.names.clear();
        }
        self.names.insert(object, name);
    }

    pub(super) fn name_of(&self, object: usize) -> Option<&str> {
        self.names.get(&object).map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_remembered_and_stay_bounded() {
        let mut names = FileNames::new(4);
        names.opened(0, r"C:\zero-object-is-ignored".into());
        names.opened(0x10, r"C:\a.bin".into());
        assert_eq!(names.name_of(0x10), Some(r"C:\a.bin"));
        assert_eq!(names.name_of(0), None);
        names.opened(0x11, String::new());
        assert_eq!(names.name_of(0x11), None, "unnamed opens are not remembered");
        for obj in 0x20..0x30usize {
            names.opened(obj, format!("C:\\{obj:x}.bin"));
        }
        assert!(names.names.len() <= 4, "bounded");
        assert_eq!(names.name_of(0x10), None, "everything was forgotten when full");
    }
}
