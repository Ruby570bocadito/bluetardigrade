// Win32 queries around process images: the NT device map of the drive
// letters and the full image path of a live process. Both feed the
// process/Kernel-Process handlers, which cannot trust argv[0].

use crate::ntpath::DeviceMap;

/// NT device prefixes of the drive letters, to turn Kernel-Process image
/// names ("\Device\HarddiskVolume3\...") into Win32 paths.
pub(super) fn device_map() -> DeviceMap {
    use windows_sys::Win32::Storage::FileSystem::QueryDosDeviceW;
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let drive = format!("{}:", letter as char);
        let name: Vec<u16> = drive.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buf = [0u16; 512];
        // SAFETY: name is NUL-terminated UTF-16 and buf is writable for the
        // length passed; the call writes at most that many characters.
        let n = unsafe { QueryDosDeviceW(name.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
        if n == 0 {
            continue;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let target = String::from_utf16_lossy(&buf[..end]);
        if !target.is_empty() {
            drives.push((target, drive));
        }
    }
    DeviceMap::new(drives, &std::env::var("SystemRoot").unwrap_or_else(|_| String::from(r"C:\Windows")))
}

/// Full Win32 path of a running process's image, from the kernel (not
/// argv[0], which the caller controls). None when the process already
/// exited or cannot be opened.
pub(super) fn image_path(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if pid <= 4 {
        return None; // Idle and System have no image file
    }
    // SAFETY: OpenProcess has no pointer arguments; a null handle is
    // checked before use and every opened handle is closed below.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: buf is writable for `len` UTF-16 units and the call writes
    // at most that many, updating len to the characters written.
    let ok = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) };
    // SAFETY: handle came from OpenProcess and is closed exactly once.
    unsafe { CloseHandle(handle) };
    if ok == 0 || len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]))
}
