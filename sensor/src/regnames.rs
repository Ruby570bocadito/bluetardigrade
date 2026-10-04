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
// Platform-independent so it is unit-tested on any host; the collector
// feeds it from the ETW callbacks.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How long a write whose key is unknown waits for the key's CloseKey.
pub const PARK_FOR: Duration = Duration::from_secs(5);

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
    pub fn opened(&mut self, key_object: usize, base_object: usize, base_name: &str, relative_name: &str) {
        if key_object == 0 {
            return;
        }
        let Some(full) = self.resolve(base_object, base_name, relative_name) else {
            return;
        };
        if self.names.len() >= self.cap && !self.names.contains_key(&key_object) {
            // forget everything rather than track recency: keys opened
            // again are named again
            self.names.clear();
        }
        self.names.insert(key_object, full);
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
        }?;
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
        // unknown base, no base name: nothing to remember
        k.opened(0x40, 0x77, "", r"Software\x");
        assert_eq!(k.name_of(0x40), None);
        assert_eq!(k.name_of(0), None);
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
