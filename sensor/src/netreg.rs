// netreg.rs: platform-independent decoding for the network and registry
// events (Microsoft-Windows-Kernel-Network and -Kernel-Registry), kept
// apart from the Windows-only collector so it is unit-tested on any host.
//
//   - ports: TDH_OUTTYPE_PORT fields are 16-bit values in network byte
//     order, while ferrisetw reads integers in native order.
//   - registry paths: the kernel reports object paths
//     (\REGISTRY\MACHINE\..., \REGISTRY\USER\<SID>\...); they are mapped
//     to the hive names Sysmon uses (HKLM\..., HKU\<SID>\...), so the
//     same rules match both sensors. The per-user classes hive
//     (<SID>_Classes) is shown as HKU\<SID>\Software\Classes, the view
//     every HKCU\Software\Classes rule is written against.
//   - registry values: rendered like Sysmon's Details field
//     ("DWORD (0x00000001)", strings as text, "Binary Data").
//   - the registry filter: SetValueKey fires thousands of times per
//     second on a busy host; only the keys detections look at are
//     forwarded (persistence, defense evasion, privilege escalation).

use std::collections::HashMap;
use std::net::IpAddr;

/// A TDH "Port" field read in native byte order -> the real port.
pub fn port_from_wire(raw: u16) -> u16 {
    u16::from_be(raw)
}

/// Loopback traffic (local services talking to each other, the sensor
/// reaching a local engine) is not forwarded.
pub fn is_loopback(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback()),
    }
}

/// Kernel registry object path -> Sysmon-style hive path.
pub fn registry_path(kernel: &str) -> String {
    let path = kernel.trim_end_matches('\\');
    if let Some(rest) = strip_prefix_ci(path, "\\REGISTRY\\MACHINE") {
        return format!("HKLM{rest}");
    }
    if let Some(rest) = strip_prefix_ci(path, "\\REGISTRY\\USER") {
        // rest = "" | "\<SID>" | "\<SID>\..." | "\<SID>_Classes\..."
        let rest = rest.trim_start_matches('\\');
        if rest.is_empty() {
            return "HKU".to_string();
        }
        let (hive, tail) = match rest.find('\\') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        if let Some(sid) = strip_suffix_ci(hive, "_Classes") {
            return format!("HKU\\{sid}\\Software\\Classes{tail}");
        }
        return format!("HKU\\{hive}{tail}");
    }
    path.to_string()
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    if !head.eq_ignore_ascii_case(prefix) {
        return None;
    }
    let rest = &s[prefix.len()..];
    // a path boundary must follow ("\REGISTRY\MACHINEX" is not HKLM)
    (rest.is_empty() || rest.starts_with('\\')).then_some(rest)
}

fn strip_suffix_ci<'a>(s: &'a str, suffix: &str) -> Option<&'a str> {
    let cut = s.len().checked_sub(suffix.len())?;
    let tail = s.get(cut..)?;
    tail.eq_ignore_ascii_case(suffix).then(|| &s[..cut])
}

const REG_SZ: u32 = 1;
const REG_EXPAND_SZ: u32 = 2;
const REG_BINARY: u32 = 3;
const REG_DWORD: u32 = 4;
const REG_MULTI_SZ: u32 = 7;
const REG_QWORD: u32 = 11;

/// Registry value data (the event's captured prefix) as Sysmon renders it.
pub fn registry_value(reg_type: u32, data: &[u8]) -> Option<String> {
    match reg_type {
        REG_SZ | REG_EXPAND_SZ => Some(utf16_until_nul(data)),
        REG_MULTI_SZ => {
            let joined = utf16_lossy(data);
            let parts: Vec<&str> = joined.split('\0').filter(|s| !s.is_empty()).collect();
            Some(parts.join(" "))
        }
        REG_DWORD if data.len() >= 4 => {
            let v = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
            Some(format!("DWORD (0x{v:08x})"))
        }
        REG_QWORD if data.len() >= 8 => {
            let lo = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
            let hi = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
            Some(format!("QWORD (0x{hi:08x}-0x{lo:08x})"))
        }
        REG_BINARY => Some("Binary Data".to_string()),
        _ => None,
    }
}

fn utf16_lossy(data: &[u8]) -> String {
    let units: Vec<u16> = (0..data.len() / 2).map(|i| u16::from_le_bytes([data[2 * i], data[2 * i + 1]])).collect();
    String::from_utf16_lossy(&units)
}

