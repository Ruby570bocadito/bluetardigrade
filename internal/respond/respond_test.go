package respond

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// ---- helpers -------------------------------------------------------

// newTestAudit opens an audit file in a temp dir and returns it with
// its path (tests read the JSONL back to assert every denial is
// recorded).
func newTestAudit(t *testing.T) (*Audit, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	a, err := OpenAudit(path)
	if err != nil {
		t.Fatalf("OpenAudit: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })
	return a, path
}

// newTestManager builds a manager bound to hostname "engine-lab" with
// a controllable clock; extra names land in the operators allowlist.
func newTestManager(t *testing.T, operators ...string) (*Manager, *Audit, string) {
	t.Helper()
	a, path := newTestAudit(t)
	m := NewManager("engine-lab", a)
	if len(operators) > 0 {
		f := filepath.Join(t.TempDir(), "ops.yaml")
		body := "version: 1\nnames:\n"
		for _, n := range operators {
			body += "  - " + n + "\n"
		}
		if err := os.WriteFile(f, []byte(body), 0o600); err != nil {
			t.Fatalf("write ops: %v", err)
		}
		if err := m.LoadOperators(f); err != nil {
			t.Fatalf("LoadOperators: %v", err)
		}
	}
	return m, a, path
}

// spawnSleeper starts a real `sleep 30` process and waits until its
// /proc image link resolves (the name check needs the link).
func spawnSleeper(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot spawn sleep (no coreutils?): %v", err)
	}
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Readlink("/proc/" + strconv.Itoa(cmd.Process.Pid) + "/exe"); err == nil {
			return cmd
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("sleeper image link never resolved")
	return nil
}

// alive reports whether the process still answers signal 0 (only
// meaningful for processes that were NOT killed — killed children
// linger as zombies until Wait reaps them; use waitExited there).
func alive(p *os.Process) bool {
	return p.Signal(syscall.Signal(0)) == nil
}

// waitExited reaps the child and fails the test if SIGKILL did not
// land within the timeout.
func waitExited(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("target survived SIGKILL (3s)")
	}
}

func readAuditLines(t *testing.T, path string) []Record {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read audit: %v", err)
	}
	var recs []Record
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if line == "" {
			continue
		}
		var r Record
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Fatalf("audit line does not parse as JSON: %v (%q)", err, line)
		}
		if _, err := time.Parse(time.RFC3339Nano, r.TS); err != nil {
			t.Fatalf("audit ts not RFC3339Nano: %v", err)
		}
		recs = append(recs, r)
	}
	return recs
}

func killReq(pid int, name string) Request {
	return Request{
		Host:        "ENGINE-LAB", // case differs on purpose: EqualFold is the R3 contract
		PID:         pid,
		ProcessName: name,
		Operator:    "ana",
		Reason:      "unit test",
		Source:      "127.0.0.1:9999",
	}
}

// ---- layer 3: allowlist -------------------------------------------

func TestEmptyAllowlistDeniesEverything(t *testing.T) {
	m, _, path := newTestManager(t) // no operators file loaded
	res := m.Kill(killReq(4242, "sleep"))
	if res.Executed || res.Code != CodeOperatorNotAllowed || res.HTTPStatus != 403 {
		t.Fatalf("want operator_not_allowed/403, got %+v", res)
	}
	recs := readAuditLines(t, path)
	if len(recs) != 1 || recs[0].Decision != "denied" || recs[0].Code != CodeOperatorNotAllowed {
		t.Fatalf("audit must record the denial exactly once, got %+v", recs)
	}
	if recs[0].Source != "127.0.0.1:9999" || recs[0].Operator != "ana" || recs[0].PID != 4242 {
		t.Fatalf("audit attribution missing: %+v", recs[0])
	}
}

func TestOperatorOutsideAllowlistDenied(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	req := killReq(4242, "sleep")
	req.Operator = "eve"
	if res := m.Kill(req); res.Code != CodeOperatorNotAllowed {
		t.Fatalf("want operator_not_allowed, got %+v", res)
	}
}

// ---- R3: the host field is not decorative -------------------------

