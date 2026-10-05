// service.rs: the sensor as a Windows service.
//
// Kernel ETW needs administrator rights; a service is how that is granted
// once, at install (sf-etw -Install), instead of every time in an elevated
// window. `security-sensor.exe --service` hands control to the service
// manager: it reports the start, runs the normal collector, and on
// Stop/Shutdown stops the ETW sessions so the collector returns through
// its usual path (queue drained to the engine or the spool) before the
// service reports it has stopped.
//
// Without a console, the output goes to the file given with --log
// (log_to_file), rotated once when it passes LOG_ROTATE_BYTES.
//
// Raw windows-sys calls, so the dependency tree does not change.

#![cfg(target_os = "windows")]

use anyhow::{bail, Result};
use std::ffi::c_void;
use std::path::Path;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering};
use std::sync::Mutex;

use windows_sys::Win32::Foundation::{ERROR_FAILED_SERVICE_CONTROLLER_CONNECT, NO_ERROR};
use windows_sys::Win32::System::Services::{
    CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus, RegisterServiceCtrlHandlerExW, SetServiceStatus,
    StartServiceCtrlDispatcherW, SC_MANAGER_CONNECT, SERVICE_ACCEPT_SHUTDOWN, SERVICE_ACCEPT_STOP, SERVICE_CONTROL_INTERROGATE,
    SERVICE_CONTROL_SHUTDOWN, SERVICE_CONTROL_STOP, SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_START_PENDING, SERVICE_STATUS,
    SERVICE_STOPPED, SERVICE_STOP_PENDING, SERVICE_TABLE_ENTRYW, SERVICE_WIN32_OWN_PROCESS,
};

/// Service name registered by sf-etw -Install.
pub const SERVICE_NAME: &str = "bluetardigrade-sensor";

/// A log past this size is renamed to <log>.1 when the sensor starts.
const LOG_ROTATE_BYTES: u64 = 8 << 20;

/// ERROR_SERVICE_SPECIFIC_ERROR: the exit code is in dwServiceSpecificExitCode.
const ERROR_SERVICE_SPECIFIC_ERROR: u32 = 1066;
/// ERROR_CALL_NOT_IMPLEMENTED: a control the service does not handle.
const ERROR_CALL_NOT_IMPLEMENTED: u32 = 120;

type Body = Box<dyn FnOnce() -> Result<()> + Send>;

// service_main and the control handler are plain extern functions: what
// they need is handed over through these.
static BODY: Mutex<Option<Body>> = Mutex::new(None);
static STOP: Mutex<Option<fn()>> = Mutex::new(None);
static STATUS_HANDLE: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
static CHECKPOINT: AtomicU32 = AtomicU32::new(0);

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Runs `body` (the collector) as the service's work and `stop` when the
/// service manager asks the service to stop. Returns once the service
/// has stopped. Fails with a clear message when the process was not
/// started by the service manager.
pub fn run(body: Body, stop: fn()) -> Result<()> {
    *BODY.lock().unwrap_or_else(|p| p.into_inner()) = Some(body);
    *STOP.lock().unwrap_or_else(|p| p.into_inner()) = Some(stop);
    let mut name = wide(SERVICE_NAME);
    let table = [
        SERVICE_TABLE_ENTRYW { lpServiceName: name.as_mut_ptr(), lpServiceProc: Some(service_main) },
        SERVICE_TABLE_ENTRYW { lpServiceName: null_mut(), lpServiceProc: None },
    ];
    // SAFETY: the table is NUL-terminated as the API requires and outlives
    // the call, which blocks until the service has stopped.
    if unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) } == 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(ERROR_FAILED_SERVICE_CONTROLLER_CONNECT as i32) {
            bail!("--service is only for the Windows service manager: install the service with 'sf-etw -Install', or run the sensor without --service");
        }
        bail!("service dispatcher failed: {err}");
    }
    Ok(())
}

fn set_state(state: u32, exit_code: u32, wait_hint_ms: u32) {
    let handle = STATUS_HANDLE.load(Ordering::Acquire);
    if handle.is_null() {
        return;
    }
    let pending = state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING;
    let status = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING { SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN } else { 0 },
        dwWin32ExitCode: if exit_code == 0 { NO_ERROR } else { ERROR_SERVICE_SPECIFIC_ERROR },
        dwServiceSpecificExitCode: exit_code,
        dwCheckPoint: if pending { CHECKPOINT.fetch_add(1, Ordering::Relaxed) + 1 } else { 0 },
        dwWaitHint: wait_hint_ms,
    };
    // SAFETY: handle came from RegisterServiceCtrlHandlerExW and status is
    // a fully initialized SERVICE_STATUS.
    unsafe { SetServiceStatus(handle, &status) };
}

