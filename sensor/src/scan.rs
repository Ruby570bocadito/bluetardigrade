// scan.rs: the `scan` subcommand — the on-demand half of S-2. One-shot
// YARA scanning of files or directories with the same rule directory and
// the same yara.match events the write-path scanner emits, printed as
// NDJSON on stdout instead of sent to the engine. Runs with the user's
// rights, no elevation and no ETW: a forensic helper and a rule tester
// that does not need a Windows host to exercise a rule pack.
//
//   security-sensor scan <PATH>... [--rules <dir>] [--max-mb <MiB>]
//
// Exit codes: 0 scanned with no matches, 2 matches found, 1 operational
// failure (rules could not load). One line per match, one summary line
// on stderr.

use crate::normalize::EventJson;
use crate::yara::{self, YaraConfig};
use std::io::Read;
use std::path::{Path, PathBuf};

/// What a scan run produced.
pub struct Outcome {
    pub scanned: usize,
    pub matches: usize,
}

/// Parses the subcommand's arguments, loads the rules and scans every
/// path (files are scanned as they are; directories are walked). Every
/// match goes through `out` as a ready yara.match event. Errors of the
/// rules directory come back as Err; per-file IO errors are reported on
/// stderr and skipped, like the worker does.
pub fn scan_paths(config: &YaraConfig, paths: &[PathBuf], host: &str, mut out: impl FnMut(&EventJson)) -> Result<Outcome, Vec<String>> {
    let loaded = yara::load(&config.rules_dir)?;
    let mut scanned = 0usize;
    let mut matches = 0usize;
    for path in paths {
        if path.is_dir() {
            let mut files: Vec<PathBuf> = Vec::new();
            walk(path, &mut files);
            files.sort();
            for file in files {
                let (s, m) = scan_file(&loaded, config, file.to_string_lossy().as_ref(), host, &mut out);
                scanned += s;
                matches += m;
            }
        } else {
            let (s, m) = scan_file(&loaded, config, path.to_string_lossy().as_ref(), host, &mut out);
            scanned += s;
            matches += m;
        }
    }
    Ok(Outcome { scanned, matches })
}

fn scan_file(loaded: &yara::LoadedRules, config: &YaraConfig, path: &str, host: &str, out: &mut impl FnMut(&EventJson)) -> (usize, usize) {
    if yara::is_excluded(path, &config.exclude) {
        return (0, 0);
    }
    let Ok(meta) = std::fs::metadata(path) else {
        eprintln!("[YARA] {path}: not readable, skipped");
        return (0, 0);
    };
    if !meta.is_file() {
        return (0, 0);
    }
    if meta.len() > config.max_file_bytes {
        eprintln!("[YARA] {path}: {} bytes over the cap, skipped", meta.len());
        return (0, 0);
    }
    let data = match read_file(path, config.max_file_bytes) {
        Ok(data) => data,
        Err(err) => {
            eprintln!("[YARA] {path}: {err}");
            return (0, 0);
        }
    };
    let digest = {
        let mut hasher = crate::imagehash::Sha256::new();
        hasher.update(&data);
        crate::imagehash::hex(&hasher.finish())
    };
    match yara::scan(&loaded.rules, &data) {
        Ok(hits) => {
            for hit in &hits {
                out(&yara::hit_event(host, path, meta.len(), &digest, hit));
            }
            (1, hits.len())
        }
        Err(err) => {
            eprintln!("[YARA] {path}: scan failed: {err}");
            (0, 0)
        }
    }
}

fn read_file(path: &str, max: u64) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(max).read_to_end(&mut data))
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > max {
        return Err(format!("grew past the {max} byte cap while reading"));
    }
    Ok(data)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !name.starts_with('.') {
                walk(&path, out);
            }
        } else {
            out.push(path);
        }
    }
}

