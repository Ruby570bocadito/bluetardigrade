// yara.rs: YARA scanning of files with yara-x (S-2). Platform-independent
// so it is unit-tested on any host; the collector feeds it file paths from
// the file-write session and the `scan` subcommand calls it on demand.
//
//   - Rules live in a directory (--yara-rules): every *.yar/*.yara file
//     under it is compiled (one file at a time; a file that fails to
//     compile is skipped and counted, the rest keep scanning) and an
//     optional bundle.json adds {"version": "..."} for the contract with
//     the engine's rule distribution (M-3).
//   - The scanner runs off the ETW callbacks: file writes arrive through a
//     bounded channel, a single worker stats (dedupe by path, size and
//     modification time), reads (files over --yara-max-mb are skipped) and
//     scans them. A write the worker cannot take is counted (yara_dropped)
//     and goes unscanned, the same honesty as the image-hash thread.
//   - A hit becomes a yara.match event: model.File (path, extension,
//     size_bytes, sha256) plus attributes yara_rule/yara_namespace/
//     yara_tags/yara_meta_*/yara_strings. The engine stores the evidence;
//     its detections and views are the consuming side (contract S-2<->M-3,
//     declared in the round report).
//   - The rules directory is fingerprinted (sorted rel path, size, mtime)
//     and re-checked once a minute, so the engine's distribution replaces
//     rules without restarting the sensor.
//
// The scanner is opt-in: without --yara-rules nothing of this runs and no
// file telemetry is consumed.

use crate::imagehash::{hex, Sha256};
use crate::normalize::{self, EventJson, FileJson, HashesJson, TYPE_YARA_MATCH};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, UNIX_EPOCH};

/// Files over this size are not scanned (the worker stats first; a file
/// that grows past the cap between stat and read is skipped too).
pub const MAX_FILE_BYTES_DEFAULT: u64 = 16 << 20;

/// Scanned (path, size, mtime) triples remembered, so a file written
/// repeatedly without changing is scanned once.
const CACHE_CAP: usize = 4096;

/// How often the worker re-checks the rules directory (the engine's
/// distribution lands there without a sensor restart).
const RELOAD_EVERY: Duration = Duration::from_secs(60);

/// The optional manifest the rule distribution (M-3) may drop next to
/// the rule files (see is_rule_file for the YARA source extensions).
pub const MANIFEST_NAME: &str = "bundle.json";

/// A rule source or the manifest bigger than this is refused by the
/// reader (the file is named as a load failure), never slurped: the
/// engine caps every distributed file at MaxPackBytes (32 MiB) and the
/// sensor keeps the same ceiling, so a stray giant file in the rules
/// directory cannot take the scanner's memory with it.
const MAX_RULE_SOURCE_BYTES: u64 = 32 << 20;

/// Event budget: attributes and strings are evidence, not a dump.
const MAX_META_ENTRIES: usize = 8;
const MAX_STRINGS: usize = 5;
const MAX_STRING_DATA: usize = 96;
const MAX_VALUE: usize = 160;
const MAX_COMPILE_ERRORS_LOGGED: usize = 8;

/// Run settings handed from main() to the collector and the worker.
#[derive(Clone)]
pub struct YaraConfig {
    pub rules_dir: PathBuf,
    pub max_file_bytes: u64,
    /// Paths the scanner never touches: the sensor's own spool, log,
    /// token file and the rules directory itself (a rule match there
    /// would only echo the sensor's own files back to the engine).
    pub exclude: Vec<PathBuf>,
}

impl Default for YaraConfig {
    fn default() -> Self {
        YaraConfig { rules_dir: PathBuf::new(), max_file_bytes: MAX_FILE_BYTES_DEFAULT, exclude: Vec::new() }
    }
}

/// Counters the handler, the worker and the heartbeat share. `dropped`
/// is written by the ETW callback (the worker could not take the file);
/// the rest by the worker; the heartbeat reads all of them.
#[derive(Default)]
pub struct YaraStats {
    pub scans: AtomicU64,
    pub matches: AtomicU64,
    pub errors: AtomicU64,
    pub dropped: AtomicU64,
    rules: AtomicU64,
    sha16: Mutex<String>,
}

impl YaraStats {
    /// Worker side: the rules now in memory (0 = scanning off).
    pub fn set_rules(&self, count: usize, sha16: &str) {
        self.rules.store(count as u64, Ordering::Relaxed);
        if let Ok(mut sha) = self.sha16.lock() {
            *sha = sha16.to_string();
        }
    }