fn utf16_until_nul(data: &[u8]) -> String {
    let text = utf16_lossy(data);
    match text.find('\0') {
        Some(i) => text[..i].to_string(),
        None => text,
    }
}

/// Key fragments (lowercase) whose writes detections look at.
const KEY_MARKERS: &[&str] = &[
    "\\currentversion\\run",                // Run, RunOnce, RunServices...
    "\\explorer\\run",                      // Policies\Explorer\Run
    "\\image file execution options\\",     // IFEO debugger / GlobalFlag
    "\\silentprocessexit\\",                // monitor process persistence
    "\\winlogon",                           // Userinit / Shell hijack
    "\\windows defender",                   // exclusions and policy kill switches
    "\\powershell\\",                       // script block / module logging policy
    "\\control\\terminal server",           // RDP enabled (fDenyTSConnections)
    "\\control\\lsa",                       // LSA protection, WDigest, auth packages
    "\\wdigest",                            // UseLogonCredential
    "\\shell\\open\\command",               // UAC bypass via handler hijack
    "\\shell\\runas\\command",
    "\\explorer\\user shell folders",       // startup folder redirection
    "\\windows nt\\currentversion\\windows", // AppInit_DLLs / Load
];

/// Value names that matter anywhere under the noisier service keys.
const SERVICE_VALUES: &[&str] = &["imagepath", "servicedll", "failurecommand"];

/// Whether a SetValueKey on (key, value name) is worth forwarding.
/// `key` is the normalized hive path.
pub fn interesting_registry(key: &str, value_name: &str) -> bool {
    let key = key.to_ascii_lowercase();
    if KEY_MARKERS.iter().any(|m| key.contains(m)) {
        return true;
    }
    let value = value_name.to_ascii_lowercase();
    if key.contains("\\currentcontrolset\\services\\") || key.contains("\\controlset001\\services\\") {
        return SERVICE_VALUES.contains(&value.as_str());
    }
    // logon scripts live under the user's Environment key
    value == "userinitmprlogonscript"
}

/// PID -> process name, fed by the kernel process start and rundown
/// events, so network and registry events (which only carry a PID) get
/// a name. Bounded: past the cap the oldest half is forgotten.
pub struct ProcessTable {
    cap: usize,
    names: HashMap<u32, (u64, String)>,
    tick: u64,
}

impl ProcessTable {
    pub fn new(cap: usize) -> Self {
        Self { cap: cap.max(16), names: HashMap::new(), tick: 0 }
    }

    pub fn insert(&mut self, pid: u32, name: String) {
        if name.is_empty() {
            return;
        }
        self.tick += 1;
        self.names.insert(pid, (self.tick, name));
        if self.names.len() > self.cap {
            let mut ticks: Vec<u64> = self.names.values().map(|(t, _)| *t).collect();
            ticks.sort_unstable();
            let cutoff = ticks[ticks.len() / 2];
            self.names.retain(|_, (t, _)| *t > cutoff);
        }
    }

    pub fn remove(&mut self, pid: u32) {
        self.names.remove(&pid);
    }