func TestHostMismatchDenied(t *testing.T) {
	m, _, path := newTestManager(t, "ana")
	req := killReq(4242, "sleep")
	req.Host = "some-remote-host"
	if res := m.Kill(req); res.Code != CodeHostMismatch || res.HTTPStatus != 403 {
		t.Fatalf("want host_mismatch/403, got %+v", res)
	}
	if recs := readAuditLines(t, path); len(recs) != 1 {
		t.Fatalf("denial must be audited, got %d lines", len(recs))
	}
	// an engine with no resolvable hostname must deny, never guess
	m2, _, _ := newTestManager(t, "ana")
	m2.hostname = ""
	if res := m2.Kill(killReq(4242, "sleep")); res.Code != CodeHostMismatch {
		t.Fatalf("empty engine hostname must deny, got %+v", res)
	}
}

// ---- dictamen §4.2: PID validity has its own named code ------------

func TestPIDInvalid(t *testing.T) {
	m, _, path := newTestManager(t, "ana")
	for _, pid := range []int{-1, 0, 1} {
		res := m.Kill(killReq(pid, "sleep"))
		if res.Code != CodePIDInvalid || res.HTTPStatus != 403 {
			t.Fatalf("pid %d: want pid_invalid/403, got %+v", pid, res)
		}
	}
	if recs := readAuditLines(t, path); len(recs) != 3 {
		t.Fatalf("want 3 audit lines, got %d", len(recs))
	}
}

// ---- layer 4: the guard -------------------------------------------

func TestSelfAndAncestorProtected(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	if res := m.Kill(killReq(os.Getpid(), "out")); res.Code != CodeSelfProtected {
		t.Fatalf("self kill must deny self_protected, got %+v", res)
	}
	if res := m.Kill(killReq(os.Getppid(), "out")); res.Code != CodeSelfProtected {
		t.Fatalf("ancestor kill must deny self_protected, got %+v", res)
	}
}

func TestPIDNotFound(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	// int32-max pid: far beyond any real pid_max, /proc has no entry
	if res := m.Kill(killReq(2147483647, "sleep")); res.Code != CodePIDNotFound {
		t.Fatalf("want pid_not_found, got %+v", res)
	}
}

func TestNameMismatchDenied(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	cmd := spawnSleeper(t)
	if res := m.Kill(killReq(cmd.Process.Pid, "notsleep")); res.Code != CodePIDMismatch {
		t.Fatalf("want pid_mismatch, got %+v", res)
	}
	// the mismatched target must still be alive (nothing was sent)
	if !alive(cmd.Process) {
		t.Fatal("target died on a denied request")
	}
}