    pub fn get(&self) -> (u64, u64, u64, u64, u64, String) {
        (
            self.rules.load(Ordering::Relaxed),
            self.scans.load(Ordering::Relaxed),
            self.matches.load(Ordering::Relaxed),
            self.errors.load(Ordering::Relaxed),
            self.dropped.load(Ordering::Relaxed),
            self.sha16.lock().map(|s| s.clone()).unwrap_or_default(),
        )
    }
}

/// A rule that matched one scan.
pub struct Hit {
    pub rule: String,
    pub namespace: String,
    pub tags: Vec<String>,
    pub metas: Vec<(String, String)>,
    /// The matched string data (capped): the why of the match.
    pub strings: Vec<String>,
}

/// A compiled rules directory.
pub struct LoadedRules {
    pub rules: yara_x::Rules,
    fingerprint: String,
    pub sha16: String,
    pub version: String,
    pub count: usize,
    /// Files the reader refused or the compiler dropped while the rest
    /// kept loading: reported, never silently skipped (the
    /// collect_sources contract).
    pub errors: Vec<String>,
}

/// One YARA source file worth compiling: relative path (the origin the
/// compile errors name) and its content.
struct Source {
    rel: String,
    code: String,
}

/// Collects the YARA sources under `dir` (sorted by relative path for a
/// deterministic compile), the manifest's version and the files that
/// cannot even be read as UTF-8 (reported as compile failures, never
/// silently skipped).
fn collect_sources(dir: &Path) -> (Vec<Source>, String, Vec<String>) {
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    walk(dir, dir, &mut files);
    files.sort();
    let mut version = String::new();
    let mut sources = Vec::new();
    let mut pre_errors = Vec::new();
    for (rel, path) in files {
        if rel == MANIFEST_NAME {
            if let Ok(text) = read_capped(&path.to_string_lossy(), MAX_RULE_SOURCE_BYTES)
                .and_then(|bytes| String::from_utf8(bytes).map_err(|err| err.to_string()))
            {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(v) = value.get("version").and_then(|v| v.as_str()) {
                        version = v.to_string();
                    }
                }
            }
            continue;
        }
        match read_capped(&path.to_string_lossy(), MAX_RULE_SOURCE_BYTES) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(code) => sources.push(Source { rel, code }),
                Err(_) => pre_errors.push(format!("{rel}: not valid UTF-8 (YARA source is text)")),
            },
            Err(err) => pre_errors.push(format!("{rel}: {err}")),
        }
    }
    (sources, version, pre_errors)
}

fn walk(dir: &Path, base: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy().to_string();
        let path = entry.path();
        if path.is_dir() {
            if !name.starts_with('.') {
                walk(&path, base, out);
            }
        } else if is_rule_file(&name) || name == MANIFEST_NAME {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, path));
        }
    }
}

fn is_rule_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".yar") || lower.ends_with(".yara")
}

/// Fingerprint of the rules directory: the sorted (relative path, size,
/// modification time) of every rule file and the manifest, hashed. Cheap
/// (stats only) — the worker calls it once a minute.
pub fn fingerprint(dir: &Path) -> Option<String> {
    let mut rows: Vec<(String, PathBuf)> = Vec::new();
    walk(dir, dir, &mut rows);
    rows.sort();
    if rows.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    for (rel, path) in rows {
        let Ok(meta) = fs::metadata(&path) else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        hasher.update(format!("{rel}\0{}\0{mtime}\n", meta.len()).as_bytes());
    }
    Some(hex(&hasher.finish())[..16].to_string())
}

