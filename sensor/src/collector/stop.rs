// The stop paths: the shared STOP_REQUESTED flag (so a stop asked for
// before the sessions exist is seen too), stop_sessions for the Ctrl+C
// handler and the service's Stop control, and the console handler
// registration that routes Ctrl+C/Ctrl+Break/console close into it.

use std::sync::atomic::{AtomicBool, Ordering};

use super::config::{FILE_SESSION_NAME, NETREG_SESSION_NAME, SESSION_NAME};

/// Set by stop_sessions: a stop asked for before the sessions exist
/// (the first-start enrollment) is seen too.
pub static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Stops both ETW sessions: ProcessTrace returns and run() finishes
/// through its normal path (queue drained, counters reported). Used by
/// the Ctrl+C handler and by the service's Stop control.
pub fn stop_sessions() {
    STOP_REQUESTED.store(true, Ordering::Release);
    let _ = ferrisetw::trace::stop_trace_by_name(NETREG_SESSION_NAME);
    let _ = ferrisetw::trace::stop_trace_by_name(FILE_SESSION_NAME);
    let _ = ferrisetw::trace::stop_trace_by_name(SESSION_NAME);
}

/// Stops both sessions on Ctrl+C, Ctrl+Break or console close, so
/// ProcessTrace returns and the sensor exits through its normal path
/// (session ended, counters reported) without leaving a session running
/// in the kernel.
pub(super) fn install_console_handler() {
    unsafe extern "system" fn on_console_event(_ctrl_type: u32) -> windows_sys::core::BOOL {
        stop_sessions();
        1 // handled: the main thread finishes once ProcessTrace returns
    }
    // SAFETY: registers a plain function with the documented signature;
    // the handler only calls ControlTrace through ferrisetw.
    let ok = unsafe { windows_sys::Win32::System::Console::SetConsoleCtrlHandler(Some(on_console_event), 1) };
    if ok == 0 {
        eprintln!("[SENSOR] warning: could not install the Ctrl+C handler; stop the sessions with 'logman stop {SESSION_NAME} -ets' and 'logman stop {NETREG_SESSION_NAME} -ets' and 'logman stop {FILE_SESSION_NAME} -ets' after exiting");
    }
}
