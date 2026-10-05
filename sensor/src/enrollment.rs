// enrollment.rs: the first start of a sensor that joins with an
// enrollment token instead of a ready-made ingest token.
//
// The sensor sends "ENROLL <token> <host>" and the engine answers with a
// credential of the sensor's own, bound to this host. The credential is
// written to --token-file (under ProgramData for the service, a folder
// only SYSTEM and Administrators can read) and the enrollment token is
// deleted from disk: it is no longer needed, and a multi-use token
// deployed to many machines must not linger on all of them. Every later
// start finds the credential in --token-file and skips this step.
//
// An engine that is not reachable yet (boot order, network still coming
// up) is retried with backoff; a refusal (expired, used up, revoked or
// unknown token) is final and says why.

use anyhow::{bail, Context, Result};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::transport;

/// Obtains a credential with the enrollment token and stores it in
/// `token_file`. `token_source` is the file the enrollment token came
/// from, deleted once the credential is safely stored.
pub fn obtain_credential(
    addr: &str,
    enroll_token: &str,
    host: &str,
    tls_ca: Option<&Path>,
    token_file: &Path,
    token_source: Option<&Path>,
    stop: &AtomicBool,
) -> Result<String> {
    eprintln!("[SENSOR] enrolling {host} with {addr} (first start: no credential in {} yet)", token_file.display());
    let mut backoff = 1u64;
    let answer = loop {
        match transport::enroll(addr, enroll_token, host, tls_ca) {
            Ok(answer) => break answer,
            Err(err) if transport::is_transient(&err) => {
                eprintln!("[SENSOR] enrollment: engine {addr} not reachable yet ({err:#}); retrying in {backoff}s");
                let until = Instant::now() + Duration::from_secs(backoff);
                while Instant::now() < until {
                    if stop.load(Ordering::Acquire) {
                        bail!("sensor stopping before the enrollment finished");
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                backoff = (backoff * 2).min(30);
            }
            Err(err) => return Err(err),
        }
    };
    store_credential(token_file, &answer.credential)?;
    if let Some(source) = token_source {
        if let Err(err) = std::fs::remove_file(source) {
            eprintln!("[SENSOR] warning: could not delete the enrollment token file {}: {err}", source.display());
        }
    }
    if answer.state == "active" {
        eprintln!("[SENSOR] enrolled as {}: approved, events flow now", answer.identity);
    } else {
        eprintln!(
            "[SENSOR] enrolled as {}: waiting for approval in the console (Equipos); events wait in the queue/spool until then",
            answer.identity
        );
    }
    Ok(answer.credential)
}

/// Writes the credential (one line) through a temporary file and a
/// rename, so a crash never leaves half a credential behind.
fn store_credential(path: &Path, credential: &str) -> Result<()> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".new");
    std::fs::write(&tmp, format!("{credential}\n")).with_context(|| format!("writing the credential to {}", path.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("storing the credential in {}", path.display()))?;
    Ok(())
}
