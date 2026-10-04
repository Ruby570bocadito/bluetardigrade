// ntpath.rs: image paths of processes that are already gone.
//
// The kernel process event carries no path, and a short-lived process
// (reg.exe, whoami.exe, a script's conhost) has exited by the time the
// collector can ask for its image: ETW delivers in ~1 s buffers.
// Microsoft-Windows-Kernel-Process event 1 (ProcessStart) does carry the
// image, as an NT path ("\Device\HarddiskVolume3\Windows\System32\
// whoami.exe"). This module turns those paths into the Win32 form every
// other source reports (Sysmon, QueryFullProcessImageNameW) and keeps the
// recent ones by PID for the collector. Platform-independent so it is
// unit-tested on any host; the device map is read on Windows.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// NT device prefixes and the drive letters they are mounted as.
pub struct DeviceMap {
    // ("\device\harddiskvolume3", "C:") — device lowercased for matching
    drives: Vec<(String, String)>,
    system_root: String,
}

impl DeviceMap {
    pub fn new(drives: Vec<(String, String)>, system_root: &str) -> Self {
        let drives = drives.into_iter().map(|(dev, letter)| (dev.trim_end_matches('\\').to_ascii_lowercase(), letter)).collect();
        DeviceMap { drives, system_root: system_root.trim_end_matches('\\').to_string() }
    }

    /// Win32 form of an NT path, or None when no mapping applies.
    pub fn to_dos(&self, nt: &str) -> Option<String> {
        let p = nt.trim().trim_matches(char::from(0));
        if p.is_empty() {
            return None;
        }
        // already Win32: "C:\..."
        if p.len() >= 3 && p.as_bytes()[1] == b':' && p.as_bytes()[2] == b'\\' {
            return Some(p.to_string());
        }
        if let Some(rest) = strip_ci(p, "\\??\\") {
            if let Some(unc) = strip_ci(rest, "UNC\\") {
                return Some(format!("\\\\{unc}"));
            }
            return Some(rest.to_string());
        }
        if let Some(rest) = strip_ci(p, "\\SystemRoot") {
            if !self.system_root.is_empty() && (rest.is_empty() || rest.starts_with('\\')) {
                return Some(format!("{}{rest}", self.system_root));
            }
        }
        if let Some(rest) = strip_ci(p, "\\Device\\Mup\\") {
            return Some(format!("\\\\{rest}"));
        }
        for (dev, letter) in &self.drives {
            if let Some(rest) = strip_ci(p, dev) {
                if rest.is_empty() || rest.starts_with('\\') {
                    return Some(format!("{letter}{rest}"));
                }
            }
        }
        None
    }
}

fn strip_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &s[prefix.len()..])
}

/// Image paths of recently started processes, by PID. Bounded: entries
/// older than the retention are dropped when the map is full.
pub struct RecentImages {
    cap: usize,
    keep: Duration,
    map: HashMap<u32, (String, Instant)>,
}

impl RecentImages {
    pub fn new(cap: usize, keep: Duration) -> Self {
        RecentImages { cap, keep, map: HashMap::new() }
    }

    pub fn insert(&mut self, pid: u32, path: String, now: Instant) {
        if self.map.len() >= self.cap && !self.map.contains_key(&pid) {
            let keep = self.keep;
            self.map.retain(|_, (_, at)| now.duration_since(*at) < keep);
            if self.map.len() >= self.cap {
                self.map.clear();
            }
        }
        self.map.insert(pid, (path, now));
    }

    /// The image recorded for pid within the retention.
    pub fn get(&self, pid: u32, now: Instant) -> Option<String> {
        self.map
            .get(&pid)
            .filter(|(_, at)| now.duration_since(*at) < self.keep)
            .map(|(path, _)| path.clone())
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.map.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map() -> DeviceMap {
        DeviceMap::new(
            vec![
                ("\\Device\\HarddiskVolume3".into(), "C:".into()),
                ("\\Device\\HarddiskVolume31".into(), "E:".into()),
            ],
            r"C:\WINDOWS",
        )
    }

    #[test]
    fn nt_paths_become_win32_paths() {
        let m = map();
        assert_eq!(m.to_dos(r"\Device\HarddiskVolume3\Windows\System32\whoami.exe").as_deref(), Some(r"C:\Windows\System32\whoami.exe"));
        assert_eq!(m.to_dos(r"\device\harddiskvolume3\x.exe").as_deref(), Some(r"C:\x.exe"));
        // a longer volume number is not mistaken for a shorter one
        assert_eq!(m.to_dos(r"\Device\HarddiskVolume31\tools\a.exe").as_deref(), Some(r"E:\tools\a.exe"));
        assert_eq!(m.to_dos(r"\Device\HarddiskVolume4\a.exe"), None);
        assert_eq!(m.to_dos(r"\??\C:\WINDOWS\system32\conhost.exe").as_deref(), Some(r"C:\WINDOWS\system32\conhost.exe"));
        assert_eq!(m.to_dos(r"\??\UNC\srv\share\tool.exe").as_deref(), Some(r"\\srv\share\tool.exe"));
        assert_eq!(m.to_dos(r"\Device\Mup\srv\share\tool.exe").as_deref(), Some(r"\\srv\share\tool.exe"));
        assert_eq!(m.to_dos(r"\SystemRoot\System32\smss.exe").as_deref(), Some(r"C:\WINDOWS\System32\smss.exe"));
        assert_eq!(m.to_dos(r"C:\Program Files\app.exe").as_deref(), Some(r"C:\Program Files\app.exe"));
        assert_eq!(m.to_dos(""), None);
        assert_eq!(m.to_dos("Registry"), None);
    }

    #[test]
    fn recent_images_expire_and_stay_bounded() {
        let t0 = Instant::now();
        let mut r = RecentImages::new(3, Duration::from_secs(30));
        r.insert(10, r"C:\a.exe".into(), t0);
        assert_eq!(r.get(10, t0 + Duration::from_secs(5)).as_deref(), Some(r"C:\a.exe"));
        assert_eq!(r.get(10, t0 + Duration::from_secs(31)), None, "expired");
        assert_eq!(r.get(11, t0), None);
        for pid in 20..30 {
            r.insert(pid, "x".into(), t0 + Duration::from_secs(60));
        }
        assert!(r.len() <= 3);
        // a reused PID gets the new image
        r.insert(29, r"C:\b.exe".into(), t0 + Duration::from_secs(61));
        assert_eq!(r.get(29, t0 + Duration::from_secs(61)).as_deref(), Some(r"C:\b.exe"));
    }
}
