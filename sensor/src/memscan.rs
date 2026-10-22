// memscan.rs: per-process YARA memory scanning (S-2). DIR's published
// decision for the memory half of the sensor side of S-2<->M-3: scan PER
// PROCESS — the sensor enumerates the running processes and scans each
// one's committed memory separately. Attribution is then trivial: every
// match names the PID and the image name of the process it was found in,
// there is no global memory view to reconcile, and the noise and the
// correlation stay on the engine's side (the same honesty as the file
// scanner: the sensor reports evidence, the engine decides).
//
//   - A sweep walks the process list (Toolhelp snapshot), opens each
//     process for limited query + read, walks its committed readable
//     regions (VirtualQueryEx), reads each region whole (ReadProcessMemory)
//     and scans the buffer with the same compiled rules the file worker
//     owns (shared through the worker's rules slot: one compiler, two
//     consumers). Guard pages are never read (a read would clear the
//     guard in the target) and unreadable regions are simply not read.
//   - Budgets and honesty, the repo's usual discipline: a region bigger
//     than the process's remaining budget is skipped, never scanned
//     truncated (a partial scan would report hits it cannot vouch for);
//     per-process budget defaults to 512 MiB (--yara-mem-max-mb). A
//     process that already produced MAX_PROCESS_EVENTS match events in
//     one sweep stops there (named on stderr): 64 distinct region matches
//     are a full verdict, more is a broken rule.
//   - The sensor never scans itself: the file worker's heap holds the
//     bytes of files it just scanned, so a memory sweep of the sensor's
//     own PID would echo every recent file hit back as a memory hit.
//
// Hits go out as yara.match events with the process (pid, name) filled
// and no file field, plus the yara_mem_* attributes naming the region
// (base, size, protection). The engine stores them as evidence like any
// yara.match; nothing on its side requires the file field.
//
// Two entry points share the core: the periodic sweep thread (--yara-mem,
// every --yara-mem-every minutes) and the on-demand `scan --memory`
// subcommand. The Windows API calls are compiled only on Windows; the
// region policy, the event shape and the defaults are platform-independent
// and unit-tested on any host.

use crate::normalize::{EventJson, ProcessJson, TYPE_YARA_MATCH};
use crate::yara::Hit;
use std::collections::BTreeMap;
use std::time::Duration;

/// Windows memory constants (windows-sys names them only under cfg;
/// the policy must be testable on any host).
pub const MEM_COMMIT: u32 = 0x1000;
pub const PAGE_NOACCESS: u32 = 0x01;
pub const PAGE_READONLY: u32 = 0x02;
pub const PAGE_READWRITE: u32 = 0x04;
pub const PAGE_WRITECOPY: u32 = 0x08;
pub const PAGE_EXECUTE: u32 = 0x10;
pub const PAGE_EXECUTE_READ: u32 = 0x20;
pub const PAGE_EXECUTE_READWRITE: u32 = 0x40;
pub const PAGE_EXECUTE_WRITECOPY: u32 = 0x80;
pub const PAGE_GUARD: u32 = 0x100;

/// Match events one process may produce per sweep before the rest of its
/// memory is left unscanned (named on stderr, never silent). Enforced by
/// the Windows scan loop only.
#[cfg(target_os = "windows")]
pub const MAX_PROCESS_EVENTS: usize = 64;

/// Default sweep cadence (--yara-mem-every) and per-process budget
/// (--yara-mem-max-mb). main.rs's flag defaults are the literals these
/// two pin in a test, like yara::MAX_FILE_BYTES_DEFAULT does.
pub const SWEEP_EVERY_DEFAULT_MINUTES: u64 = 15;
pub const MAX_PROCESS_BYTES_DEFAULT: u64 = 512 << 20;

/// Sweep cadence bounds: one minute (a lab) to one day (a quiet host).
pub const SWEEP_EVERY_MIN_MINUTES: u64 = 1;
pub const SWEEP_EVERY_MAX_MINUTES: u64 = 1440;

/// The memory scanner's settings, handed over with the Capture config
/// (and to the on-demand `scan --memory`, which needs no cadence).
#[derive(Clone)]
pub struct MemConfig {
    /// Time between sweeps (clamped to SWEEP_EVERY bounds by new()).
    pub every: Duration,
    /// Regions are read whole; a region bigger than a process's
    /// remaining budget is skipped, not scanned truncated.
    pub max_process_bytes: u64,
}

