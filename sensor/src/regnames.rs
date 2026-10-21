// regnames.rs: the key a registry write went to.
//
// Microsoft-Windows-Kernel-Registry's SetValueKey event (5) names the key
// by its kernel object (KeyObject) and leaves KeyName empty on current
// Windows (seen on Windows 11 25H2: every write arrived without a key, so
// nothing passed the detection filter). The names come from the other
// events of the same provider:
//
//   - CreateKey (1) / OpenKey (2): KeyObject of the new handle, plus
//     BaseName or BaseObject (the key it was opened relative to) and
//     RelativeName. KeyObject -> full kernel path is remembered;
//   - CloseKey (13): KeyObject and its KeyName. Forgets the object, and
//     names a write whose key was opened before the sensor started (the
//     write is parked until the close, a few seconds at most).
//
// A handle opened relative to a base the sensor never saw opened (the
// HKCU/HKLM handles a process opens at startup, before the sensor ran:
// seen on a real host, BaseName and the CloseKey KeyName were empty too)
// keeps the part that is known, under an unknown root: "?\Software\
// Microsoft\Windows\CurrentVersion\Run". Two clues shrink that case:
//
//   - whenever another key names the base (its open carries BaseName),
//     the base itself is remembered, so later opens under it resolve
//     fully;
//   - the collector resolves the rest with the writing process's user
//     (netreg.rs registry_path_resolved): a write through a handle
//     rooted in the user hive lands in HKU\<SID>, and the event says so
//     (attributes.registry_root_inferred) instead of asserting a seen
//     path.
//
// Detections read the end of the path, so a Run-key write is still
// caught either way; the "?" only survives when the writer's user is
// unknown too (a process the sensor never saw start).
//
// Platform-independent so it is unit-tested on any host; the collector
// feeds it from the ETW callbacks.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How long a write whose key is unknown waits for the key's CloseKey.
pub const PARK_FOR: Duration = Duration::from_secs(5);

/// Root of a path whose base handle was opened before the sensor started.
pub const UNKNOWN_ROOT: &str = "?";

pub struct KeyNames<T> {
    names: HashMap<usize, String>,
    cap: usize,
    parked: Vec<(usize, Instant, T)>,
    park_cap: usize,
}

impl<T> KeyNames<T> {
    pub fn new(cap: usize, park_cap: usize) -> Self {
        KeyNames { names: HashMap::new(), cap, parked: Vec::new(), park_cap }
    }

    /// A handle was created or opened: remembers its full kernel path.
    /// A base named in the event (BaseName, a full kernel path) is
    /// remembered too: keys opened under the same base — one that
    /// predates the sensor, say — then resolve against it instead of
    /// falling back to the unknown root.
    pub fn opened(&mut self, key_object: usize, base_object: usize, base_name: &str, relative_name: &str) {
        if key_object == 0 {
            return;
        }
        let base = clean(base_name);
        if base_object != 0 && base.starts_with("\\REGISTRY\\") {
            self.remember(base_object, base.to_string());
        }
        let Some(full) = self.resolve(base_object, base_name, relative_name) else {
            return;
        };
        self.remember(key_object, full);
    }

    fn remember(&mut self, object: usize, name: String) {
        if object == 0 || name.is_empty() {
            return;
        }
        if self.names.len() >= self.cap && !self.names.contains_key(&object) {
            // forget everything rather than track recency: keys opened
            // again are named again
            self.names.clear();
        }
        self.names.insert(object, name);
    }

    fn resolve(&self, base_object: usize, base_name: &str, relative_name: &str) -> Option<String> {
        let rel = clean(relative_name);
        if rel.starts_with('\\') {
            return Some(rel.to_string()); // absolute: \REGISTRY\...
        }
        let base = clean(base_name);
        let base = if !base.is_empty() {
            Some(base.to_string())
        } else if base_object != 0 {
            self.names.get(&base_object).cloned()
        } else {
            None
        };
        let base = match base {
            Some(b) => b,
            // the relative part is still worth keeping
            None if !rel.is_empty() => UNKNOWN_ROOT.to_string(),
            None => return None,
        };
        if rel.is_empty() {
            return Some(base);
        }
        Some(format!("{}\\{}", base.trim_end_matches('\\'), rel))
    }

    /// The kernel path of an open handle, if it was seen being opened.
    pub fn name_of(&self, key_object: usize) -> Option<&str> {
        self.names.get(&key_object).map(String::as_str)
    }

    /// Parks a write whose key is unknown until its CloseKey names it.
    pub fn park(&mut self, key_object: usize, write: T, now: Instant) {
        if key_object == 0 || self.parked.len() >= self.park_cap {
            return;
        }
        self.parked.push((key_object, now, write));
    }

    /// A handle was closed: returns the parked writes it names (with the
    /// close's KeyName, or the name remembered at open) and forgets it.
    pub fn closed(&mut self, key_object: usize, key_name: &str) -> Vec<(T, String)> {
        let known = self.names.remove(&key_object);
        if self.parked.is_empty() {
            return Vec::new();
        }
        let name = match clean(key_name) {
            "" => known,
            n => Some(n.to_string()),
        };
        let mut out = Vec::new();
        let mut i = 0;
        while i < self.parked.len() {
            if self.parked[i].0 == key_object {
                let (_, _, write) = self.parked.swap_remove(i);
                if let Some(n) = &name {
                    out.push((write, n.clone()));
                }
            } else {
                i += 1;
            }
        }
        out
    }