/// The subcommand entry point: parses its arguments, prints one NDJSON
/// line per match on stdout and a summary on stderr, and returns the
/// process exit code (0 clean, 1 failure, 2 matches).
pub fn run(args: Vec<String>) -> i32 {
    let mut rules_dir: Option<PathBuf> = None;
    let mut max_mb: u64 = (yara::MAX_FILE_BYTES_DEFAULT >> 20).max(1);
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--rules" => match iter.next() {
                Some(dir) => rules_dir = Some(PathBuf::from(dir)),
                None => return usage("--rules requires a directory"),
            },
            "--max-mb" => match iter.next().map(|v| v.parse::<u64>()) {
                Some(Ok(mb)) if mb > 0 => max_mb = mb,
                _ => return usage("--max-mb requires a positive integer"),
            },
            other if other.starts_with('-') => return usage(&format!("unknown argument: {other}")),
            other => paths.push(PathBuf::from(other)),
        }
    }
    let Some(rules_dir) = rules_dir else {
        return usage("--rules <dir> is required (the directory the engine's rule distribution fills)");
    };
    if paths.is_empty() {
        return usage("at least one file or directory to scan is required");
    }
    let config = YaraConfig { rules_dir, max_file_bytes: max_mb.saturating_mul(1 << 20), exclude: vec![] };
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".into());
    let outcome = match scan_paths(&config, &paths, &host, |event| {
        if let Ok(line) = serde_json::to_string(event) {
            println!("{line}");
        }
    }) {
        Ok(outcome) => outcome,
        Err(errors) => {
            for err in &errors {
                eprintln!("[YARA] {err}");
            }
            eprintln!("[YARA] rules could not be loaded: nothing scanned");
            return 1;
        }
    };
    eprintln!("[YARA] scanned {} file(s), {} match(es)", outcome.scanned, outcome.matches);
    if outcome.matches > 0 {
        2
    } else {
        0
    }
}

fn usage(problem: &str) -> i32 {
    eprintln!("{problem}");
    eprintln!("usage: security-sensor scan <PATH>... --rules <dir> [--max-mb <MiB>]");
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("bluetardigrade-scan-{}-{}", tag, std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const RULE: &str = r#"
rule scan_subcommand_hit {
    strings:
        $m = "bluetardigrade-test-payload"
    condition:
        all of them
}
"#;

    #[test]
    fn scanning_a_directory_reports_every_match_as_an_event() {
        let rules = TempDir::new("rules");
        std::fs::write(rules.path().join("r.yar"), RULE).unwrap();
        let targets = TempDir::new("targets");
        std::fs::write(targets.path().join("clean.txt"), "nothing to see").unwrap();
        std::fs::write(targets.path().join("hit.txt"), "has the bluetardigrade-test-payload inside").unwrap();
        std::fs::create_dir_all(targets.path().join("nested")).unwrap();
        std::fs::write(targets.path().join("nested").join("hit2.txt"), "bluetardigrade-test-payload").unwrap();
        let config = YaraConfig { rules_dir: rules.path().to_path_buf(), ..YaraConfig::default() };
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&events);
        let outcome = scan_paths(&config, &[targets.path().to_path_buf()], "LAB-01", |event| {
            sink.lock().unwrap().push(serde_json::to_string(event).unwrap());
        })
        .expect("rules compile");
        assert_eq!(outcome.scanned, 3);
        assert_eq!(outcome.matches, 2);
        let lines = events.lock().unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains(r#""type":"yara.match""#));
        assert!(lines.iter().any(|l| l.contains("hit.txt")));
        assert!(lines.iter().any(|l| l.contains("hit2.txt")));
    }

    #[test]
    fn broken_rules_are_a_failure_not_a_panic() {
        let rules = TempDir::new("broken");
        std::fs::write(rules.path().join("bad.yar"), "this file is definitely not YARA source").unwrap();
        let config = YaraConfig { rules_dir: rules.path().to_path_buf(), ..YaraConfig::default() };
        assert!(scan_paths(&config, &[PathBuf::from("whatever")], "LAB-01", |_| {}).is_err());
    }
}
