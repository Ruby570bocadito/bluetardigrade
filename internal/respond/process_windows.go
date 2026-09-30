//go:build windows

// Windows process resolution and verified kill (R1/R2, dictamen 04-B
// 16h11): ONE OpenProcess handle serves BOTH verification
// (QueryFullProcessImageNameW) and termination (TerminateProcess) —
// the handle pins the process object, so the PID-recycling window
// cannot redirect the kill to a different object. Closing the handle
// is unconditional (defer) even on the denial paths.
//
// Real-name semantics (R2): basename of the full image path,
// compared case-insensitively (NTFS is case-insensitive and Windows
// names arrive in any casing).
//
// The kernel32 calls go through NewLazySystemDLL explicitly instead
// of the x/sys/windows wrappers: the resolution surface here is
// exactly the three calls the design needs, each with its documented
// errno mapping (R7c: access-denied is distinct from not-found).
package respond

import (
	"errors"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	_processQueryLimitedInformation = 0x1000
	_processTerminate               = 0x0001
)

var (
	modkernel32                    = windows.NewLazySystemDLL("kernel32.dll")
	procOpenProcess                = modkernel32.NewProc("OpenProcess")
	procQueryFullProcessImageNameW = modkernel32.NewProc("QueryFullProcessImageNameW")
	procTerminateProcess           = modkernel32.NewProc("TerminateProcess")
	procCloseHandle                = modkernel32.NewProc("CloseHandle")
)

// resolvedTarget carries the pinned object and what the OS says it is.
type resolvedTarget struct {
	handle   syscall.Handle
	resolved string
}

// openTarget opens the process with the single handle that will both
// verify and kill (R1). Access-denied and no-such-process map to
// their own sentinels (R7c).
func openTarget(pid int) (resolvedTarget, error) {
	h, _, err := procOpenProcess.Call(
		uintptr(_processQueryLimitedInformation|_processTerminate),
		0, // inheritHandle: false — the handle is private to this action
		uintptr(pid),
	)
	if h == 0 {
		// Call always returns the last errno as err; OpenProcess
		// documents ERROR_ACCESS_DENIED and ERROR_INVALID_PARAMETER
		// (the "no such process" shape for the pid space Windows
		// knows) — anything else degrades to access-denied
		switch {
		case errors.Is(err, windows.ERROR_ACCESS_DENIED):
			return resolvedTarget{}, errProcessAccess
		case errors.Is(err, windows.ERROR_INVALID_PARAMETER):
			return resolvedTarget{}, errProcessNotFound
		default:
			return resolvedTarget{}, errProcessAccess
		}
	}
	return resolvedTarget{handle: syscall.Handle(h)}, nil
}

// closeTarget releases the pinned handle unconditionally.
func closeTarget(t resolvedTarget) {
	_, _, _ = procCloseHandle.Call(uintptr(t.handle))
}

// resolveProcessName returns the real name of pid per R2 (basename of
// the image path, case preserved; matching is case-insensitive).
func resolveProcessName(pid int) (string, error) {
	t, err := openTarget(pid)
	if err != nil {
		return "", err
	}
	defer closeTarget(t)
	name, err := imageBasename(t.handle)
	if err != nil {
		return "", err
	}
	return name, nil
}

// imageBasename queries the full image path through the pinned
// handle and returns its basename.
func imageBasename(h syscall.Handle) (string, error) {
	var buf [1024]uint16
	size := uint32(len(buf))
	r1, _, _ := procQueryFullProcessImageNameW.Call(
		uintptr(h),
		0, // flags: 0 = Win32 path format
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if r1 == 0 {
		return "", errProcessAccess
	}
	return filepath.Base(windows.UTF16ToString(buf[:size])), nil
}

// nameMatches implements R2 for Windows: case-insensitive basename
// compare. No prefix matching, no wildcarding — an operator who names
// the target imprecisely gets a denial, not a guess.
func nameMatches(resolved, want string) bool {
	return strings.EqualFold(resolved, want)
}

// protectedSystemNames are the irre-killable Windows system processes
// (R6): killing any of them by an allowlist mistake is not reversible
// by relaunching — the whole boot degrades. Matched case-insensitively
// with .exe tolerance (the shipped names carry no suffix; real image
// basenames usually do).
var protectedSystemNames = []string{"csrss", "smss", "wininit", "services", "lsass"}

// isProtectedDefault implements R6 for Windows: the documented
// system set above, never a guess from the operator file alone.
func isProtectedDefault(pid int, resolved string) bool {
	_ = pid
	base := stripExe(resolved)
	for _, n := range protectedSystemNames {
		if strings.EqualFold(base, n) {
			return true
		}
	}
	return false
}

// nameInSet checks the resolved name against the operator-supplied
// protected set with the same case-insensitive, .exe-tolerant
// semantics as the defaults.
func nameInSet(resolved string, set map[string]struct{}) bool {
	base := stripExe(resolved)
	for n := range set {
		if strings.EqualFold(base, stripExe(n)) {
			return true
		}
	}
	return false
}

// stripExe removes a trailing ".exe" (case-insensitive) so the
// protected list matches both spellings of an image name.
func stripExe(name string) string {
	if len(name) >= 4 && strings.EqualFold(name[len(name)-4:], ".exe") {
		return name[:len(name)-4]
	}
	return name
}

// killVerified pins and kills the verified object (R1): the handle
// that verified the name is the handle that terminates, so the kill
// cannot land on an object other than the one the operator named.
func killVerified(pid int, want string) (string, error) {
	const mech = "handle"
	t, err := openTarget(pid)
	if err != nil {
		return mech, err
	}
	defer closeTarget(t)
	resolved, err := imageBasename(t.handle)
	if err != nil {
		return mech, err
	}
	if !nameMatches(resolved, want) {
		// Q3 precision: the name check protects against the
		// MECHANICAL error (wrong PID), not against process
		// hollowing — the flag text says so and the kill decision
		// stays with the operator.
		return mech, errNameMismatch
	}
	r1, _, _ := procTerminateProcess.Call(uintptr(t.handle), 1)
	if r1 == 0 {
		return mech, errProcessAccess
	}
	return mech, nil
}