impl MemConfig {
    /// Builds the settings from main()'s flags: the cadence lands inside
    /// the SWEEP_EVERY bounds no matter what was typed (a lab can ask for
    /// one minute, nobody waits less; a day is the slowest honest sweep).
    pub fn new(every_minutes: u64, max_process_bytes: u64) -> Self {
        let minutes = every_minutes.clamp(SWEEP_EVERY_MIN_MINUTES, SWEEP_EVERY_MAX_MINUTES);
        MemConfig {
            every: Duration::from_secs(minutes * 60),
            max_process_bytes,
        }
    }
}

impl Default for MemConfig {
    fn default() -> Self {
        MemConfig {
            every: Duration::from_secs(SWEEP_EVERY_DEFAULT_MINUTES * 60),
            max_process_bytes: MAX_PROCESS_BYTES_DEFAULT,
        }
    }
}

/// True when a committed region is safe and useful to read: committed
/// (reserved or free memory has no content), readable (execute-only
/// pages cannot be read back), not a guard page (reading one would clear
/// the guard in the target process — the sensor observes, never
/// perturbs) and not PAGE_NOACCESS.
pub fn region_readable(state: u32, protect: u32) -> bool {
    if state != MEM_COMMIT {
        return false;
    }
    if protect & PAGE_GUARD != 0 || protect & PAGE_NOACCESS != 0 {
        return false;
    }
    let readable = PAGE_READONLY
        | PAGE_READWRITE
        | PAGE_WRITECOPY
        | PAGE_EXECUTE_READ
        | PAGE_EXECUTE_READWRITE
        | PAGE_EXECUTE_WRITECOPY;
    protect & readable != 0
}

/// Compact protection label for the event's evidence ("rwx", "rx", "rw",
/// "r"): the letters the region's protection grants.
pub fn protect_label(protect: u32) -> String {
    let mut out = String::new();
    let readable = PAGE_READONLY
        | PAGE_READWRITE
        | PAGE_WRITECOPY
        | PAGE_EXECUTE_READ
        | PAGE_EXECUTE_READWRITE
        | PAGE_EXECUTE_WRITECOPY;
    let writable =
        PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
    let executable =
        PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
    if protect & readable != 0 {
        out.push('r');
    }
    if protect & writable != 0 {
        out.push('w');
    }
    if protect & executable != 0 {
        out.push('x');
    }
    if out.is_empty() {
        out.push_str("na");
    }
    out
}

/// The yara.match event for one memory hit: the process names the match
/// (the decision's trivial attribution), the yara_mem_* attributes name
/// the region, there is no file. Same rule evidence as the file events.
pub fn mem_hit_event(
    host: &str,
    pid: u32,
    name: &str,
    base: usize,
    bytes: usize,
    protect: u32,
    hit: &Hit,
) -> EventJson {
    let mut attributes: BTreeMap<String, String> = BTreeMap::new();
    attributes.insert("yara_rule".into(), hit.rule.clone());
    attributes.insert("yara_namespace".into(), hit.namespace.clone());
    if !hit.tags.is_empty() {
        attributes.insert("yara_tags".into(), hit.tags.join(","));
    }
    for (k, v) in hit.metas.iter().take(8) {
        attributes.insert(format!("yara_meta_{k}"), v.clone());
    }
    if !hit.strings.is_empty() {
        attributes.insert("yara_strings".into(), hit.strings.join(" | "));
    }
    attributes.insert("yara_mem_base".into(), format!("{base:#x}"));
    attributes.insert("yara_mem_size".into(), bytes.to_string());
    attributes.insert("yara_mem_prot".into(), protect_label(protect));
    EventJson {
        id: crate::normalize::new_uuid(),
        timestamp: crate::normalize::now_rfc3339(),
        r#type: TYPE_YARA_MATCH.into(),
        source: "etw".into(),
        host: host.to_string(),
        user: None,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: 0,
            name: name.to_string(),
            command_line: None,
            image: None,
            hashes: None,
        }),
        network: None,
        registry: None,
        file: None,
        attributes: Some(attributes),
        tags: vec!["sensor:yara".into()],
    }
}

/// What one sweep did, printed once on stderr (the sweep's honesty
/// summary; a heartbeat's counters are its numeric shadow).
#[derive(Default)]
pub struct SweepSummary {
    pub processes: usize,
    pub regions: usize,
    pub bytes: u64,
    pub matches: usize,
    /// regions skipped: over the process's remaining budget
    pub skipped: usize,
    /// processes (or regions) that could not be read
    pub errors: usize,
    /// processes stopped at the match-event cap
    pub capped: usize,
}

