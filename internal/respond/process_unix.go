//go:build !windows

// Linux/Unix process resolution and verified kill (R1/R2, dictamen
// 04-B 16h11):
//
//   - pidfd path: pidfd_open pins the PROCESS OBJECT (the recycling
//     window cannot redirect the signal to a different object) and
//     pidfd_send_signal delivers SIGKILL through that pin. Kernel
//     >= 5.3; anything else (ENOSYS on old kernels, fd exhaustion,
//     exotic errno) degrades to the fallback, and the audit line
//     records which mechanism actually ran.
//   - fallback path: classic kill(pid) with the residual check→signal
//     window DOCUMENTED here and mitigated by an immediate re-verify
//     of the real name right before the signal — a mismatch, a death
//     or a name flip between the two reads denies the action instead
//     of gambling.
//
// Real-name semantics (R2): basename of readlink(/proc/<pid>/exe).
// When the image link is unreadable for the engine (EACCES —
// cross-user targets without ptrace permission), the fallback source
// is /proc/<pid>/comm, DOCUMENTED with its 15-byte truncation: a
// process whose full name is longer compares as a mismatch and the
// action is denied — the fail-safe direction. Nobody "fixes" that by
// comparing prefixes.

package respond

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"syscall"

	"golang.org/x/sys/unix"
)

// pidfdOpen is a package var so the unit tests can force the fallback
// path deterministically (R1: both paths covered).
var pidfdOpen = func(pid int) (int, error) {
	return unix.PidfdOpen(pid, 0)
}

// resolveProcessName returns the real name of pid per R2 (basename of
// the image link; comm fallback documented above).
func resolveProcessName(pid int) (string, error) {
	exe, err := os.Readlink(procExePath(pid))
	if err == nil {
		return filepath.Base(exe), nil
	}
	switch {
	case errors.Is(err, syscall.ENOENT):
		// either the process is gone or it is a zombie — both deny
		// with pid_not_found (a zombie is already terminating; a
		// kill is meaningless, and refusing is the safe direction)
		return "", errProcessNotFound
	case errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM):
		// cross-user target: the image link needs ptrace permission
		// the engine does not have; degrade to comm (truncated to
		// 15 bytes by the kernel) instead of failing blind
		return readCommName(pid)
	default:
		return "", errProcessAccess
	}
}

func procExePath(pid int) string {
	return "/proc/" + strconv.Itoa(pid) + "/exe"
}

func readCommName(pid int) (string, error) {
	comm, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/comm")
	if err != nil {
		if os.IsNotExist(err) {
			return "", errProcessNotFound
		}
		return "", errProcessAccess
	}
	name := string(comm)
	// strip the single trailing newline; the kernel already did the
	// 15-byte truncation (TASK_COMM_LEN-1) that R2 documents
	for len(name) > 0 && (name[len(name)-1] == '\n' || name[len(name)-1] == '\r') {
		name = name[:len(name)-1]
	}
	return name, nil
}

// nameMatches implements R2 for Unix: exact basename compare — no
// case folding, no prefix matching (the comm truncation must deny,
// not guess).
func nameMatches(resolved, want string) bool {
	return resolved == want
}

// isProtectedDefault implements R6 for Unix: no extra names by
// default. PID 1 is excluded by the pid>1 gate (and is unkillable by
// the kernel outside its init namespace anyway) and the engine's own
// lineage by self_protected; distro init names vary, and inventing a
// list here would be documentation theater. The operator extends the
// list with -respond-protected.
func isProtectedDefault(pid int, resolved string) bool {
	_ = pid
	_ = resolved
	return false
}

// nameInSet checks the resolved name against the operator-supplied
// protected set (exact compare, same semantics as nameMatches).
func nameInSet(resolved string, set map[string]struct{}) bool {
	_, ok := set[resolved]
	return ok
}

// killVerified pins and kills the verified object (R1). The returned
// mechanism string travels in the audit followup and the API
// response: pidfd (pinned object) or fallback (re-verified name).
// On the fallback path the second return carries the errno NAME that
// made pidfd_open fail (pidfdErrName) — the degradation must be loud
// AND diagnosable: enosys is a kernel without pidfd (permanent),
// emfile/enfile is fd exhaustion of a mechanism that was alive
// (transient, worth watching) — 04-B ronda 18h00.
func killVerified(pid int, want string) (string, string, error) {
	fd, perr := pidfdOpen(pid)
	if perr == nil {
		defer unix.Close(fd)
		const mech = "pidfd"
		// the name check runs against /proc AFTER the pin: the signal
		// below can only reach the object that was alive at pin time,
		// so a recycle between readlink and send kills nothing else
		// (worst case the name reads a recycled pid and mismatches →
		// denial, the safe direction).
		resolved, rerr := resolveProcessName(pid)
		if rerr != nil {
			return mech, "", rerr
		}
		if !nameMatches(resolved, want) {
			return mech, "", errNameMismatch
		}
		if serr := unix.PidfdSendSignal(fd, unix.SIGKILL, nil, 0); serr != nil {
			switch {
			case errors.Is(serr, syscall.ESRCH):
				return mech, "", errProcessNotFound
			case errors.Is(serr, syscall.EPERM):
				return mech, "", errProcessAccess
			default:
				return mech, "", errProcessAccess
			}
		}
		return mech, "", nil
	}

	// fallback: classic kill with the documented residual window and
	// the immediate re-verify (dictamen R1) — verify, re-verify,
	// signal, all inside the single-flight span.
	const mech = "fallback"
	reason := pidfdErrName(perr)
	resolved, rerr := resolveProcessName(pid)
	if rerr != nil {
		return mech, reason, rerr
	}
	if !nameMatches(resolved, want) {
		return mech, reason, errNameMismatch
	}
	resolved2, rerr2 := resolveProcessName(pid)
	if rerr2 != nil {
		// the object died between the two reads: deny instead of
		// signaling a number whose object we can no longer see
		return mech, reason, rerr2
	}
	if resolved2 != resolved {
		// the name flipped under us: either a recycle or an exec —
		// both mean "the thing we verified is not the thing that
		// would receive the signal"
		return mech, reason, errNameMismatch
	}
	if serr := unix.Kill(pid, unix.SIGKILL); serr != nil {
		switch {
		case errors.Is(serr, syscall.ESRCH):
			return mech, reason, errProcessNotFound
		case errors.Is(serr, syscall.EPERM):
			return mech, reason, errProcessAccess
		default:
			return mech, reason, errProcessAccess
		}
	}
	return mech, reason, nil
}

// pidfdErrName renders the errno that defeated pidfd_open as the
// short lowercase name the audit line and the API response carry.
// The plausible set is small and each name means something different
// to an operator: enosys (kernel < 5.3, permanent), emfile/enfile
// (fd-table exhaustion — a live mechanism starving, worth an alarm),
// enomem, eperm (seccomp/LSM blocking the syscall in hardened
// containers), einval. Anything else renders as errno_<number> so no
// unknown cause ever masquerades as a known one.
func pidfdErrName(err error) string {
	var errno syscall.Errno
	if !errors.As(err, &errno) {
		return "error"
	}
	switch errno {
	case unix.ENOSYS:
		return "enosys"
	case unix.EMFILE:
		return "emfile"
	case unix.ENFILE:
		return "enfile"
	case unix.ENOMEM:
		return "enomem"
	case unix.EPERM:
		return "eperm"
	case unix.EINVAL:
		return "einval"
	default:
		return "errno_" + strconv.Itoa(int(errno))
	}
}
