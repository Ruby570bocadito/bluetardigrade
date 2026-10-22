// Tuning constants and the run configuration structs. Everything the
// ETW sessions filter, cap or name lives here so the numbers stay in
// one place; the collector's submodules reach them through
// `super::config`.

use std::path::PathBuf;
use std::time::Duration;

/// Kernel Process opcodes: 1 Start, 2 End, 3/4 rundown of processes
/// already running when the session starts or stops.
pub(super) const OPCODE_PROCESS_START: u8 = 1;
pub(super) const OPCODE_PROCESS_END: u8 = 2;
pub(super) const OPCODE_PROCESS_DC_START: u8 = 3;
pub(super) const OPCODE_PROCESS_DC_END: u8 = 4;

/// Session names (Windows 8+; older systems force "NT Kernel Logger").
pub(super) const SESSION_NAME: &str = "bluetardigrade-sensor";
pub(super) const NETREG_SESSION_NAME: &str = "bluetardigrade-sensor-netreg";
pub(super) const FILE_SESSION_NAME: &str = "bluetardigrade-sensor-file";

pub(super) const KERNEL_NETWORK: &str = "7dd42a49-5329-4832-8dfd-43d979153a88";
/// KERNEL_NETWORK_KEYWORD_IPV4 | KERNEL_NETWORK_KEYWORD_IPV6
pub(super) const KERNEL_NETWORK_KEYWORDS: u64 = 0x10 | 0x20;
/// TCPv4 / TCPv6 "connection attempted".
pub(super) const EVENT_TCP4_CONNECT: u16 = 12;
pub(super) const EVENT_TCP6_CONNECT: u16 = 28;

pub(super) const KERNEL_REGISTRY: &str = "70eb4f03-c1de-4f73-a051-33d13d5413bd";
pub(super) const EVENT_REG_CREATE_KEY: u16 = 1;
pub(super) const EVENT_REG_OPEN_KEY: u16 = 2;
pub(super) const EVENT_REG_SET_VALUE: u16 = 5;
pub(super) const EVENT_REG_CLOSE_KEY: u16 = 13;
/// CloseKey | SetValueKey | CreateKey | OpenKey keywords: the write and
/// the events that name its key.
pub(super) const KERNEL_REGISTRY_KEYWORDS: u64 = 0x1 | 0x100 | 0x1000 | 0x2000;
/// Key handles remembered by name, and writes waiting for their key.
pub(super) const REGISTRY_NAMES_CAP: usize = 65_536;
pub(super) const REGISTRY_PARKED_CAP: usize = 4096;

pub(super) const DNS_CLIENT: &str = "1c95126e-7eea-49a9-a3fe-a378b03ddb4d";
/// DNS-Client reports some queries first with this status (invalid
/// parameter) and no answer, then again with the result: the first is
/// not a resolution outcome and is ignored.
pub(super) const DNS_STATUS_INVALID_PARAMETER: u32 = 87;

/// Microsoft-Windows-Kernel-Process: event 1 (ProcessStart) carries the
/// image path, so short-lived processes get one too.
pub(super) const KERNEL_PROCESS: &str = "22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716";
/// WINEVENT_KEYWORD_PROCESS
pub(super) const KERNEL_PROCESS_KEYWORD: u64 = 0x10;
pub(super) const EVENT_KP_PROCESS_START: u16 = 1;

/// Microsoft-Windows-Kernel-File (S-2): file writes for the YARA scanner.
/// Event 12 (Create) carries the FileName the write event (16) only
/// references by FileObject, exactly like the registry writes above.
pub(super) const KERNEL_FILE: &str = "edd08927-9cc4-4e65-b970-c2560fb5c289";
/// FILEIO | CREATE | WRITE: the events that name file objects and the
/// writes on them. Nothing else of the provider is enabled.
pub(super) const KERNEL_FILE_KEYWORDS: u64 = 0x20 | 0x80 | 0x200;
pub(super) const EVENT_FILE_CREATE: u16 = 12;
pub(super) const EVENT_FILE_WRITE: u16 = 16;
/// File objects remembered by name (a busy host churns through file
/// objects; the map forgets everything once this is exceeded, the same
/// policy as the registry key names).
pub(super) const FILE_NAMES_CAP: usize = 65_536;
/// File writes waiting for the YARA worker (files, not bytes: the worker
/// stats and dedupes before reading anything).
pub(super) const YARA_QUEUE: usize = 512;
/// Images kept per PID, for how long, and how long the enrichment thread
/// waits for the image of a process that exited before it was read.
pub(super) const RECENT_IMAGES_CAP: usize = 8192;
pub(super) const RECENT_IMAGES_KEEP: Duration = Duration::from_secs(120);
pub(super) const IMAGE_WAIT: Duration = Duration::from_secs(2);
/// "DNS query is completed": name, status and answers, in the context
/// of the process that asked.
pub(super) const EVENT_DNS_QUERY_COMPLETED: u16 = 3008;

/// Image hashing: binaries remembered, the largest file hashed, and the
/// process starts that may wait for the enrichment thread.
pub(super) const HASH_CACHE_CAP: usize = 4096;
pub(super) const HASH_MAX_BYTES: u64 = 100 << 20;
pub(super) const ENRICH_QUEUE: usize = 2048;

/// Names kept for PID lookups (a busy host runs a few hundred processes;
/// the table only forgets once this is exceeded).
pub(super) const PROCESS_TABLE_CAP: usize = 8192;

/// Delivery settings: the bounded queue between the ETW threads and the
/// network, and the optional on-disk spool behind it (see queue.rs).
pub struct Delivery {
    pub queue_cap: usize,
    pub spool: Option<PathBuf>,
    pub spool_max_bytes: u64,
}

/// Which telemetry beyond process creation to capture.
pub struct Capture {
    pub network: bool,
    pub registry: bool,
    /// forward every SetValueKey instead of the detection-relevant keys
    pub registry_all: bool,
    /// DNS queries (and the domain of TCP connections)
    pub dns: bool,
    /// SHA-256 of the image of each process start
    pub hash: bool,
    /// YARA scanning of written files (Some: on, with its rules
    /// directory, size cap and exclusions; None: no file session at all)
    pub yara: Option<crate::yara::YaraConfig>,
    /// YARA memory sweeps on top of the file scanner (--yara-mem): the
    /// cadence and the per-process budget (memscan.rs). Some needs yara
    /// Some too — without rules nothing is ever loaded to scan with.
    pub yara_mem: Option<crate::memscan::MemConfig>,
    /// print how registry keys containing this fragment are named
    /// (diagnostics for the key-name resolution)
    pub debug_registry: Option<String>,
    /// running under the Windows service manager (no console: no Ctrl+C
    /// handler; the heartbeat reports it)
    pub as_service: bool,
}