unsafe extern "system" fn service_main(_argc: u32, _argv: *mut windows_sys::core::PWSTR) {
    let name = wide(SERVICE_NAME);
    // SAFETY: name is NUL-terminated; the handler is a valid extern fn.
    let handle = unsafe { RegisterServiceCtrlHandlerExW(name.as_ptr(), Some(control_handler), null()) };
    if handle.is_null() {
        eprintln!("[SENSOR] could not register the service control handler: {}", std::io::Error::last_os_error());
        return;
    }
    STATUS_HANDLE.store(handle, Ordering::Release);
    set_state(SERVICE_START_PENDING, 0, 5_000);
    let body = BODY.lock().unwrap_or_else(|p| p.into_inner()).take();
    set_state(SERVICE_RUNNING, 0, 0);
    let code = match body.map(|run| run()) {
        Some(Ok(())) => 0,
        Some(Err(err)) => {
            eprintln!("[SENSOR] service stopped with an error: {err:#}");
            1
        }
        None => 1,
    };
    eprintln!("[SENSOR] service stopped");
    set_state(SERVICE_STOPPED, code, 0);
}

unsafe extern "system" fn control_handler(control: u32, _event_type: u32, _event_data: *mut c_void, _context: *mut c_void) -> u32 {
    match control {
        SERVICE_CONTROL_STOP | SERVICE_CONTROL_SHUTDOWN => {
            // the collector drains its queue (up to 10 s) before returning
            set_state(SERVICE_STOP_PENDING, 0, 15_000);
            eprintln!("[SENSOR] service stop requested");
            if let Some(stop) = *STOP.lock().unwrap_or_else(|p| p.into_inner()) {
                stop();
            }
            NO_ERROR
        }
        SERVICE_CONTROL_INTERROGATE => NO_ERROR,
        _ => ERROR_CALL_NOT_IMPLEMENTED,
    }
}

/// Whether the sensor service is installed and running (or starting).
/// A second, manual sensor would take its ETW sessions over.
pub fn service_running() -> bool {
    // SAFETY: plain handle-based calls; every opened handle is closed and
    // the status struct is written by QueryServiceStatus before it is read.
    unsafe {
        let scm = OpenSCManagerW(null(), null(), SC_MANAGER_CONNECT);
        if scm.is_null() {
            return false;
        }
        let name = wide(SERVICE_NAME);
        let svc = OpenServiceW(scm, name.as_ptr(), SERVICE_QUERY_STATUS);
        let mut running = false;
        if !svc.is_null() {
            let mut status: SERVICE_STATUS = std::mem::zeroed();
            if QueryServiceStatus(svc, &mut status) != 0 {
                running = status.dwCurrentState == SERVICE_RUNNING || status.dwCurrentState == SERVICE_START_PENDING;
            }
            CloseServiceHandle(svc);
        }
        CloseServiceHandle(scm);
        running
    }
}

/// Sends the process's standard output and error to `path` (appending),
/// after renaming a log past LOG_ROTATE_BYTES to <path>.1. A service has
/// no console; every eprintln! of the sensor lands in this file.
pub fn log_to_file(path: &Path) -> Result<()> {
    use std::os::windows::io::IntoRawHandle;
    use windows_sys::Win32::System::Console::{SetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE};

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if std::fs::metadata(path).map(|m| m.len() > LOG_ROTATE_BYTES).unwrap_or(false) {
        let mut old = path.as_os_str().to_owned();
        old.push(".1");
        let _ = std::fs::remove_file(&old);
        std::fs::rename(path, &old)?;
    }
    let file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    let out = file.try_clone()?;
    // the handles stay open for the life of the process
    let (err_handle, out_handle) = (file.into_raw_handle(), out.into_raw_handle());
    // SAFETY: both handles are valid, owned file handles that are never
    // closed; SetStdHandle only records them for GetStdHandle.
    unsafe {
        SetStdHandle(STD_ERROR_HANDLE, err_handle);
        SetStdHandle(STD_OUTPUT_HANDLE, out_handle);
    }
    Ok(())
}
