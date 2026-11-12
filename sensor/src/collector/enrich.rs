// The enrichment thread: image lookup and hashing moved off the ETW
// callbacks so file reads never stall the trace consumers. Events wait
// here only as long as their image is worth waiting for; everything
// still unresolved goes out without the hash. The file reads themselves
// run on a helper (imagehash::BoundedHasher) this thread waits for only
// HASH_WAIT: a read the kernel never completes costs one hash, not the
// events queued behind it, and never the shutdown.

use crate::imagehash::{BoundedHasher, HashCache, Hashed};
use crate::normalize::{EventJson, HashesJson};
use crate::ntpath::RecentImages;
use crate::procinfo;
use crate::queue::Pipeline;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::config::{HASH_CACHE_CAP, HASH_MAX_BYTES, HASH_WAIT, IMAGE_WAIT};
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
/// and modification time; on a helper, waited for up to HASH_WAIT) and
/// emits the event. An event whose hash did not arrive in time, or that
/// found the helper still held by an earlier file, goes out without it
/// and is counted in `hash_dropped`. Once `stop` is set, what is still
/// queued is emitted as it is: a shutdown never waits for a file.
pub(super) fn start_enricher(
    pipeline: Arc<Pipeline>,
    rx: Receiver<Pending>,
    images: Arc<Mutex<RecentImages>>,
    hash_dropped: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
) -> Option<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("image-hash".into())
        .spawn(move || {
            let mut cache = HashCache::new(HASH_CACHE_CAP, HASH_MAX_BYTES);
            let mut hasher = BoundedHasher::start(HASH_WAIT, move |path| cache.sha256(path));
            if hasher.is_none() {
                eprintln!("[SENSOR] warning: image hashing unavailable (helper thread could not start)");
            }
            let mut was_stuck = false;
            for Pending { mut event, image, pid, kernel_name, queued } in rx {
                if stop.load(Ordering::Relaxed) {
                    emit_to(&pipeline, &event);
                    continue;
                }
                let image = image.or_else(|| wait_for_image(&images, pid, &kernel_name, queued));
                if let (Some(process), Some(path)) = (event.process.as_mut(), image) {
                    if process.image.is_none() {
                        if let Some(name) = procinfo::name_from_image(&kernel_name, &path) {
                            process.name = name;
                        }
                        process.image = Some(path.clone());
                    }
                    match hasher.as_mut().map(|h| h.sha256(&path, &stop)) {
                        Some(Hashed::Done(Some(digest))) => process.hashes = Some(HashesJson::sha256(digest)),
                        Some(Hashed::Done(None)) => {}
                        Some(Hashed::Skipped) | None => {
                            hash_dropped.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    // said once per episode, not once per event
                    let stuck = hasher.as_ref().is_some_and(BoundedHasher::stuck);
                    if stuck && !was_stuck {
                        eprintln!("[SENSOR] warning: reading {path} for its hash did not finish in {}s; process starts go out without a hash until it does", HASH_WAIT.as_secs());
                    } else if was_stuck && !stuck {
                        eprintln!("[SENSOR] image hashing resumed");
                    }
                    was_stuck = stuck;
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
