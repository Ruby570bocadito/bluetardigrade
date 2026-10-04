// procinfo.rs: platform-independent decoding of the kernel ETW process
// start event (MSNT_SystemTrace Process/Start), kept apart from the
// Windows-only collector so it is unit-tested on any host.
//
// Three field decoders live here:
//   - the record timestamp: ferrisetw 1.2.0's EventRecord::timestamp()
//     rebuilds the FILETIME from the HIGH dword twice, so every event
//     inside a ~7 minute bucket (2^32 * 100 ns) got the same instant;
//     the raw FILETIME is converted here instead.
//   - the process name: the kernel reports EPROCESS.ImageFileName,
//     which is truncated to 14 characters; the full name is recovered
//     from the command line's first token only when it extends the
//     truncated kernel name (argv[0] is caller-controlled, so it never
//     overrides an untruncated kernel name).
//   - the owner SID: the kernel event carries it as a WBEM SID (a
//     TOKEN_USER header followed by the SID), which ferrisetw cannot
//     parse as a string.

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// 100 ns intervals between 1601-01-01 and 1970-01-01.
const FILETIME_UNIX_EPOCH: i128 = 116_444_736_000_000_000;

/// Longest name EPROCESS.ImageFileName can hold: a name of this length
/// may have been truncated by the kernel.
const KERNEL_IMAGE_NAME_MAX: usize = 14;

/// Converts an ETW record timestamp (FILETIME, system time) to RFC 3339.
pub fn filetime_to_rfc3339(filetime: i64) -> Option<String> {
    if filetime <= 0 {
        return None;
    }
    let nanos = (filetime as i128 - FILETIME_UNIX_EPOCH) * 100;
    OffsetDateTime::from_unix_timestamp_nanos(nanos)
        .ok()?
        .format(&Rfc3339)
        .ok()
}

/// Best process name from the kernel's (possibly truncated) image name
/// and the command line.
pub fn process_name(image_file_name: &str, command_line: &str) -> String {
    let short = image_file_name.trim_matches(char::from(0)).trim();
    if short.is_empty() {
        return argv0(command_line).map(basename).unwrap_or_default().to_string();
    }
    if short.chars().count() >= KERNEL_IMAGE_NAME_MAX {
        if let Some(full) = extend_from_command_line(short, command_line) {
            return full;
        }
    }
    short.to_string()
}

/// Finds, in the command line, an executable name that starts at a path
/// boundary with the truncated kernel name and ends in ".exe" (quoted,
/// unquoted and space-containing paths alike). Only ASCII case folding
/// is used, so byte offsets match the original string.
fn extend_from_command_line(short: &str, command_line: &str) -> Option<String> {
    let lc = command_line.to_ascii_lowercase();
    let needle = short.to_ascii_lowercase();
    let mut from = 0;
    while let Some(pos) = lc[from..].find(&needle) {
        let i = from + pos;
        let at_boundary = i == 0 || matches!(lc.as_bytes()[i - 1], b'\\' | b'/' | b'"' | b' ');
        if at_boundary {
            if let Some(end) = lc[i..].find(".exe") {
                let candidate = &command_line[i..i + end + 4];
                if candidate.len() > short.len() && !candidate.contains(['\\', '/', '"']) {
                    return Some(candidate.to_string());
                }
            }
        }
        from = i + needle.len();
    }
    None
}

/// First token of a Windows command line (quoted or bare).
fn argv0(command_line: &str) -> Option<&str> {
    let s = command_line.trim_start();
    if let Some(rest) = s.strip_prefix('"') {
        return rest.split('"').next();
    }
    s.split_whitespace().next()
}

