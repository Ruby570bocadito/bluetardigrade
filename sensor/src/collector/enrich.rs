// The enrichment thread: image lookup and hashing moved off the ETW
// callbacks so file reads never stall the trace consumers. Events wait
// here only as long as their image is worth waiting for; everything
// still unresolved goes out without the hash.

use crate::imagehash::HashCache;
use crate::normalize::{EventJson, HashesJson};
use crate::ntpath::RecentImages;
use crate::procinfo;
use crate::queue::Pipeline;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::config::{HASH_CACHE_CAP, HASH_MAX_BYTES, IMAGE_WAIT};
use super::shared::emit_to;

/// A process start waiting for its image hash.
pub(super) struct Pending {
    pub(super) event: EventJson,
    /// None: the process exited before its image could be read; the
    /// enrichment thread waits briefly for Kernel-Process to name it
    pub(super) image: Option<String>,
    pub(super) pid: u32,
    pub(super) kernel_name: String,
    pub(super) queued: Instant,
}

/// The enrichment thread: finds the image of processes that exited
/// before it could be read (waiting up to IMAGE_WAIT from the event for
/// Kernel-Process to report it), hashes each image (cached by path, size
/// and modification time) and emits the event.
pub(super) fn start_enricher(pipeline: Arc<Pipeline>, rx: Receiver<Pending>, images: Arc<Mutex<RecentImages>>) -> Option<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("image-hash".into())
        .spawn(move || {
            let mut cache = HashCache::new(HASH_CACHE_CAP, HASH_MAX_BYTES);
            for Pending { mut event, image, pid, kernel_name, queued } in rx {
                let image = image.or_else(|| wait_for_image(&images, pid, &kernel_name, queued));
                if let (Some(process), Some(path)) = (event.process.as_mut(), image) {
                    if process.image.is_none() {
                        if let Some(name) = procinfo::name_from_image(&kernel_name, &path) {
                            process.name = name;
                        }
                        process.image = Some(path.clone());
                    }
                    if let Some(digest) = cache.sha256(&path) {
                        process.hashes = Some(HashesJson::sha256(digest));
                    }
                }
                emit_to(&pipeline, &event);
            }
        })
        .ok()
}

/// Polls the Kernel-Process images for pid until one matching the
/// kernel's name shows up or the wait from `queued` runs out. Items are
/// handled in order, so the wait never stacks beyond IMAGE_WAIT.
fn wait_for_image(images: &Mutex<RecentImages>, pid: u32, kernel_name: &str, queued: Instant) -> Option<String> {
    let deadline = queued + IMAGE_WAIT;
    loop {
        let now = Instant::now();
        if let Some(path) = images.lock().ok().and_then(|m| m.get(pid, now)) {
            // an entry under a reused PID names another process: keep waiting
            if procinfo::name_from_image(kernel_name, &path).is_some() {
                return Some(path);
            }
        }
        if now >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