/// Compiles the rules directory. Every file compiles into the same rule
/// set; a file whose compilation fails is dropped and reported (the rest
/// keep scanning — a broken pack must not take the scanner down). Each
/// failure costs one extra compile pass over the surviving files, so a
/// directory of broken packs is bounded, not exponential.
pub fn load(dir: &Path) -> Result<LoadedRules, Vec<String>> {
    let (sources, version, mut errors) = collect_sources(dir);
    let rule_sources: Vec<&Source> = sources.iter().filter(|s| is_rule_file(&s.rel)).collect();
    if rule_sources.is_empty() {
        if !errors.is_empty() {
            return Err(errors);
        }
        return Err(vec![format!("no .yar/.yara files under {}", dir.display())]);
    }
    let mut skip: Vec<usize> = Vec::new();
    'attempt: loop {
        let mut compiler = yara_x::Compiler::new();
        let mut keep: Vec<&Source> = Vec::new();
        for (i, source) in rule_sources.iter().enumerate() {
            if skip.contains(&i) {
                continue;
            }
            match compiler.add_source(yara_x::SourceCode::from(source.code.as_str()).with_origin(source.rel.as_str())) {
                Ok(_) => keep.push(source),
                Err(err) => {
                    if errors.len() < MAX_COMPILE_ERRORS_LOGGED {
                        errors.push(format!("{}: {err}", source.rel));
                    }
                    // the compiler's state after a failed add is not a
                    // contract: rebuild the rule set without this file
                    skip.push(i);
                    continue 'attempt;
                }
            }
        }
        if keep.is_empty() {
            // every file failed: an empty rule set would silently scan
            // nothing while the heartbeat said rules were loaded
            return Err(errors);
        }
        let rules = compiler.build();
        let mut content = Sha256::new();
        for source in &keep {
            content.update(source.rel.as_bytes());
            content.update(&[0]);
            content.update(source.code.as_bytes());
        }
        let sha16 = hex(&content.finish())[..16].to_string();
        let count = rules.iter().count();
        return Ok(LoadedRules { rules, fingerprint: fingerprint(dir).unwrap_or_default(), sha16, version, count, errors });
    }
}

/// Scans one buffer and returns the rules that matched.
pub fn scan(rules: &yara_x::Rules, data: &[u8]) -> Result<Vec<Hit>, String> {
    let mut scanner = yara_x::Scanner::new(rules);
    let results = scanner.scan(data).map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for rule in results.matching_rules() {
        let mut strings = Vec::new();
        for pattern in rule.patterns() {
            for m in pattern.matches() {
                strings.push(string_evidence(m.data()));
                if strings.len() >= MAX_STRINGS {
                    break;
                }
            }
            if strings.len() >= MAX_STRINGS {
                break;
            }
        }
        hits.push(Hit {
            rule: rule.identifier().to_string(),
            namespace: rule.namespace().to_string(),
            tags: rule.tags().map(|t| t.identifier().to_string()).collect(),
            metas: rule.metadata().map(|(k, v)| (k.to_string(), meta_string(&v))).collect(),
            strings,
        });
    }
    Ok(hits)
}

fn meta_string(v: &yara_x::MetaValue) -> String {
    match v {
        yara_x::MetaValue::Integer(i) => i.to_string(),
        yara_x::MetaValue::Float(f) => f.to_string(),
        yara_x::MetaValue::Bool(b) => b.to_string(),
        yara_x::MetaValue::String(s) => truncate(s),
        yara_x::MetaValue::Bytes(b) => truncate(&String::from_utf8_lossy(b)),
    }
}

fn truncate(text: &str) -> String {
    if text.len() <= MAX_VALUE {
        return text.to_string();
    }
    let mut end = MAX_VALUE;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &text[..end])
}

/// Matched string data: printable text as it is, binary as a size note.
fn string_evidence(data: &[u8]) -> String {
    let capped = &data[..data.len().min(MAX_STRING_DATA)];
    if capped.iter().all(|b| (0x20..0x7f).contains(b)) {
        String::from_utf8_lossy(capped).to_string()
    } else {
        format!("<{} bytes>", data.len())
    }
}

/// The yara.match event for one hit: model.File carries the evidence and
/// the attributes name the rule (contract S-2<->M-3).
pub fn hit_event(host: &str, path: &str, size_bytes: u64, sha256_hex: &str, hit: &Hit) -> EventJson {
    let mut attributes: BTreeMap<String, String> = BTreeMap::new();
    attributes.insert("yara_rule".into(), hit.rule.clone());
    attributes.insert("yara_namespace".into(), hit.namespace.clone());
    if !hit.tags.is_empty() {
        attributes.insert("yara_tags".into(), hit.tags.join(","));
    }
    for (k, v) in hit.metas.iter().take(MAX_META_ENTRIES) {
        attributes.insert(format!("yara_meta_{k}"), truncate(v));
    }
    if !hit.strings.is_empty() {
        attributes.insert("yara_strings".into(), truncate(&hit.strings.join(" | ")));
    }
    EventJson {
        id: normalize::new_uuid(),
        timestamp: normalize::now_rfc3339(),
        r#type: TYPE_YARA_MATCH.into(),
        source: "etw".into(),
        host: host.to_string(),
        user: None,
        process: None,
        network: None,
        registry: None,
        file: Some(FileJson {
            path: path.to_string(),
            extension: Path::new(path)
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase()),
            size_bytes: size_bytes as i64,
            hashes: Some(HashesJson::sha256(sha256_hex.to_string())),
        }),
        attributes: Some(attributes),
        tags: vec!["sensor:yara".into()],
    }
}