impl SweepSummary {
    pub fn line(&self) -> String {
        format!(
            "{} process(es), {} region(s), {} bytes, {} match(es), {} unreadable, {} skipped, {} capped",
            self.processes, self.regions, self.bytes, self.matches, self.errors, self.skipped, self.capped
        )
    }
}

#[cfg(target_os = "windows")]
pub use win::{scan_on_demand, start_memscan};

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use crate::yara::{LoadedRules, RulesSlot, YaraStats};
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
    use std::sync::Arc;
    use std::thread::JoinHandle;

    /// Every running process as (pid, image name), sorted by pid so a
    /// sweep is deterministic. The System Idle (0) and System (4)
    /// pseudo-processes are left out: reading them is an error by design.
    pub fn enumerate_processes() -> Vec<(u32, String)> {
        use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        // SAFETY: the snapshot handle and the PROCESSENTRY32W pointer are
        // used exactly as the Toolhelp contract requires (dwSize set
        // before the first call, the handle closed afterwards).
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
                return Vec::new();
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut out = Vec::new();
            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let pid = entry.th32ProcessID;
                    if pid != 0 && pid != 4 {
                        let len = entry
                            .szExeFile
                            .iter()
                            .position(|c| *c == 0)
                            .unwrap_or(entry.szExeFile.len());
                        let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                        if !name.is_empty() {
                            out.push((pid, name));
                        }
                    }
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            windows_sys::Win32::Foundation::CloseHandle(snapshot);
            out.sort_by_key(|(pid, _)| *pid);
            out.dedup_by_key(|(pid, _)| *pid);
            out
        }
    }

    /// One sweep over every process (or, with `only`, just those PIDs):
    /// per process, open, walk, read, scan, emit. Errors are counted and
    /// the sweep moves on — a protected process must not stop the host's
    /// memory scan.
    pub fn sweep(
        loaded: &LoadedRules,
        config: &MemConfig,
        host: &str,
        only: &[u32],
        stats: &YaraStats,
        emit: &mut dyn FnMut(EventJson),
    ) -> SweepSummary {
        let mut summary = SweepSummary::default();
        let own = std::process::id();
        for (pid, name) in enumerate_processes() {
            if pid == own {
                continue; // our own heap holds the file bytes we just scanned
            }
            if !only.is_empty() && !only.contains(&pid) {
                continue;
            }
            summary.processes += 1;
            scan_process(pid, &name, loaded, config, host, stats, emit, &mut summary);
        }
        summary
    }

    /// The on-demand entry (`scan --memory`): one sweep with the caller's
    /// PIDs filter, summary back for the subcommand's exit line.
    pub fn scan_on_demand(
        loaded: &LoadedRules,
        config: &MemConfig,
        host: &str,
        only: &[u32],
        emit: &mut dyn FnMut(EventJson),
    ) -> SweepSummary {
        let stats = YaraStats::default();
        sweep(loaded, config, host, only, &stats, emit)
    }

    #[allow(clippy::too_many_arguments)]
    fn scan_process(
        pid: u32,
        name: &str,
        loaded: &LoadedRules,
        config: &MemConfig,
        host: &str,
        stats: &YaraStats,
        emit: &mut dyn FnMut(EventJson),
        summary: &mut SweepSummary,
    ) {
        use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
        use windows_sys::Win32::System::Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
        };
        // SAFETY: every call follows the Win32 contract with pointers
        // into buffers this function owns; the handle is closed on every
        // path below.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
            if handle.is_null() {
                // protected or gone: normal for hardened processes, an
                // error counter, not a sweep failure
                summary.errors += 1;
                stats.errors.fetch_add(1, AtomicOrdering::Relaxed);
                return;
            }
            let mut remaining = config.max_process_bytes;
            let mut events = 0usize;
            let mut addr: usize = 0;
            loop {
                let mut mbi: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
                if VirtualQueryEx(
                    handle,
                    addr as *const _,
                    &mut mbi,
                    std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
                ) == 0
                {
                    break; // end of the address space
                }
                let base = mbi.BaseAddress as usize;
                let size = mbi.RegionSize;
                if size == 0 || base.saturating_add(size) <= addr {
                    break; // no progress: bail out instead of looping forever
                }
                addr = base + size;
                if !region_readable(mbi.State, mbi.Protect) {
                    continue;
                }
                if size as u64 > remaining {
                    summary.skipped += 1;
                    stats.mem_skipped.fetch_add(1, AtomicOrdering::Relaxed);
                    continue;
                }
                let mut buffer = vec![0u8; size];
                let mut read = 0usize;
                if ReadProcessMemory(
                    handle,
                    base as *const _,
                    buffer.as_mut_ptr().cast(),
                    size,
                    &mut read,
                ) == 0
                {
                    summary.errors += 1;
                    stats.errors.fetch_add(1, AtomicOrdering::Relaxed);
                    continue;
                }
                buffer.truncate(read);
                if buffer.is_empty() {
                    continue;
                }
                remaining -= read as u64;
                summary.regions += 1;
                summary.bytes += read as u64;
                stats.mem_scans.fetch_add(1, AtomicOrdering::Relaxed);
                match crate::yara::scan(&loaded.rules, &buffer) {
                    Ok(hits) if hits.is_empty() => {}
                    Ok(hits) => {
                        for hit in &hits {
                            summary.matches += 1;
                            stats.mem_matches.fetch_add(1, AtomicOrdering::Relaxed);
                            emit(mem_hit_event(host, pid, name, base, read, mbi.Protect, hit));
                            events += 1;
                        }
                        if events >= MAX_PROCESS_EVENTS {
                            summary.capped += 1;
                            eprintln!(
                                "[SENSOR] yara-mem: {name} (pid {pid}) reached the {MAX_PROCESS_EVENTS} match-event cap; the rest of its memory is skipped this sweep"
                            );
                            break;
                        }
                    }
                    Err(err) => {
                        summary.errors += 1;
                        stats.errors.fetch_add(1, AtomicOrdering::Relaxed);
                        eprintln!("[SENSOR] yara-mem: {name} (pid {pid}) region {base:#x}: scan failed: {err}");
                    }
                }
            }
            windows_sys::Win32::Foundation::CloseHandle(handle);
        }
    }

    /// The periodic sweep thread (--yara-mem): every config.every, takes
    /// the rules the file worker last loaded from the shared slot (none:
    /// the sweep waits for the next tick — a broken pack disables file
    /// and memory scanning alike) and sweeps. Wakes up once a second to
    /// notice a stop, so shutdown never waits longer than that.
    pub fn start_memscan(
        host: String,
        config: MemConfig,
        slot: RulesSlot,
        stats: Arc<YaraStats>,
        emit: impl Fn(EventJson) + Send + 'static,
        stop: Arc<AtomicBool>,
    ) -> Option<JoinHandle<()>> {
        std::thread::Builder::new()
            .name("yara-memscan".into())
            .spawn(move || {
                let mut emit = emit;
                let mut last = std::time::Instant::now();
                loop {
                    if stop.load(AtomicOrdering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                    if stop.load(AtomicOrdering::Relaxed) {
                        break;
                    }
                    if last.elapsed() < config.every {
                        continue;
                    }
                    last = std::time::Instant::now();
                    let loaded = slot.lock().ok().and_then(|guard| guard.clone());
                    let Some(loaded) = loaded else {
                        continue; // rules not loaded (yet): nothing to scan with
                    };
                    let summary = sweep(&loaded, &config, &host, &[], &stats, &mut emit);
                    stats.sweeps.fetch_add(1, AtomicOrdering::Relaxed);
                    eprintln!("[SENSOR] yara-mem: sweep: {}", summary.line());
                }
            })
            .ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_committed_readable_non_guard_regions_are_scanned() {
        // the useful majority: committed, readable, in its flavors
        assert!(region_readable(MEM_COMMIT, PAGE_READONLY));
        assert!(region_readable(MEM_COMMIT, PAGE_READWRITE));
        assert!(region_readable(MEM_COMMIT, PAGE_WRITECOPY));
        assert!(region_readable(MEM_COMMIT, PAGE_EXECUTE_READ));
        assert!(region_readable(MEM_COMMIT, PAGE_EXECUTE_READWRITE));
        assert!(region_readable(MEM_COMMIT, PAGE_EXECUTE_WRITECOPY));
        // combinations the target may report (flags ORed onto the base)
        assert!(region_readable(MEM_COMMIT, PAGE_READWRITE | 0x4000_0000)); // PAGE_TARGETS_INVALID
                                                                            // never scanned: not committed, unreadable, guarded
        assert!(!region_readable(
            0x100_2000, /* MEM_RESERVE */
            PAGE_READWRITE
        ));
        assert!(!region_readable(
            0x1_0000, /* MEM_FREE */
            PAGE_EXECUTE_READ
        ));
        assert!(!region_readable(MEM_COMMIT, PAGE_NOACCESS));
        assert!(!region_readable(MEM_COMMIT, PAGE_GUARD));
        assert!(!region_readable(MEM_COMMIT, PAGE_GUARD | PAGE_READWRITE));
        // execute-only cannot be read back
        assert!(!region_readable(MEM_COMMIT, PAGE_EXECUTE));
    }

    #[test]
    fn protection_labels_name_the_granted_letters() {
        assert_eq!(protect_label(PAGE_READONLY), "r");
        assert_eq!(protect_label(PAGE_READWRITE), "rw");
        assert_eq!(protect_label(PAGE_WRITECOPY), "rw");
        assert_eq!(protect_label(PAGE_EXECUTE_READ), "rx");
        assert_eq!(protect_label(PAGE_EXECUTE_READWRITE), "rwx");
        assert_eq!(protect_label(PAGE_EXECUTE_WRITECOPY), "rwx");
        assert_eq!(protect_label(PAGE_NOACCESS), "na");
        assert_eq!(protect_label(0), "na");
    }

    #[test]
    fn memory_hits_carry_the_process_and_the_region_not_a_file() {
        let hit = Hit {
            rule: "mem_rule".into(),
            namespace: "default".into(),
            tags: vec!["t1".into()],
            metas: vec![("score".into(), "9".into())],
            strings: vec!["payload!".into()],
        };
        let event = mem_hit_event(
            "LAB-01",
            4242,
            "implant.exe",
            0x7ff6_a123_0000,
            4096,
            PAGE_EXECUTE_READWRITE,
            &hit,
        );
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "yara.match");
        assert_eq!(json["process"]["pid"], 4242);
        assert_eq!(json["process"]["name"], "implant.exe");
        assert!(json.get("file").is_none(), "memory hits have no file");
        let attrs = json["attributes"].as_object().unwrap();
        assert_eq!(attrs["yara_rule"], "mem_rule");
        assert_eq!(attrs["yara_strings"], "payload!");
        assert_eq!(attrs["yara_mem_base"], "0x7ff6a1230000");
        assert_eq!(attrs["yara_mem_size"], "4096");
        assert_eq!(attrs["yara_mem_prot"], "rwx");
        assert_eq!(json["tags"][0], "sensor:yara");
    }

    #[test]
    fn the_default_mem_caps_match_the_flag_defaults_in_main() {
        // main.rs's --yara-mem-every / --yara-mem-max-mb defaults are the
        // literals 15 and 512 (they cannot name these constants
        // off-Windows): keep the two together
        assert_eq!(SWEEP_EVERY_DEFAULT_MINUTES, 15);
        assert_eq!(MAX_PROCESS_BYTES_DEFAULT, 512 << 20);
        let cfg = MemConfig::default();
        assert_eq!(cfg.every, Duration::from_secs(15 * 60));
        assert_eq!(cfg.max_process_bytes, 512 << 20);
    }

    #[test]
    fn the_cadence_is_clamped_to_the_sweep_bounds() {
        // a lab may ask for one minute, nobody waits less; a day is the
        // slowest honest sweep
        assert_eq!(MemConfig::new(0, 1).every, Duration::from_secs(60));
        assert_eq!(MemConfig::new(1, 1).every, Duration::from_secs(60));
        assert_eq!(MemConfig::new(15, 1).every, Duration::from_secs(900));
        assert_eq!(
            MemConfig::new(5000, 1).every,
            Duration::from_secs(1440 * 60)
        );
    }

    #[test]
    fn the_sweep_summary_reports_what_happened() {
        let summary = SweepSummary {
            processes: 214,
            regions: 3121,
            bytes: 1 << 30,
            matches: 2,
            errors: 4,
            skipped: 2,
            capped: 1,
        };
        let line = summary.line();
        for piece in [
            "214 process(es)",
            "3121 region(s)",
            "2 match(es)",
            "4 unreadable",
            "2 skipped",
            "1 capped",
        ] {
            assert!(line.contains(piece), "missing {piece} in: {line}");
        }
    }
}
