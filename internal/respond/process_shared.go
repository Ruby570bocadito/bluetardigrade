// Platform-neutral process sentinels: the guard and the kill path
// map every platform failure onto exactly three denials (R7c —
// access-denied is distinct from not-found, so a privilege problem is
// never investigated as a phantom-PID hunt), plus the name mismatch
// the design treats as its own guard outcome.

package respond

import (
	"errors"
)

// Sentinel errors shared by both platform files.
var (
	// errProcessNotFound: nothing answers at that PID (ENOENT/ESRCH
	// family) — includes zombie entries whose image link is gone.
	errProcessNotFound = errors.New("process not found")
	// errNameMismatch: the resolved real name does not match the
	// requested process_name (R2 semantics per platform).
	errNameMismatch = errors.New("resolved process name does not match the requested name")
	// errProcessAccess: the object exists but the engine lacks the
	// permission to verify and/or signal it (EACCES/EPERM family).
	errProcessAccess = errors.New("process exists but the engine lacks permission to verify or signal it")
	// errProcessProtected: the object pinned for the kill turned out
	// to be a protected system process (the guard saw another object
	// at that PID, or could not see this one's path).
	errProcessProtected = errors.New("process is protected")
)

// processCodeFor maps a platform error onto its audit/HTTP denial
// code (R5a vocabulary). Unknown errors degrade to access-denied:
// the honest code when the engine cannot say what it saw.
func processCodeFor(err error) string {
	switch {
	case errors.Is(err, errProcessNotFound):
		return CodePIDNotFound
	case errors.Is(err, errNameMismatch):
		return CodePIDMismatch
	case errors.Is(err, errProcessProtected):
		return CodeProcessProtected
	default:
		return CodePIDAccessDenied
	}
}