fn basename(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

/// The process name from a full image path, when the path really is the
/// image of the process the kernel reported: the image is queried from
/// the live PID after the event, and a process that already exited may
/// have had its PID reused. The kernel's (possibly truncated) name must
/// be a prefix of the image's file name, case-insensitively.
pub fn name_from_image(kernel_name: &str, image: &str) -> Option<String> {
    let file = basename(image.trim());
    if file.is_empty() {
        return None;
    }
    let short = kernel_name.trim_matches(char::from(0)).trim();
    if !short.is_empty() && !file.to_ascii_lowercase().starts_with(&short.to_ascii_lowercase()) {
        return None;
    }
    Some(file.to_string())
}

/// Decodes a WBEM SID property (TOKEN_USER header, then the SID) into
/// its string form, e.g. "S-1-5-18". The header is two pointers wide;
/// both 64-bit and 32-bit layouts are tried.
pub fn sid_from_wbem(buf: &[u8]) -> Option<String> {
    [16usize, 8].iter().find_map(|&off| buf.get(off..).and_then(sid_to_string))
}

fn sid_to_string(sid: &[u8]) -> Option<String> {
    if sid.len() < 8 || sid[0] != 1 {
        return None;
    }
    let count = sid[1] as usize;
    if count == 0 || count > 15 || sid.len() < 8 + 4 * count {
        return None;
    }
    let authority = sid[2..8].iter().fold(0u64, |acc, b| (acc << 8) | u64::from(*b));
    let mut out = format!("S-1-{authority}");
    for i in 0..count {
        let at = 8 + 4 * i;
        let sub = u32::from_le_bytes([sid[at], sid[at + 1], sid[at + 2], sid[at + 3]]);
        out.push_str(&format!("-{sub}"));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filetime_converts_with_full_precision() {
        assert_eq!(filetime_to_rfc3339(116_444_736_000_000_000).unwrap(), "1970-01-01T00:00:00Z");
        // two instants that share the high dword must stay distinct
        // (ferrisetw 1.2.0 collapsed them into one)
        let a = 0x01DD_33A0_0000_0000i64;
        let b = a + 600_000_000; // one minute later
        assert_eq!(filetime_to_rfc3339(a).unwrap(), "2026-08-24T08:10:17.8766848Z");
        assert_eq!(filetime_to_rfc3339(b).unwrap(), "2026-08-24T08:11:17.8766848Z");
        assert_eq!(filetime_to_rfc3339(0), None);
        assert_eq!(filetime_to_rfc3339(-5), None);
    }

    #[test]
    fn process_name_uses_kernel_name_unless_truncated() {
        // untruncated kernel name wins, whatever argv[0] claims
        assert_eq!(process_name("certutil.exe", "notepad.exe -urlcache"), "certutil.exe");
        assert_eq!(process_name("cmd.exe", r#""C:\Windows\system32\cmd.exe" /c exit"#), "cmd.exe");
        // 14 characters: possibly truncated, recovered from argv[0]
        assert_eq!(
            process_name(
                "SecurityHealth",
                r#""C:\Windows\System32\SecurityHealthHost.exe" {08728914-3F57-4D52-9E31-49DAECA5A80A} -Embedding"#
            ),
            "SecurityHealthHost.exe"
        );
        assert_eq!(
            process_name("LenovoVantage-", r"C:\Program Files\Lenovo\LenovoVantage-(SmartBEAddin).exe --x"),
            "LenovoVantage-(SmartBEAddin).exe"
        );
        // exactly 14 characters and not truncated: argv[0] without .exe does not override
        assert_eq!(process_name("powershell.exe", "powershell -nop"), "powershell.exe");
        // argv[0] that does not extend the kernel name is ignored (spoofing)
        assert_eq!(process_name("SecurityHealth", "evil.exe"), "SecurityHealth");
        assert_eq!(process_name("SecurityHealth", r"C:\x\NotSecurityHealthHost.exe"), "SecurityHealth");
        // missing kernel name: fall back to argv[0]
        assert_eq!(process_name("", r#""C:\x\tool.exe" a"#), "tool.exe");
        assert_eq!(process_name("\0", ""), "");
    }

    #[test]
    fn image_names_the_process_only_when_it_matches_the_kernel_name() {
        // truncated kernel name, full name from the image
        assert_eq!(
            name_from_image("SecurityHealth", r"C:\Windows\System32\SecurityHealthHost.exe").as_deref(),
            Some("SecurityHealthHost.exe")
        );
        assert_eq!(name_from_image("powershell.exe", r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe").as_deref(), Some("powershell.exe"));
        // case differences are fine
        assert_eq!(name_from_image("CMD.EXE", r"C:\Windows\System32\cmd.exe").as_deref(), Some("cmd.exe"));
        // a reused PID now runs something else: the image is not this process
        assert_eq!(name_from_image("rclone.exe", r"C:\Windows\System32\svchost.exe"), None);
        // no kernel name to compare with: trust the image
        assert_eq!(name_from_image("", r"C:\x\tool.exe").as_deref(), Some("tool.exe"));
        assert_eq!(name_from_image("a.exe", ""), None);
    }

    #[test]
    fn wbem_sid_decodes_64_and_32_bit_layouts() {
        // S-1-5-18 (LocalSystem)
        let sid = [1u8, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0];
        let mut wbem64 = vec![0u8; 16];
        wbem64.extend_from_slice(&sid);
        assert_eq!(sid_from_wbem(&wbem64).unwrap(), "S-1-5-18");
        let mut wbem32 = vec![0u8; 8];
        wbem32.extend_from_slice(&sid);
        assert_eq!(sid_from_wbem(&wbem32).unwrap(), "S-1-5-18");
        // S-1-5-21-1-2-3-1001
        let user = [
            1u8, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0xE9, 3, 0, 0,
        ];
        let mut wbem = vec![0u8; 16];
        wbem.extend_from_slice(&user);
        assert_eq!(sid_from_wbem(&wbem).unwrap(), "S-1-5-21-1-2-3-1001");
        assert_eq!(sid_from_wbem(&[0u8; 10]), None);
    }
}