    /// Parked writes whose key never got a name in PARK_FOR.
    pub fn expire(&mut self, now: Instant) -> Vec<T> {
        if self.parked.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut i = 0;
        while i < self.parked.len() {
            if now.duration_since(self.parked[i].1) >= PARK_FOR {
                out.push(self.parked.swap_remove(i).2);
            } else {
                i += 1;
            }
        }
        out
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.names.len()
    }
}

fn clean(s: &str) -> &str {
    s.trim_matches(char::from(0)).trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = r"\REGISTRY\USER\S-1-5-21-1-2-3-1001\Software\Microsoft\Windows\CurrentVersion\Run";

    #[test]
    fn absolute_and_relative_opens_are_named() {
        let mut k: KeyNames<u8> = KeyNames::new(100, 10);
        k.opened(0x10, 0, "", RUN);
        assert_eq!(k.name_of(0x10), Some(RUN));
        // relative to a base named in the event
        k.opened(0x20, 0x99, r"\REGISTRY\MACHINE\SOFTWARE", r"Microsoft\Windows\CurrentVersion\RunOnce");
        assert_eq!(k.name_of(0x20), Some(r"\REGISTRY\MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce"));
        // relative to a base the sensor saw opened
        k.opened(0x30, 0, "", r"\REGISTRY\MACHINE\SYSTEM\CurrentControlSet");
        k.opened(0x31, 0x30, "", r"Services\evil");
        assert_eq!(k.name_of(0x31), Some(r"\REGISTRY\MACHINE\SYSTEM\CurrentControlSet\Services\evil"));
        // reopen of the base itself
        k.opened(0x32, 0x30, "", "");
        assert_eq!(k.name_of(0x32), Some(r"\REGISTRY\MACHINE\SYSTEM\CurrentControlSet"));
        // a base opened before the sensor started: the known part, under "?"
        k.opened(0x40, 0x77, "", r"Software\Microsoft\Windows\CurrentVersion\Run");
        assert_eq!(k.name_of(0x40), Some(r"?\Software\Microsoft\Windows\CurrentVersion\Run"));
        k.opened(0x41, 0x40, "", "Sub");
        assert_eq!(k.name_of(0x41), Some(r"?\Software\Microsoft\Windows\CurrentVersion\Run\Sub"));
        // nothing known at all: nothing to remember
        k.opened(0x42, 0x77, "", "");
        assert_eq!(k.name_of(0x42), None);
        assert_eq!(k.name_of(0), None);
    }

    #[test]
    fn a_base_named_by_a_key_opened_under_it_is_remembered() {
        let mut k: KeyNames<u8> = KeyNames::new(100, 10);
        // the base (0x77) predates the sensor: this one stays under "?"
        k.opened(0x40, 0x77, "", r"Software\Microsoft\Windows\CurrentVersion\Run");
        assert_eq!(k.name_of(0x40), Some(r"?\Software\Microsoft\Windows\CurrentVersion\Run"));
        // another key opened under the same base names it: the base is
        // remembered from that event...
        k.opened(0x50, 0x77, r"\REGISTRY\USER\S-1-5-21-1-2-3-1001", r"Software\Explorer");
        assert_eq!(k.name_of(0x50), Some(r"\REGISTRY\USER\S-1-5-21-1-2-3-1001\Software\Explorer"));
        // ...and the first handle now resolves through it
        k.opened(0x60, 0x77, "", r"Software\Microsoft\Windows\CurrentVersion\RunOnce");
        assert_eq!(
            k.name_of(0x60),
            Some(r"\REGISTRY\USER\S-1-5-21-1-2-3-1001\Software\Microsoft\Windows\CurrentVersion\RunOnce")
        );
        // a relative BaseName is no evidence of the base's identity
        k.opened(0x70, 0x88, "SOFTWARE", "Microsoft");
        assert_eq!(k.name_of(0x70), Some(r"SOFTWARE\Microsoft"));
        k.opened(0x80, 0x88, "", "Windows NT");
        assert_eq!(k.name_of(0x80), Some(r"?\Windows NT"));
        // closing the base forgets it: a stale pointer must not revive
        // an old name
        k.closed(0x77, "");
        assert_eq!(k.name_of(0x77), None);
        k.opened(0x90, 0x77, "", "Software");
        assert_eq!(k.name_of(0x90), Some(r"?\Software"));
    }

    #[test]
    fn a_write_on_an_unknown_handle_waits_for_its_close() {
        let mut k: KeyNames<&str> = KeyNames::new(100, 10);
        let t0 = Instant::now();
        k.park(0x50, "write-a", t0);
        k.park(0x51, "write-b", t0);
        assert!(k.closed(0x52, RUN).is_empty(), "another handle");
        let named = k.closed(0x50, RUN);
        assert_eq!(named, vec![("write-a", RUN.to_string())]);
        // the close forgets the handle; an empty close name falls back to the open name
        k.opened(0x60, 0, "", RUN);
        k.park(0x60, "write-c", t0);
        assert_eq!(k.closed(0x60, ""), vec![("write-c", RUN.to_string())]);
        assert_eq!(k.name_of(0x60), None);
        // never closed: expires
        assert!(k.expire(t0 + Duration::from_secs(1)).is_empty());
        assert_eq!(k.expire(t0 + PARK_FOR), vec!["write-b"]);
    }

    #[test]
    fn state_stays_bounded() {
        let mut k: KeyNames<u8> = KeyNames::new(4, 2);
        for obj in 1..20usize {
            k.opened(obj, 0, "", RUN);
        }
        assert!(k.len() <= 4);
        let t0 = Instant::now();
        for obj in 1..10usize {
            k.park(obj, 0, t0);
        }
        assert_eq!(k.expire(t0 + PARK_FOR).len(), 2);
    }
}
