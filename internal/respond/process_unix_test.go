//go:build !windows

package respond

import (
	"fmt"
	"os"
	"strings"
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
	mech, reason, err := killVerified(cmd.Process.Pid, "sleep")
	if err != nil {
		t.Fatalf("pidfd kill: %v", err)
	}
	if mech != "pidfd" {
		t.Fatalf("mechanism = %q, want pidfd", mech)
	}
	// a pinned-object kill has no degradation to explain: the reason
	// must be empty so the wire never carries a phantom cause
	if reason != "" {
		t.Fatalf("fallback_reason = %q, want empty on the pidfd path", reason)
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

	mech, reason, err := killVerified(cmd.Process.Pid, "sleep")
	if err != nil {
		t.Fatalf("fallback kill: %v", err)
	}
	if mech != "fallback" {
		t.Fatalf("mechanism = %q, want fallback", mech)
	}
	// 04-B 18h00: the degradation travels with the mechanism — the
	// operator must be able to tell an old kernel from a starving one
	if reason != "enosys" {
		t.Fatalf("fallback_reason = %q, want enosys", reason)
	}
	waitExited(t, cmd)
}

func TestKillVerifiedFallbackReVerifyDeniesOnNameFlip(t *testing.T) {
	cmd := spawnSleeper(t)
	orig := pidfdOpen
	pidfdOpen = func(pid int) (int, error) { return -1, syscall.ENOSYS }
	t.Cleanup(func() { pidfdOpen = orig })

	// request a name that matches nothing: the fallback must deny
	// with mismatch BEFORE any signal (the target survives), and the
	// errno that forced the fallback still travels with the denial
	_, reason, err := killVerified(cmd.Process.Pid, "notsleep")
	if err != errNameMismatch {
		t.Fatalf("want errNameMismatch, got %v", err)
	}
	if reason != "enosys" {
		t.Fatalf("fallback_reason = %q, want enosys even on denials", reason)
	}
	if !alive(cmd.Process) {
		t.Fatal("mismatched target must survive")
	}
}

// TestPidfdErrNameMapping pins the errno→name vocabulary the audit
// line and the API response carry: each name means something
// different to an operator, so the mapping is a contract, not luck.
func TestPidfdErrNameMapping(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{syscall.ENOSYS, "enosys"},
		{syscall.EMFILE, "emfile"},
		{syscall.ENFILE, "enfile"},
		{syscall.ENOMEM, "enomem"},
		{syscall.EPERM, "eperm"},
		{syscall.EINVAL, "einval"},
		{syscall.Errno(512), "errno_512"},                     // unknown never masquerades
		{fmt.Errorf("wrapped: %w", syscall.EMFILE), "emfile"}, // errors.As unwraps
		{fmt.Errorf("not an errno"), "error"},
	}
	for _, tc := range cases {
		if got := pidfdErrName(tc.err); got != tc.want {
			t.Errorf("pidfdErrName(%v) = %q, want %q", tc.err, got, tc.want)
		}
	}
}

// TestKillVerifiedFallbackReasonEmfile proves the reason is the REAL
// errno of the stub, not a constant: a live mechanism starving
// (emfile) must reach the audit as emfile, never as enosys.
func TestKillVerifiedFallbackReasonEmfile(t *testing.T) {
	cmd := spawnSleeper(t)
	orig := pidfdOpen
	pidfdOpen = func(pid int) (int, error) { return -1, syscall.EMFILE }
	t.Cleanup(func() { pidfdOpen = orig })

	mech, reason, err := killVerified(cmd.Process.Pid, "sleep")
	if err != nil {
		t.Fatalf("fallback kill (emfile): %v", err)
	}
	if mech != "fallback" || reason != "emfile" {
		t.Fatalf("mech/reason = %q/%q, want fallback/emfile", mech, reason)
	}
	waitExited(t, cmd)
}

func TestResolveProcessNameDeadPID(t *testing.T) {
	if _, err := resolveProcessName(2147483647); err != errProcessNotFound {
		t.Fatalf("want errProcessNotFound, got %v", err)
	}
}

// TestKillResultCarriesFallbackReason runs the FULL Kill path (all
// five layers, real child, real audit) with pidfd_open forced to
// fail: the executed Result and the JSONL line must keep the
// certified contract — one pre-signal line WITHOUT mechanism, the
// cause traveling in the response/log — so the degradation is loud
// but the audit schema does not drift.
func TestKillResultCarriesFallbackReason(t *testing.T) {
	m, _, auditPath := newTestManager(t, "t-op")
	orig := pidfdOpen
	pidfdOpen = func(pid int) (int, error) { return -1, syscall.ENOSYS }
	t.Cleanup(func() { pidfdOpen = orig })

	cmd := spawnSleeper(t)
	res := m.Kill(Request{
		Host: "engine-lab", PID: cmd.Process.Pid,
		ProcessName: "sleep", Operator: "t-op",
		Reason: "fallback reason travels", IdempotencyKey: "fb-reason-1",
	})
	if !res.Executed {
		t.Fatalf("kill denied: code=%s", res.Code)
	}
	if res.Mechanism != "fallback" || res.FallbackReason != "enosys" {
		t.Fatalf("mech/reason = %q/%q, want fallback/enosys", res.Mechanism, res.FallbackReason)
	}
	waitExited(t, cmd)

	// the audit line of the attempt: executed, resolved name (O1),
	// and NO mechanism/fallback_reason on the pre-signal line — the
	// mechanism is only known after the send commits (certified
	// contract, one line per attempt).
	lines := readAuditLines(t, auditPath)
	if len(lines) != 1 {
		t.Fatalf("audit lines = %d, want 1 (one line per attempt)", len(lines))
	}
	rec := lines[0]
	if rec.Decision != "executed" || rec.Resolved != "sleep" {
		t.Fatalf("audit line = %+v, want executed with resolved_name=sleep", rec)
	}
	if rec.Mechanism != "" || rec.FallbackReason != "" {
		t.Fatalf("pre-signal line carries mechanism/reason: %+v", rec)
	}
	raw, _ := os.ReadFile(auditPath)
	if strings.Contains(string(raw), "fallback_reason") {
		t.Fatalf("raw JSONL contains fallback_reason on a one-line attempt: %s", raw)
	}
}