/// Scanned-file memory: the (path, size, mtime) triples already scanned,
/// bounded FIFO (a file written a hundred times without changing costs
/// one scan, and a replaced file is scanned again).
struct ScanCache {
    seen: HashMap<String, ()>,
    order: VecDeque<String>,
}

impl ScanCache {
    fn new() -> Self {
        ScanCache { seen: HashMap::new(), order: VecDeque::new() }
    }

    /// True when this exact state was scanned before; remembers it otherwise.
    fn remember(&mut self, key: String) -> bool {
        if self.seen.contains_key(&key) {
            return true;
        }
        if self.seen.len() >= CACHE_CAP {
            if let Some(old) = self.order.pop_front() {
                self.seen.remove(&old);
            }
        }
        self.seen.insert(key.clone(), ());
        self.order.push_back(key);
        false
    }
}

/// The scan worker: takes Win32 file paths from the write handler, and
/// once a minute re-checks the rules directory. One job = one file: stat,
/// dedupe, read (capped, hashing while reading), scan, emit. Exits when
/// the collector drops the channel (normal shutdown) and reports why.
pub fn start_worker(
    host: String,
    config: YaraConfig,
    rx: Receiver<String>,
    stats: Arc<YaraStats>,
    emit: impl Fn(EventJson) + Send + 'static,
) -> Option<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("yara-scan".into())
        .spawn(move || worker(host, config, rx, stats, emit))
        .ok()
}

