// heartbeat.rs: the sensor's periodic health report (sensor.heartbeat),
// kept apart from the Windows-only collector so it is unit-tested on any
// host. The engine consumes these events into its machine inventory
// (GET /api/fleet) and never forwards them to rules or storage; a sensor
// that stops sending them raises a "Sensor sin señal" alert there.

use std::collections::BTreeMap;

/// Event type the engine's inventory consumes.
pub const TYPE_HEARTBEAT: &str = "sensor.heartbeat";

/// Seconds between heartbeats. The engine waits 3x this (at least three
/// minutes) before it declares the sensor silent.
pub const INTERVAL_SECS: u64 = 60;

/// What a heartbeat reports.
pub struct Health {
    pub kind: &'static str,
    pub version: &'static str,
    pub os: String,
    pub capture: String,
    pub interval_s: u64,
    pub uptime_s: u64,
    pub queue_cap: usize,
    pub spooled: u64,
    pub dropped: u64,
    /// "service" (Windows service manager) or "console" (started by hand)
    pub run_mode: &'static str,
}

/// Event attributes of a heartbeat (all strings, as model.Event wants).
pub fn attributes(h: &Health) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    out.insert("sensor_kind".into(), h.kind.into());
    out.insert("sensor_version".into(), h.version.into());
    if !h.os.is_empty() {
        out.insert("os".into(), h.os.clone());
    }
    out.insert("capture".into(), h.capture.clone());
    out.insert("interval_s".into(), h.interval_s.to_string());
    out.insert("uptime_s".into(), h.uptime_s.to_string());
    out.insert("queue_cap".into(), h.queue_cap.to_string());
    out.insert("spooled".into(), h.spooled.to_string());
    out.insert("dropped".into(), h.dropped.to_string());
    out.insert("run_mode".into(), h.run_mode.into());
    out
}

/// "Windows 11 Pro 24H2 (26100)" from the registry's ProductName,
/// DisplayVersion and CurrentBuildNumber; missing parts are skipped.
pub fn os_label(product: Option<&str>, display_version: Option<&str>, build: Option<&str>) -> String {
    let mut label = String::new();
    if let Some(p) = clean(product) {
        // Windows 11 still reports "Windows 10" in ProductName; build
        // 22000 and later is Windows 11
        let is_11 = clean(build).and_then(|b| b.parse::<u32>().ok()).is_some_and(|b| b >= 22000);
        if is_11 && p.starts_with("Windows 10") {
            label.push_str(&p.replacen("Windows 10", "Windows 11", 1));
        } else {
            label.push_str(p);
        }
    }
    if let Some(v) = clean(display_version) {
        if !label.is_empty() {
            label.push(' ');
        }
        label.push_str(v);
    }
    if let Some(b) = clean(build) {
        if !label.is_empty() {
            label.push(' ');
        }
        label.push_str(&format!("({b})"));
    }
    label
}

fn clean(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wire_contract_matches_the_engine() {
        // internal/fleet: fleet.HeartbeatType, and intervals outside
        // 1..=3600 s fall back to 60 s there
        assert_eq!(TYPE_HEARTBEAT, "sensor.heartbeat");
        assert!((1..=3600).contains(&INTERVAL_SECS));
    }

    #[test]
    fn attributes_carry_every_health_field() {
        let a = attributes(&Health {
            kind: "etw",
            version: "0.1.0",
            os: "Windows 11 Pro 24H2 (26100)".into(),
            capture: "process+network+registry".into(),
            interval_s: 60,
            uptime_s: 3600,
            queue_cap: 50_000,
            spooled: 3,
            dropped: 0,
            run_mode: "service",
        });
        assert_eq!(a["sensor_kind"], "etw");
        assert_eq!(a["interval_s"], "60");
        assert_eq!(a["queue_cap"], "50000");
        assert_eq!(a["spooled"], "3");
        assert_eq!(a["os"], "Windows 11 Pro 24H2 (26100)");
        assert_eq!(a["run_mode"], "service");
        assert_eq!(a.len(), 10);
    }

    #[test]
    fn empty_os_is_omitted() {
        let a = attributes(&Health { kind: "etw", version: "x", os: String::new(), capture: "process".into(), interval_s: 60, uptime_s: 0, queue_cap: 1, spooled: 0, dropped: 0, run_mode: "console" });
        assert!(!a.contains_key("os"));
    }

    #[test]
    fn os_label_fixes_windows_11_and_skips_missing_parts() {
        assert_eq!(os_label(Some("Windows 10 Pro"), Some("24H2"), Some("26100")), "Windows 11 Pro 24H2 (26100)");
        assert_eq!(os_label(Some("Windows 10 Pro"), Some("22H2"), Some("19045")), "Windows 10 Pro 22H2 (19045)");
        assert_eq!(os_label(Some("Windows Server 2022 Standard"), None, Some("20348")), "Windows Server 2022 Standard (20348)");
        assert_eq!(os_label(None, None, Some("26100")), "(26100)");
        assert_eq!(os_label(Some("  "), None, None), "");
    }
}