    /// Known name, or "pid <n>" so the event still reads.
    pub fn name(&self, pid: u32) -> String {
        match self.names.get(&pid) {
            Some((_, name)) => name.clone(),
            None if pid == 4 => "System".to_string(),
            None => format!("pid {pid}"),
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.names.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn ports_are_network_order() {
        // 443 = 0x01bb arrives as bytes 01 bb -> native LE read 0xbb01
        assert_eq!(port_from_wire(u16::from_ne_bytes([0x01, 0xbb])), 443);
        assert_eq!(port_from_wire(u16::from_ne_bytes([0x00, 0x50])), 80);
    }

    #[test]
    fn loopback_in_every_form_is_dropped() {
        assert!(is_loopback(&IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(is_loopback(&IpAddr::V4(Ipv4Addr::new(127, 8, 9, 10))));
        assert!(is_loopback(&IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(is_loopback(&IpAddr::V6(Ipv4Addr::new(127, 0, 0, 1).to_ipv6_mapped())));
        assert!(!is_loopback(&IpAddr::V4(Ipv4Addr::new(185, 220, 101, 47))));
    }

    #[test]
    fn registry_paths_use_sysmon_hive_names() {
        assert_eq!(
            registry_path("\\REGISTRY\\MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"),
            "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"
        );
        assert_eq!(
            registry_path("\\Registry\\User\\S-1-5-21-1-2-3-1001\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce\\"),
            "HKU\\S-1-5-21-1-2-3-1001\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"
        );
        assert_eq!(
            registry_path("\\REGISTRY\\USER\\S-1-5-21-1-2-3-1001_Classes\\ms-settings\\shell\\open\\command"),
            "HKU\\S-1-5-21-1-2-3-1001\\Software\\Classes\\ms-settings\\shell\\open\\command"
        );
        assert_eq!(registry_path("\\REGISTRY\\USER"), "HKU");
        assert_eq!(registry_path("\\REGISTRY\\MACHINEX\\foo"), "\\REGISTRY\\MACHINEX\\foo");
        assert_eq!(registry_path("relative\\key"), "relative\\key");
    }

    #[test]
    fn values_render_like_sysmon_details() {
        let sz: Vec<u8> = "C:\\Users\\Public\\p.exe\0junk".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(registry_value(1, &sz).as_deref(), Some("C:\\Users\\Public\\p.exe"));
        assert_eq!(registry_value(4, &[0, 0, 0, 0]).as_deref(), Some("DWORD (0x00000000)"));
        assert_eq!(registry_value(4, &[1, 0, 0, 0]).as_deref(), Some("DWORD (0x00000001)"));
        assert_eq!(registry_value(11, &[1, 0, 0, 0, 2, 0, 0, 0]).as_deref(), Some("QWORD (0x00000002-0x00000001)"));
        assert_eq!(registry_value(3, &[0xde, 0xad]).as_deref(), Some("Binary Data"));
        let multi: Vec<u8> = "a\0b\0\0".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(registry_value(7, &multi).as_deref(), Some("a b"));
        assert_eq!(registry_value(4, &[1, 0]), None, "a truncated DWORD is not invented");
        assert_eq!(registry_value(99, &[1]), None);
    }

    #[test]
    fn the_filter_keeps_what_rules_read_and_drops_noise() {
        let keep = [
            ("HKU\\S-1\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "updater"),
            ("HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\sethc.exe", "Debugger"),
            ("HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Exclusions\\Paths", "C:\\x"),
            ("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server", "fDenyTSConnections"),
            ("HKU\\S-1\\Software\\Classes\\ms-settings\\shell\\open\\command", "DelegateExecute"),
            ("HKLM\\SYSTEM\\CurrentControlSet\\Services\\evil", "ImagePath"),
            ("HKU\\S-1\\Environment", "UserInitMprLogonScript"),
        ];
        for (key, value) in keep {
            assert!(interesting_registry(key, value), "{key} {value}");
        }
        let drop = [
            ("HKLM\\SYSTEM\\CurrentControlSet\\Services\\bam\\State\\UserSettings\\S-1", "\\Device\\x.exe"),
            ("HKU\\S-1\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs", "MRUListEx"),
            ("HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer", "x"),
        ];
        for (key, value) in drop {
            assert!(!interesting_registry(key, value), "{key} {value}");
        }
        // a key opened under a base the sensor never saw (regnames.rs)
        assert!(interesting_registry(r"?\Software\Microsoft\Windows\CurrentVersion\Run", "x"));
        assert_eq!(registry_path(r"?\Software\Microsoft\Windows\CurrentVersion\Run"), r"?\Software\Microsoft\Windows\CurrentVersion\Run");
    }

    #[test]
    fn the_process_table_names_and_stays_bounded() {
        let mut table = ProcessTable::new(16);
        table.insert(100, "powershell.exe".into());
        assert_eq!(table.name(100), "powershell.exe");
        assert_eq!(table.name(4), "System");
        assert_eq!(table.name(7), "pid 7");
        table.insert(101, String::new());
        assert_eq!(table.name(101), "pid 101", "an empty name is not recorded");
        table.remove(100);
        assert_eq!(table.name(100), "pid 100");
        for pid in 0..100 {
            table.insert(1000 + pid, format!("p{pid}.exe"));
        }
        assert!(table.len() <= 16);
        assert_eq!(table.name(1099), "p99.exe", "the newest entries survive");
    }
}