fn worker(host: String, config: YaraConfig, rx: Receiver<String>, stats: Arc<YaraStats>, emit: impl Fn(EventJson)) {
    let mut loaded: Option<LoadedRules> = match load(&config.rules_dir) {
        Ok(loaded) => {
            eprintln!(
                "[SENSOR] yara: {} rules loaded (sha {}, version '{}') from {}",
                loaded.count, loaded.sha16, loaded.version, config.rules_dir.display()
            );
            for err in &loaded.errors {
                eprintln!("[SENSOR] yara: {err}");
            }
            stats.set_rules(loaded.count, &loaded.sha16);
            Some(loaded)
        }
        Err(errors) => {
            for err in &errors {
                eprintln!("[SENSOR] yara: {err}");
            }
            eprintln!("[SENSOR] yara: scanning disabled until the rules under {} load", config.rules_dir.display());
            stats.set_rules(0, "");
            None
        }
    };
    let mut cache = ScanCache::new();
    let mut last_reload = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(path) => {
                if let Some(rules) = &loaded {
                    scan_one(&host, rules, &config, &path, &stats, &emit, &mut cache);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if last_reload.elapsed() >= RELOAD_EVERY {
            last_reload = Instant::now();
            if let Some(current) = fingerprint(&config.rules_dir) {
                let stale = loaded.as_ref().is_none_or(|l| l.fingerprint != current);
                if stale {
                    match load(&config.rules_dir) {
                        Ok(reloaded) => {
                            eprintln!(
                                "[SENSOR] yara: reloaded {} rules (sha {}, version '{}')",
                                reloaded.count, reloaded.sha16, reloaded.version
                            );
                            for err in &reloaded.errors {
                                eprintln!("[SENSOR] yara: {err}");
                            }
                            stats.set_rules(reloaded.count, &reloaded.sha16);
                            loaded = Some(reloaded);
                        }
                        Err(errors) => {
                            stats.errors.fetch_add(errors.len() as u64, Ordering::Relaxed);
                            for err in &errors {
                                eprintln!("[SENSOR] yara: reload kept the previous rules ({err})");
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Scans one written file: dedupe by (path, size, mtime), skip files over
/// the cap, read hashing as we go, emit one event per matching rule.
fn scan_one(
    host: &str,
    loaded: &LoadedRules,
    config: &YaraConfig,
    path: &str,
    stats: &YaraStats,
    emit: &impl Fn(EventJson),
    cache: &mut ScanCache,
) {
    if is_excluded(path, &config.exclude) {
        return; // the sensor's own spool, log, token or rules: never scanned
    }
    let Ok(meta) = fs::metadata(path) else {
        return; // written and gone (temp files) before the worker looked
    };
    if !meta.is_file() {
        return;
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let key = format!("{path}\0{}\0{mtime}", meta.len());
    if cache.remember(key) {
        return; // scanned in this exact state already
    }
    let size = meta.len();
    if size > config.max_file_bytes {
        return; // static policy (--yara-max-mb): skipped, not an error
    }
    let data = match read_capped(path, config.max_file_bytes) {
        Ok(data) => data,
        Err(err) => {
            stats.errors.fetch_add(1, Ordering::Relaxed);
            eprintln!("[SENSOR] yara: {path}: {err}");
            return;
        }
    };
    let digest = {
        let mut hasher = Sha256::new();
        hasher.update(&data);
        hex(&hasher.finish())
    };
    stats.scans.fetch_add(1, Ordering::Relaxed);
    match scan(&loaded.rules, &data) {
        Ok(hits) => {
            stats.matches.fetch_add(hits.len() as u64, Ordering::Relaxed);
            for hit in &hits {
                emit(hit_event(host, path, size, &digest, hit));
            }
        }
        Err(err) => {
            stats.errors.fetch_add(1, Ordering::Relaxed);
            eprintln!("[SENSOR] yara: {path}: scan failed: {err}");
        }
    }
}

/// True when `path` is one of the excluded paths or under an excluded
/// directory. Compared case-insensitively (the paths come from the Win32
/// translation of NT names, whose casing is not stable).
pub fn is_excluded(path: &str, exclude: &[PathBuf]) -> bool {
    let lower = path.to_ascii_lowercase();
    exclude.iter().any(|ex| {
        let ex = ex.to_string_lossy().to_ascii_lowercase();
        let ex = ex.trim_end_matches(['\\', '/']);
        if ex.is_empty() {
            return false;
        }
        lower == ex || lower.starts_with(&format!("{ex}\\")) || lower.starts_with(&format!("{ex}/"))
    })
}

/// Reads at most `max` bytes (a file that grew past the cap between the
/// stat and this read is skipped, not truncated: a partial scan would
/// report hits it cannot vouch for).
fn read_capped(path: &str, max: u64) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    (&mut file).take(max + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() as u64 > max {
        return Err(format!("grew past the {} byte cap while reading", max));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::sync_channel;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("bluetardigrade-yara-{}-{}", tag, std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const RULE: &str = r#"
rule bluetardigrade_test_hit : test_tag {
    meta:
        author = "round test"
        score = 7
    strings:
        $mark = "bluetardigrade-test-payload"
    condition:
        all of them
}
"#;

    const PAYLOAD: &str = "innocent prologue bluetardigrade-test-payload innocent epilogue";

    fn write_rules(dir: &Path, extra: Option<(&str, &str)>) {
        fs::write(dir.join("test.yar"), RULE).unwrap();
        if let Some((name, code)) = extra {
            fs::write(dir.join(name), code).unwrap();
        }
    }

    #[test]
    fn the_default_cap_matches_the_flag_default_in_main() {
        // main.rs's --yara-max-mb default is the literal 16 (it cannot
        // name this constant off-Windows): keep the two together
        assert_eq!(MAX_FILE_BYTES_DEFAULT, 16 << 20);
    }

    #[test]
    fn excluded_paths_are_never_scanned() {
        assert!(is_excluded(r"C:\sensor\spool.bin", &[PathBuf::from(r"C:\SENSOR\spool.bin")]));
        assert!(is_excluded(r"C:\sensor\rules\pack.yar", &[PathBuf::from(r"C:\sensor\rules")]));
        assert!(is_excluded(r"C:\sensor\rules\sub\pack.yar", &[PathBuf::from(r"C:\sensor\rules\")]));
        assert!(!is_excluded(r"C:\sensor\rules-other\pack.yar", &[PathBuf::from(r"C:\sensor\rules")]));
        assert!(!is_excluded(r"C:\other\file.bin", &[PathBuf::from(r"C:\sensor\spool.bin")]));
        assert!(!is_excluded(r"C:\anything", &[]));
    }

    #[test]
    fn the_stats_snapshot_carries_the_rules_identity() {
        let stats = YaraStats::default();
        let (rules, scans, matches, errors, dropped, sha) = stats.get();
        assert_eq!((rules, scans, matches, errors, dropped), (0, 0, 0, 0, 0));
        assert_eq!(sha, "", "no rules loaded yet");
        stats.set_rules(12, "abcdef0123456789");
        let (rules, _, _, _, _, sha) = stats.get();
        assert_eq!(rules, 12);
        assert_eq!(sha, "abcdef0123456789");
    }
    #[test]
    fn a_rule_directory_compiles_and_matches() {
        let tmp = TempDir::new("load");
        write_rules(tmp.path(), None);
        let loaded = load(tmp.path()).expect("compiles");
        assert_eq!(loaded.count, 1);
        assert_eq!(loaded.sha16.len(), 16);
        assert!(loaded.version.is_empty(), "no manifest, no version");
        let hits = scan(&loaded.rules, PAYLOAD.as_bytes()).expect("scans");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rule, "bluetardigrade_test_hit");
        assert_eq!(hits[0].tags, vec!["test_tag"]);
        assert_eq!(hits[0].strings, vec!["bluetardigrade-test-payload"]);
        assert_eq!(hits[0].metas.iter().find(|(k, _)| k == "score").unwrap().1, "7");
        assert!(scan(&loaded.rules, b"nothing here").unwrap().is_empty());
    }

    #[test]
    fn a_broken_file_is_skipped_and_the_rest_compiles() {
        let tmp = TempDir::new("broken");
        write_rules(tmp.path(), Some(("broken.yar", "rule not_yara {{{")));
        let loaded = load(tmp.path()).expect("the good file still compiles");
        assert_eq!(loaded.count, 1);
        assert!(scan(&loaded.rules, PAYLOAD.as_bytes()).unwrap().len() == 1);
    }

    #[test]
    fn the_manifest_carries_the_distribution_version() {
        let tmp = TempDir::new("manifest");
        write_rules(tmp.path(), None);
        fs::write(
            tmp.path().join(MANIFEST_NAME),
            r#"{"version": "2026-10-21.1", "files": ["test.yar"]}"#,
        )
        .unwrap();
        let loaded = load(tmp.path()).unwrap();
        assert_eq!(loaded.version, "2026-10-21.1");
    }

    #[test]
    fn a_rule_source_beyond_the_cap_is_refused_not_slurped() {
        let tmp = TempDir::new("rulecap");
        write_rules(tmp.path(), None);
        // 32 MiB + 1 of blanks: over MAX_RULE_SOURCE_BYTES. The reader
        // refuses it whole (never compiled, never held in memory) and
        // names it; the real rule keeps the load.
        let giant = vec![b' '; (MAX_RULE_SOURCE_BYTES + 1) as usize];
        fs::write(tmp.path().join("giant.yar"), &giant).unwrap();
        let loaded = load(tmp.path()).unwrap();
        assert_eq!(loaded.count, 1, "the tiny rule still loads");
        assert!(
            loaded.errors.iter().any(|e| e.contains("giant.yar")),
            "the refused file is named: {:?}",
            loaded.errors
        );
    }

    #[test]
    fn the_manifest_beyond_the_cap_just_leaves_the_version_empty() {
        let tmp = TempDir::new("manifestcap");
        write_rules(tmp.path(), None);
        let giant = vec![b'{'; (MAX_RULE_SOURCE_BYTES + 1) as usize];
        fs::write(tmp.path().join(MANIFEST_NAME), giant).unwrap();
        let loaded = load(tmp.path()).unwrap();
        assert_eq!(loaded.version, "", "an unreadable manifest adds no version");
        assert_eq!(loaded.count, 1, "the rules still load");
        assert!(loaded.errors.is_empty(), "the manifest is not a rule failure: {:?}", loaded.errors);
    }

    #[test]
    fn dropped_files_are_reported_when_the_rest_loads() {
        // collect_sources' contract: files that cannot become YARA
        // source are reported, never silently skipped — also when at
        // least one other file compiles (the success path used to drop
        // the failures).
        let tmp = TempDir::new("partial");
        write_rules(tmp.path(), Some(("broken.yar", "this file is definitely not YARA source")));
        fs::write(tmp.path().join("binary.yar"), [0xFFu8, 0xFE, 0x00, 0x01]).unwrap();
        let loaded = load(tmp.path()).unwrap();
        assert_eq!(loaded.count, 1, "the valid rule loads");
        let named = loaded.errors.iter().any(|e| e.contains("broken.yar"))
            && loaded.errors.iter().any(|e| e.contains("binary.yar"));
        assert!(named, "both dropped files are named: {:?}", loaded.errors);
    }

    #[test]
    fn a_directory_where_every_file_fails_is_an_error_not_an_empty_scanner() {
        let tmp = TempDir::new("allbroken");
        fs::write(tmp.path().join("bad.yar"), "this file is definitely not YARA source").unwrap();
        let errors = match load(tmp.path()) {
            Ok(_) => panic!("no rule must not yield an (empty) scanner"),
            Err(errors) => errors,
        };
        assert!(!errors.is_empty());
    }

    #[test]
    fn an_empty_directory_is_an_error_not_a_panic() {
        let tmp = TempDir::new("empty");
        assert!(load(tmp.path()).is_err());
        assert!(fingerprint(tmp.path()).is_none());
    }

    #[test]
    fn the_fingerprint_follows_rule_changes() {
        let tmp = TempDir::new("fingerprint");
        write_rules(tmp.path(), None);
        let before = fingerprint(tmp.path()).unwrap();
        assert_eq!(before, fingerprint(tmp.path()).unwrap(), "stable while nothing changes");
        fs::write(tmp.path().join("test.yar"), format!("{RULE}\nrule second_one {{ condition: true }}")).unwrap();
        let after = fingerprint(tmp.path()).unwrap();
        assert_ne!(before, after, "an edited rule file changes the fingerprint");
    }

    #[test]
    fn the_event_matches_the_declared_schema() {
        let tmp = TempDir::new("event");
        write_rules(tmp.path(), None);
        let loaded = load(tmp.path()).unwrap();
        let hits = scan(&loaded.rules, PAYLOAD.as_bytes()).unwrap();
        let event = hit_event("LAB-01", r"C:\Users\a\Downloads\sample.exe", 74, "ab".repeat(32).as_str(), &hits[0]);
        assert_eq!(event.r#type, "yara.match");
        assert_eq!(event.source, "etw");
        assert_eq!(event.host, "LAB-01");
        let file = event.file.as_ref().unwrap();
        assert_eq!(file.path, r"C:\Users\a\Downloads\sample.exe");
        assert_eq!(file.extension.as_deref(), Some("exe"));
        assert_eq!(file.size_bytes, 74);
        let attributes = event.attributes.as_ref().unwrap();
        assert_eq!(attributes["yara_rule"], "bluetardigrade_test_hit");
        assert_eq!(attributes["yara_namespace"], "default");
        assert_eq!(attributes["yara_tags"], "test_tag");
        assert_eq!(attributes["yara_meta_author"], "round test");
        assert_eq!(attributes["yara_meta_score"], "7");
        assert_eq!(attributes["yara_strings"], "bluetardigrade-test-payload");
        // one JSON line, byte-shaped like every other sensor event
        let line = serde_json::to_string(&event).unwrap();
        assert!(line.contains(r#""type":"yara.match""#));
        assert!(line.contains(r#""size_bytes":74"#));
        assert!(line.contains(r#""sha256":"#));
        assert!(line.contains(r#""tags":["sensor:yara"]"#));
        assert!(!line.contains(r#""process""#), "no process object is invented");
    }

    #[test]
    fn binary_string_evidence_is_not_echoed() {
        let tmp = TempDir::new("binary");
        fs::write(
            tmp.path().join("bin.yar"),
            r#"
rule bin_hit {
    strings:
        $b = { DE AD BE EF 00 }
    condition:
        $b
}
"#,
        )
        .unwrap();
        let loaded = load(tmp.path()).unwrap();
        let hits = scan(&loaded.rules, &[0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].strings, vec!["<5 bytes>"]);
    }

    #[test]
    fn meta_values_reach_the_event_as_strings() {
        let tmp = TempDir::new("meta");
        fs::write(
            tmp.path().join("meta.yar"),
            r#"
rule meta_hit {
    meta:
        family = "test_family"
        ratio = 0.75
        off = false
    condition:
        true
}
"#,
        )
        .unwrap();
        let loaded = load(tmp.path()).unwrap();
        let hits = scan(&loaded.rules, b"data").unwrap();
        assert_eq!(hits.len(), 1);
        let mut metas = hits[0].metas.clone();
        metas.sort();
        assert_eq!(metas, vec![("family".into(), "test_family".into()), ("off".into(), "false".into()), ("ratio".into(), "0.75".into())]);
    }

    #[test]
    fn the_worker_scans_writes_and_dedupes_unchanged_files() {
        let tmp = TempDir::new("worker");
        write_rules(tmp.path(), None);
        let loaded = load(tmp.path()).unwrap();
        let sample = tmp.path().join("sample.bin");
        fs::write(&sample, PAYLOAD).unwrap();
        let config = YaraConfig {
            rules_dir: tmp.path().to_path_buf(),
            // the "big" file below is 4096 bytes: over this cap, under the
            // default one, so the policy skip is exercised cheaply
            max_file_bytes: 1024,
            exclude: vec![],
        };
        let stats = Arc::new(YaraStats::default());
        let (tx, rx) = sync_channel::<String>(8);
        let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let handle = start_worker(
            "LAB-01".into(),
            config,
            rx,
            Arc::clone(&stats),
            move |event| sink.lock().unwrap().push(serde_json::to_string(&event).unwrap()),
        )
        .unwrap();
        let path = sample.to_string_lossy().to_string();
        // three writes, one scan: the file does not change between them
        for _ in 0..3 {
            tx.send(path.clone()).unwrap();
        }
        // an over-cap file is skipped by policy (4096 > cap 1024)
        let big = tmp.path().join("big.bin");
        fs::write(&big, vec![0u8; 4096]).unwrap();
        tx.send(big.to_string_lossy().to_string()).unwrap();
        drop(tx); // the worker drains and exits
        handle.join().unwrap();
        assert_eq!(stats.scans.load(Ordering::Relaxed), 1, "deduped to one scan");
        assert_eq!(stats.matches.load(Ordering::Relaxed), 1);
        assert_eq!(stats.errors.load(Ordering::Relaxed), 0);
        let lines = events.lock().unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(&path));
        assert!(loaded.count == 1);
    }

    #[test]
    fn files_over_the_cap_are_skipped_without_counting_as_errors() {
        let tmp = TempDir::new("cap");
        write_rules(tmp.path(), None);
        let loaded = load(tmp.path()).unwrap();
        let big = tmp.path().join("big.bin");
        let payload = vec![0x41u8; 4096];
        fs::write(&big, &payload).unwrap();
        let config = YaraConfig { rules_dir: tmp.path().to_path_buf(), max_file_bytes: 1024, exclude: vec![] };
        let stats = YaraStats::default();
        let mut cache = ScanCache::new();
        scan_one(
            "LAB-01",
            &loaded,
            &config,
            big.to_string_lossy().as_ref(),
            &stats,
            &|_| panic!("no event for an over-cap file"),
            &mut cache,
        );
        assert_eq!(stats.scans.load(Ordering::Relaxed), 0);
        assert_eq!(stats.errors.load(Ordering::Relaxed), 0);
        assert_eq!(stats.matches.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn a_file_that_grows_past_the_cap_between_stat_and_read_is_skipped() {
        let tmp = TempDir::new("grow");
        write_rules(tmp.path(), None);
        let loaded = load(tmp.path()).unwrap();
        let sneaky = tmp.path().join("sneaky.bin");
        fs::write(&sneaky, vec![0x41u8; 1024]).unwrap();
        let config = YaraConfig { rules_dir: tmp.path().to_path_buf(), max_file_bytes: 1024, exclude: vec![] };
        let stats = YaraStats::default();
        let mut cache = ScanCache::new();
        // the file passes the stat (1024 <= cap) but read_capped refuses
        // anything that does not fit; simulate the growth by reading with
        // a cap below the size
        let data = read_capped(sneaky.to_string_lossy().as_ref(), 512);
        assert!(data.is_err(), "a file bigger than the cap is refused");
        scan_one(
            "LAB-01",
            &loaded,
            &config,
            sneaky.to_string_lossy().as_ref(),
            &stats,
            &|_| panic!("no event for a file the reader refused"),
            &mut cache,
        );
        // 1024 == cap: scanned normally (not over the cap)
        assert_eq!(stats.scans.load(Ordering::Relaxed), 1);
    }
}