func TestProtectedListDenied(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	f := filepath.Join(t.TempDir(), "prot.yaml")
	if err := os.WriteFile(f, []byte("version: 1\nnames:\n  - sleep\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadProtected(f); err != nil {
		t.Fatalf("LoadProtected: %v", err)
	}
	cmd := spawnSleeper(t)
	if res := m.Kill(killReq(cmd.Process.Pid, "sleep")); res.Code != CodeProcessProtected {
		t.Fatalf("want process_protected, got %+v", res)
	}
}

// ---- budgets: cooldown + ceilings (Q2) -----------------------------

func TestCooldownBlocksAndExpires(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	cmd := spawnSleeper(t)
	pid := cmd.Process.Pid
	req := killReq(pid, "sleep")

	base := time.Now()
	m.now = func() time.Time { return base }
	if res := m.Kill(req); !res.Executed {
		t.Fatalf("first kill must execute, got %+v", res)
	}
	waitExited(t, cmd)
	// the target is gone now; the cooldown must deny BEFORE the guard
	// would answer pid_not_found (that ordering is the point)
	if res := m.Kill(req); res.Code != CodeCooldownActive || res.HTTPStatus != 429 {
		t.Fatalf("want cooldown_active/429, got %+v", res)
	}
	// after the window the same request degrades to pid_not_found:
	// the cooldown expired, the guard sees a dead pid
	m.now = func() time.Time { return base.Add(Cooldown + time.Second) }
	if res := m.Kill(req); res.Code != CodePIDNotFound {
		t.Fatalf("expired cooldown must fall through to the guard, got %+v", res)
	}
}

func TestGlobalRateCeiling(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	now := time.Now()
	m.now = func() time.Time { return now }
	for i := 0; i < MaxGlobalPerMin; i++ {
		m.globalTimes = append(m.globalTimes, now.Add(-time.Second))
	}
	res := m.Kill(killReq(2147483647, "sleep"))
	if res.Code != CodeRateLimited || res.HTTPStatus != 429 {
		t.Fatalf("want rate_limited/429, got %+v", res)
	}
}

func TestPerOperatorRateCeiling(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	now := time.Now()
	m.now = func() time.Time { return now }
	m.opTimes["ana"] = []time.Time{}
	for i := 0; i < MaxPerOperatorPerMin; i++ {
		m.opTimes["ana"] = append(m.opTimes["ana"], now.Add(-time.Second))
	}
	if res := m.Kill(killReq(2147483647, "sleep")); res.Code != CodeOperatorRateLimited || res.HTTPStatus != 429 {
		t.Fatalf("want operator_rate_limited/429, got %+v", res)
	}
	// another allowlisted operator still has budget: the per-op
	// ceiling is attribution hygiene, not a global lock
	m.mu.Lock()
	m.operators["beto"] = struct{}{}
	m.mu.Unlock()
	req := killReq(2147483647, "sleep")
	req.Operator = "beto"
	if res := m.Kill(req); res.Code != CodePIDNotFound {
		t.Fatalf("beto must reach the guard, got %+v", res)
	}
}

// ---- R4: bounded idempotency ---------------------------------------

func TestIdempotencyRepeatedDenied(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	c1 := spawnSleeper(t)
	c2 := spawnSleeper(t)
	req := killReq(c1.Process.Pid, "sleep")
	req.IdempotencyKey = "op-001"
	if res := m.Kill(req); !res.Executed {
		t.Fatalf("first kill must execute, got %+v", res)
	}
	req2 := killReq(c2.Process.Pid, "sleep")
	req2.IdempotencyKey = "op-001" // same key, different target: still a repeat
	if res := m.Kill(req2); res.Code != CodeIdempotencyRepeated || res.HTTPStatus != 409 {
		t.Fatalf("want idempotency_repeated/409, got %+v", res)
	}
}

func TestIdempotencyEvictionDegrades(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	// fill the map to its cap with dummy keys, oldest = dummy-0
	for i := 0; i < MaxIdempotencyKeys; i++ {
		k := "dummy-" + strconv.Itoa(i)
		m.keys[k] = struct{}{}
		m.keyOrder = append(m.keyOrder, k)
	}
	// a present key is a repeat regardless of the target (the check
	// is the cheapest denial and never touches the guard)
	req0 := killReq(2147483647, "sleep")
	req0.IdempotencyKey = "dummy-0"
	if res := m.Kill(req0); res.Code != CodeIdempotencyRepeated {
		t.Fatalf("dummy-0 must be remembered at this point, got %+v", res)
	}
	// a committed kill with a fresh key evicts the oldest entry
	c1 := spawnSleeper(t)
	req := killReq(c1.Process.Pid, "sleep")
	req.IdempotencyKey = "fresh-key"
	if res := m.Kill(req); !res.Executed {
		t.Fatalf("fresh key must execute, got %+v", res)
	}
	// the EVICTED key degrades to "not remembered": reusing it now
	// executes normally (dictamen §4.4) — the cooldown, not the map,
	// covers immediate retries
	c2 := spawnSleeper(t)
	req2 := killReq(c2.Process.Pid, "sleep")
	req2.IdempotencyKey = "dummy-0"
	if res := m.Kill(req2); !res.Executed {
		t.Fatalf("evicted key must execute again, got %+v", res)
	}
}

// ---- layer 5: audit is a precondition, not telemetry ----------------

func TestAuditBrokenAbortsExecution(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	// a writer whose file is closed simulates every un-writable
	// state (disk full, fsync failure, rotation accident)
	_ = m.audit.Close()
	m.audit.f = nil
	cmd := spawnSleeper(t)
	res := m.Kill(killReq(cmd.Process.Pid, "sleep"))
	if res.Executed || res.Code != CodeAuditUnavailable || res.HTTPStatus != 403 {
		t.Fatalf("want audit_unavailable/403, got %+v", res)
	}
	if !alive(cmd.Process) {
		t.Fatal("the action must NOT happen when it cannot be proven")
	}
}

func TestAuditCeilingDegradesToAuditUnavailable(t *testing.T) {
	m, a, _ := newTestManager(t, "ana")
	// pretend the file already reached the 64 MiB ceiling (Q4)
	a.mu.Lock()
	a.size = MaxAuditBytes
	a.mu.Unlock()
	cmd := spawnSleeper(t)
	res := m.Kill(killReq(cmd.Process.Pid, "sleep"))
	if res.Code != CodeAuditUnavailable {
		t.Fatalf("want audit_unavailable at the ceiling, got %+v", res)
	}
	if !alive(cmd.Process) {
		t.Fatal("no action without audit, even at the ceiling")
	}
}

// ---- happy path: the executed case, with audit line -----------------

func TestExecutedKillRecordsAuditAndSignal(t *testing.T) {
	m, _, path := newTestManager(t, "ana")
	cmd := spawnSleeper(t)
	res := m.Kill(killReq(cmd.Process.Pid, "sleep"))
	if !res.Executed || res.Code != "" || res.HTTPStatus != 200 {
		t.Fatalf("want executed/200, got %+v", res)
	}
	if res.Mechanism != "pidfd" && res.Mechanism != "fallback" {
		t.Fatalf("mechanism must be recorded (R1), got %q", res.Mechanism)
	}
	if len(res.ActionID) != 32 { // 16 bytes hex
		t.Fatalf("action_id must be 32 hex chars, got %q", res.ActionID)
	}
	waitExited(t, cmd)
	recs := readAuditLines(t, path)
	if len(recs) != 1 {
		t.Fatalf("one audit line per attempt, got %d", len(recs))
	}
	r := recs[0]
	if r.Decision != "executed" || r.ActionID != res.ActionID || r.Signal != Signal {
		t.Fatalf("audit line mismatch: %+v vs %+v", r, res)
	}
	if r.Source != "127.0.0.1:9999" || r.Host != "ENGINE-LAB" || r.Reason != "unit test" {
		t.Fatalf("audit attribution/context missing: %+v", r)
	}
}

// ---- loaders --------------------------------------------------------

func TestLoadOperatorsMissingFileIsEmptyAllowlist(t *testing.T) {
	m, _, _ := newTestManager(t)
	if err := m.LoadOperators(filepath.Join(t.TempDir(), "nope.yaml")); err != nil {
		t.Fatalf("missing file must not error: %v", err)
	}
	if m.OperatorsCount() != 0 {
		t.Fatalf("missing file = empty allowlist, got %d", m.OperatorsCount())
	}
}

func TestLoadOperatorsMalformedAndOverCap(t *testing.T) {
	m, _, _ := newTestManager(t)
	bad := filepath.Join(t.TempDir(), "bad.yaml")
	if err := os.WriteFile(bad, []byte("version: 1\nnames: [ana\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadOperators(bad); err == nil {
		t.Fatal("malformed YAML must error (FATAL upstream)")
	}
	versioned := filepath.Join(t.TempDir(), "v2.yaml")
	if err := os.WriteFile(versioned, []byte("version: 2\nnames: [ana]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadOperators(versioned); err == nil {
		t.Fatal("unsupported version must error")
	}
	over := filepath.Join(t.TempDir(), "over.yaml")
	body := "version: 1\nnames:\n"
	for i := 0; i <= MaxOperators; i++ {
		body += "  - op-" + strconv.Itoa(i) + "\n"
	}
	if err := os.WriteFile(over, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadOperators(over); err == nil {
		t.Fatal("over-cap allowlist must error")
	}
}

// ---- structural validation (the handler's 400 family) ---------------

func TestValidate(t *testing.T) {
	ok := killReq(4242, "sleep")
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	cases := []struct {
		name string
		mut  func(*Request)
	}{
		{"missing host", func(r *Request) { r.Host = "" }},
		{"over-cap host", func(r *Request) { r.Host = strings.Repeat("h", MaxHostLen+1) }},
		{"missing pid", func(r *Request) { r.PID = 0 }},
		{"missing name", func(r *Request) { r.ProcessName = "" }},
		{"over-cap name", func(r *Request) { r.ProcessName = strings.Repeat("n", MaxNameLen+1) }},
		{"empty reason", func(r *Request) { r.Reason = "   " }},
		{"over-cap reason", func(r *Request) { r.Reason = strings.Repeat("r", MaxReasonLen+1) }},
		{"missing operator", func(r *Request) { r.Operator = "" }},
		{"over-cap rule_id", func(r *Request) { r.RuleID = strings.Repeat("x", MaxRuleIDLen+1) }},
		{"over-cap alert_id", func(r *Request) { r.AlertID = strings.Repeat("x", MaxAlertIDLen+1) }},
		{"over-cap idempotency_key", func(r *Request) { r.IdempotencyKey = strings.Repeat("x", MaxKeyLen+1) }},
	}
	for _, tc := range cases {
		req := killReq(4242, "sleep")
		tc.mut(&req)
		if err := req.Validate(); err == nil {
			t.Fatalf("%s: must be rejected structurally", tc.name)
		}
	}
}
