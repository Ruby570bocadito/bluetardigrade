// normalize.rs: maps raw telemetry to the unified event schema shared
// with the Go engine (docs/architecture, chapter 4). Field names and
// nesting must stay byte-compatible with pkg/model/model.go.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

// phase 1: consumed by the image-hash enrichment of the collector
#[allow(dead_code)]
#[derive(Serialize, Clone, Debug)]
pub struct HashesJson(pub serde_json::Map<String, serde_json::Value>);

#[derive(Serialize, Clone, Debug)]
pub struct ProcessJson {
    pub pid: i32,
    #[serde(skip_serializing_if = "is_zero")]
    pub ppid: i32,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hashes: Option<HashesJson>,
}

// phase 1: consumed by the Kernel-Network provider
#[allow(dead_code)]
#[derive(Serialize, Clone, Debug)]
pub struct NetworkJson {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ip: Option<String>,
    #[serde(skip_serializing_if = "is_zero")]
    pub source_port: i32,
    pub destination_ip: String,
    #[serde(skip_serializing_if = "is_zero")]
    pub destination_port: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct EventJson {
    pub id: String,
    // RFC3339. Two emitters share this field: the collector formats the
    // ETW record's own time via the time crate (variable subsecond
    // digits, trailing zeros trimmed — the same style as Go's
    // RFC3339Nano used across the engine) and the fallback wall clock
    // here (fixed 9 digits). Go's time.Time JSON unmarshal accepts both.
    pub timestamp: String,
    pub r#type: String,
    pub source: String,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process: Option<ProcessJson>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<NetworkJson>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

pub const TYPE_PROCESS_CREATE: &str = "process.create";
// phase 1: emitted by the ProcessStop callback of the collector
#[allow(dead_code)]
pub const TYPE_PROCESS_TERMINATE: &str = "process.terminate";
// phase 1: emitted by the Kernel-Network provider
#[allow(dead_code)]
pub const TYPE_NETWORK_CONNECT: &str = "network.connect";

pub fn now_rfc3339() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let nanos = now.subsec_nanos();
    // RFC3339 without external crates: compute UTC date from unix time.
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}.{nanos:09}Z")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn new_uuid() -> String {
    // RFC 4122 v4: 122 bits of OS entropy via getrandom, with the
    // version/variant bits set per spec. The clock-seeded PRNG below is
    // only a fallback for the (practically impossible) case of the OS
    // entropy source failing; it keeps the sensor able to emit
    // well-formed ids instead of panicking in the ETW callback.
    let mut b = [0u8; 16];
    if getrandom::fill(&mut b).is_ok() {
        b[6] = (b[6] & 0x0f) | 0x40; // version 4
        b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
        return format!(
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
            b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
        );
    }
    clock_prng_uuid()
}

fn clock_prng_uuid() -> String {
    // v4-shaped id from a xorshift64* seeded by the clock. Fallback
    // only: predictable and collision-prone under concurrent callbacks,
    // which is exactly why getrandom is the primary path.
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15)
        | 1;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let a = next();
    let b = next();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (a >> 32) as u32,
        ((a >> 16) & 0xffff) as u16,
        (a & 0x0fff) as u16,
        (0x8000 | ((b >> 48) & 0x0fff)) as u16,
        b & 0xffff_ffff_ffff
    )
}

fn is_zero(v: &i32) -> bool {
    *v == 0
}
