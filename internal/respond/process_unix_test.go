//go:build !windows

package respond

import (
	"os"
	"syscall"
	"testing"
)

// R1: both kill mechanisms are covered — the pidfd path (pinned
// object) and the classic fallback (re-verified name). The pidfd
// probe is skipped gracefully on kernels without pidfd_open (< 5.3):
// CI runs 5.15+/6.x, so both paths execute there.

func pidfdSupported(t *testing.T) bool {
	t.Helper()
	fd, err := pidfdOpen(os.Getpid())
	if err != nil {
		return false
	}
	_ = syscall.Close(fd)
	return true
}

func TestKillVerifiedPidfdPath(t *testing.T) {
	if !pidfdSupported(t) {
		t.Skip("kernel without pidfd_open (< 5.3): fallback covers this host")
	}
	cmd := spawnSleeper(t)
	mech, err := killVerified(cmd.Process.Pid, "sleep")
	if err != nil {
		t.Fatalf("pidfd kill: %v", err)
	}
	if mech != "pidfd" {
		t.Fatalf("mechanism = %q, want pidfd", mech)
	}
	waitExited(t, cmd)
}

func TestKillVerifiedFallbackPath(t *testing.T) {
	cmd := spawnSleeper(t)
	// force the fallback deterministically (R1: both paths covered
	// regardless of the host kernel)
	orig := pidfdOpen
	pidfdOpen = func(pid int) (int, error) { return -1, syscall.ENOSYS }
	t.Cleanup(func() { pidfdOpen = orig })

	mech, err := killVerified(cmd.Process.Pid, "sleep")
	if err != nil {
		t.Fatalf("fallback kill: %v", err)
	}
	if mech != "fallback" {
		t.Fatalf("mechanism = %q, want fallback", mech)
	}
	waitExited(t, cmd)
}

func TestKillVerifiedFallbackReVerifyDeniesOnNameFlip(t *testing.T) {
	cmd := spawnSleeper(t)
	orig := pidfdOpen
	pidfdOpen = func(pid int) (int, error) { return -1, syscall.ENOSYS }
	t.Cleanup(func() { pidfdOpen = orig })

	// request a name that matches nothing: the fallback must deny
	// with mismatch BEFORE any signal (the target survives)
	if _, err := killVerified(cmd.Process.Pid, "notsleep"); err != errNameMismatch {
		t.Fatalf("want errNameMismatch, got %v", err)
	}
	if !alive(cmd.Process) {
		t.Fatal("mismatched target must survive")
	}
}

func TestResolveProcessNameDeadPID(t *testing.T) {
	if _, err := resolveProcessName(2147483647); err != errProcessNotFound {
		t.Fatalf("want errProcessNotFound, got %v", err)
	}
}
