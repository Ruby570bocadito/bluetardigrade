// Package respond implements active response (roadmap C3, iteration 1:
// kill_process only, local engine host only). It is deliberately NOT a
// feature bolted onto the alert pipeline: it is a permission
// architecture with one action inside, replicating the design §6.1
// mold (opt-in by layers, loud degradation, full audit) and applying
// the owner's "degrade loudly" philosophy to a destructive action.
//
// Five AND layers, every failure denies AND audits (design §2):
//
//  1. the route does not exist without -allow-kill (wiring in
//     cmd/engine/run.go + internal/api/respond_write.go),
//  2. the hub bearer token is mandatory — even on loopback, stricter
//     than the suppression writes it replicates,
//  3. the operator must be on the -respond-operators allowlist
//     (missing file = empty allowlist = everything denied),
//  4. the process guard verifies the target is the object the
//     operator named: pidfd/handle pinning (R1), real-name match per
//     platform (R2), not the engine or its ancestor, not a protected
//     process (R6), cooldown and rate ceilings respected,
//  5. the audit line is written BEFORE the signal — the action that
//     cannot be proven to have happened, does not happen.
//
// Binding landing requirements honored here: R1 (kill the verified
// object, not the number), R2 (per-platform real-name semantics), R3
// (host mandatory + host_mismatch against the engine hostname), R4
// (bounded idempotency map with oldest-first eviction), R5 (explicit
// audit schema, RemoteAddr attribution, open failure disables the
// surface loudly instead of going FATAL — the caller owns that
// decision), R6 (explicit per-platform protected defaults, hot-reload
// chosen as the reload semantics), R7c (access-denied is distinct
// from not-found) and R8 (no automation path: nothing here is
// reachable from rules, sequences, the correlator or internal/actions
// — the kill is invoked by an operator through the API, period; Q1
// closed the signal at SIGKILL fixed).
package respond

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

// Hard bounds (design §4 + dictamen Q2/Q4/R4). Every bound is a
// denial, never an error: a hostile or looping client meets a wall,
// not a crash.
const (
	// MaxOperators caps the -respond-operators allowlist (same cap
	// house as the rules loader's ceilings).
	MaxOperators = 128
	// MaxProtected caps the optional -respond-protected file.
	MaxProtected = 64
	// Cooldown is the per-(host,pid) window between committed kills:
	// an alert→kill loop must not turn the remedy into the attack.
	Cooldown = 60 * time.Second
	// MaxGlobalPerMin / MaxPerOperatorPerMin are the Q2 ceilings on
	// COMMITTED actions (denials never consume the budget — the
	// budgets bound destruction, not hammering).
	MaxGlobalPerMin      = 20
	MaxPerOperatorPerMin = 6
	// MaxIdempotencyKeys bounds the dedup map (R4: the exact
	// parked-bytes class the house caught twice). Eviction is
	// oldest-first; an evicted key degrades to "idempotency not
	// remembered" (documented) and the cooldown still covers the
	// immediate retry.
	MaxIdempotencyKeys = 1024

	// Field caps (design §3). The handler turns over-caps into 400
	// before the manager is reached; they live here so the audit and
	// the tests share one source of truth.
	MaxHostLen     = 253
	MaxNameLen     = 256
	MaxRuleIDLen   = 128
	MaxAlertIDLen  = 64
	MaxReasonLen   = 512
	MaxOperatorLen = 64
	MaxKeyLen      = 128
	// MaxOperatorTokenLen caps the X-SF-Operator-Token header.
	MaxOperatorTokenLen = 256

	// Signal is fixed for iteration 1 (dictamen Q1 vetoed
	// configurability: a destructive action needs no extra degree of
	// freedom, and SIGTERM against malware is a gift of
	// anti-forensics time).
	Signal = "SIGKILL"
)

// Denial codes (R5a vocabulary). They travel verbatim in the HTTP
// body, the audit line and the engine log.
const (
	CodeOperatorNotAllowed = "operator_not_allowed"
	// CodeOperatorCredential: the operator is listed with a credential
	// (operators file version 2) and the request did not present it.
	CodeOperatorCredential  = "operator_credential_invalid"
	CodeHostMismatch        = "host_mismatch"
	CodePIDInvalid          = "pid_invalid"
	CodePIDMismatch         = "pid_mismatch"
	CodePIDNotFound         = "pid_not_found"
	CodePIDAccessDenied     = "pid_access_denied"
	CodeSelfProtected       = "self_protected"
	CodeProcessProtected    = "process_protected"
	CodeCooldownActive      = "cooldown_active"
	CodeRateLimited         = "rate_limited"
	CodeOperatorRateLimited = "operator_rate_limited"
	CodeAuditUnavailable    = "audit_unavailable"
	CodeIdempotencyRepeated = "idempotency_repeated"
)

// httpStatusFor maps a denial code to its HTTP status (design §3 +
// R7a). It lives here so the handler, the tests and the docs cannot
// diverge about which denial is which status.
func httpStatusFor(code string) int {
	switch code {
	case CodeIdempotencyRepeated:
		return 409
	case CodeCooldownActive, CodeRateLimited, CodeOperatorRateLimited:
		return 429
	default:
		// every permission/guard denial: the engine refused the
		// action for a named reason (403 family, design §3)
		return 403
	}
}

// Request is one active-response attempt. Source carries the client's
// RemoteAddr (R5a attribution: with a shared token, the address is
// the only extra attribution the engine gets for free).
type Request struct {
	Host           string
	PID            int
	ProcessName    string
	RuleID         string
	AlertID        string
	Operator       string
	Reason         string
	IdempotencyKey string
	Source         string
	// OperatorToken is the operator's own credential (header
	// X-SF-Operator-Token). It is checked and then forgotten: never
	// audited, never logged.
	OperatorToken string
}

// Result is the outcome of one attempt. Code is empty exactly when
// Executed is true.
type Result struct {
	Executed  bool
	Code      string
	ActionID  string
	Mechanism string
	// FallbackReason is non-empty exactly when Mechanism is
	// "fallback": the errno name that defeated pidfd_open. Travels
	// in the API response and the engine log
	// next to the mechanism, and in the audit followup line.
	FallbackReason string
	HTTPStatus     int
}

// Manager owns the C3 permission state: operator allowlist, protected
// names, idempotency keys, rate/cooldown budgets and the audit
// writer. The zero value is not usable; build one with NewManager,
// then arm it in the hub with EnableRespondKill (internal/api).
type Manager struct {
	hostname string
	audit    *Audit
	now      func() time.Time

	mu        sync.RWMutex              // guards operators, protected and keys
	operators map[string]operatorDigest // nil digest = version-1 name-only entry
	protected map[string]struct{}
	keys      map[string]struct{}
	keyOrder  []string

	// execMu serializes the guard→audit→signal span (design §4, "1
	// in flight"): active response is deliberate, not a pipeline.
	// Budget state below is only touched inside this span.
	execMu      sync.Mutex
	globalTimes []time.Time
	opTimes     map[string][]time.Time
	cooldown    map[coKey]time.Time
}

type coKey struct {
	host string
	pid  int
}

// NewManager builds the manager around an opened audit writer. A nil
// audit disables the surface by construction: the caller (run.go)
// refuses to arm without it, because audit-before-signal is layer 5
// and there is no degraded "kill without proof" mode.
func NewManager(hostname string, audit *Audit) *Manager {
	return &Manager{
		hostname:  strings.ToLower(strings.TrimSpace(hostname)),
		audit:     audit,
		now:       time.Now,
		operators: map[string]operatorDigest{},
		protected: map[string]struct{}{},
		keys:      map[string]struct{}{},
		opTimes:   map[string][]time.Time{},
		cooldown:  map[coKey]time.Time{},
	}
}

// LoadOperators replaces the allowlist from the YAML file at path
// ({"version": 1, "operators": [...]}). A missing file is NOT an
// error: the allowlist stays empty and every action is denied (design
// §2.3 — safe direction); a malformed file or one over MaxOperators
// IS an error, so the caller can go FATAL at startup and keep the
// previous set loud on hot-reload.
func (m *Manager) LoadOperators(path string) error {
	set, err := loadOperatorFile(path)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.operators = set
	m.mu.Unlock()
	return nil
}

// CredentialedOperators reports how many listed operators must present
// their own credential (operators file version 2).
func (m *Manager) CredentialedOperators() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := 0
	for _, d := range m.operators {
		if d != nil {
			n++
		}
	}
	return n
}

// OperatorsCount reports the live allowlist size (banner).
func (m *Manager) OperatorsCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.operators)
}

// LoadProtected replaces the operator-supplied protected names from
// the optional YAML file (merged over the platform defaults at check
// time, R6). Missing file = defaults only; malformed or over-cap =
// error (same FATAL/keep-previous contract as operators).
func (m *Manager) LoadProtected(path string) error {
	set, err := loadNameFile(path, "protected", MaxProtected)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.protected = set
	m.mu.Unlock()
	return nil
}

// ProtectedCount reports the live protected-name count (banner).
func (m *Manager) ProtectedCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.protected)
}

// AuditSize reports the live audit file size (the read surface exposes
// it against MaxAuditBytes so the console can show how close the proof
// surface is to its rotation ceiling).
func (m *Manager) AuditSize() int64 {
	if m == nil || m.audit == nil {
		return 0
	}
	return m.audit.Size()
}

// Kill runs the five layers in deny-cheap-first order. Every semantic
// denial writes its audit line; structural mistakes (bad JSON,
// missing fields, over-cap strings) never reach the manager — the
// handler answers 400 for those without auditing, because they are
// not attempts, they are noise.
func (m *Manager) Kill(req Request) Result {
	now := m.now()
	res := Result{ActionID: newActionID(), HTTPStatus: 200}

	// cheapest denial first: a repeated idempotency key is a client
	// retry, never a fresh action (409, design §3). This pre-check
	// runs OUTSIDE the single-flight span, so it cannot see a key
	// another request is committing right now — the authoritative
	// re-check happens at commit, inside the span, where the
	// check-then-record sequence is serialized.
	if !m.idempotencyFresh(req.IdempotencyKey) {
		return m.deny(res, req, now, CodeIdempotencyRepeated, "", "")
	}

	// ---- layer 3: operator allowlist (empty allowlist denies all)
	m.mu.RLock()
	digest, opOK := m.operators[req.Operator]
	m.mu.RUnlock()
	if !opOK {
		return m.deny(res, req, now, CodeOperatorNotAllowed, "", "")
	}
	// layer 3b: with a version-2 file the name is not enough — the
	// shared API token does not tell operators apart, their own
	// credential does
	if digest != nil && !credentialMatches(req.OperatorToken, digest) {
		return m.deny(res, req, now, CodeOperatorCredential, "", "")
	}

	// ---- R3: the host field cannot be decorative. A console
	// replaying a REMOTE sensor's alert must not get a local kill on
	// a PID that means something else there.
	if m.hostname == "" || !strings.EqualFold(strings.TrimSpace(req.Host), m.hostname) {
		return m.deny(res, req, now, CodeHostMismatch, "", "")
	}

	// ---- single-flight span: budgets, guards, commit, audit,
	// signal. Everything from here to the signal is serialized, so
	// the check-then-record sequences below cannot race.
	m.execMu.Lock()
	defer m.execMu.Unlock()

	// ---- budgets: cooldown, global and per-operator ceilings
	if code := m.checkBudgets(req, now); code != "" {
		return m.deny(res, req, now, code, "", "")
	}

	// ---- layer 4: the process guard (also yields the platform-
	// resolved real name, which every audit line of this attempt
	// carries — R5a's "nombre RESUELTO", dictamen re-revisión O1)
	code, resolved := m.guardProcess(req)
	if code != "" {
		return m.deny(res, req, now, code, "", resolved)
	}

	// ---- commit: budgets are recorded here (denials above never
	// consume), the idempotency key is remembered from this point on.
	// The commit re-check closes the check-then-act window of the
	// pre-check: two requests carrying the same key can both pass it
	// while the first is still in flight, and the per-(host,pid)
	// cooldown only covers the SAME target — without the re-check one
	// key could authorize two kills on different pids.
	if !m.recordCommit(req, now) {
		return m.deny(res, req, now, CodeIdempotencyRepeated, "", "")
	}

	// ---- layer 5: audit BEFORE the signal. If it fails, the action
	// does not happen (audit_unavailable) — the client's own retry
	// with the same idempotency key would meet 409 anyway, which is
	// why the key is recorded before the audit gate, not after.
	rec := m.auditRecord(req, now, res.ActionID)
	rec.Decision = "executed"
	rec.Resolved = resolved
	if err := m.audit.Write(rec); err != nil {
		res.Code = CodeAuditUnavailable
		res.HTTPStatus = httpStatusFor(res.Code)
		// the denial itself cannot be audited (the writer is down):
		// the engine log is the only trace left, so it goes loud.
		logAuditDown(res, req, err)
		return res
	}

	mech, reason, kerr := killVerified(req.PID, req.ProcessName)
	if kerr != nil {
		// the commit line above already proves the action was
		// authorized; this followup line records the failed outcome
		// so the JSONL never claims an execution that did not land.
		follow := rec
		follow.Decision = "denied"
		follow.Code = processCodeFor(kerr)
		follow.Mechanism = mech
		follow.FallbackReason = reason
		follow.Followup = true
		if werr := m.audit.Write(follow); werr != nil {
			logAuditDown(Result{ActionID: res.ActionID, Code: follow.Code}, req, werr)
		}
		res.Code = follow.Code
		res.HTTPStatus = httpStatusFor(res.Code)
		res.Mechanism = mech
		res.FallbackReason = reason
		return res
	}
	// the pre-signal line was written without the mechanism (it is
	// only known once the send path committed); the mechanism travels
	// in the response and in this engine-log line. One audit line per
	// attempt stays the contract.
	res.Executed = true
	res.Mechanism = mech
	res.FallbackReason = reason
	logExecuted(res, req)
	return res
}

// idempotencyFresh reports whether the key is unseen. Empty keys are
// always fresh (the field is optional, design §3).
func (m *Manager) idempotencyFresh(key string) bool {
	if key == "" {
		return true
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, seen := m.keys[key]
	return !seen
}

// checkBudgets evaluates cooldown + rate ceilings and returns the
// blocking code ("" when every budget allows the action). Expired
// cooldown entries are pruned opportunistically: the map can only
// hold committed kills younger than Cooldown, which the global
// ceiling bounds at MaxGlobalPerMin alive entries.
func (m *Manager) checkBudgets(req Request, now time.Time) string {
	for k, t := range m.cooldown {
		if now.Sub(t) >= Cooldown {
			delete(m.cooldown, k)
		}
	}
	if _, active := m.cooldown[coKey{req.Host, req.PID}]; active {
		return CodeCooldownActive
	}
	cut := now.Add(-time.Minute)
	keep := m.globalTimes[:0]
	for _, t := range m.globalTimes {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	m.globalTimes = keep
	if len(m.globalTimes) >= MaxGlobalPerMin {
		return CodeRateLimited
	}
	opTimes := m.opTimes[req.Operator]
	keepOp := opTimes[:0]
	for _, t := range opTimes {
		if t.After(cut) {
			keepOp = append(keepOp, t)
		}
	}
	m.opTimes[req.Operator] = keepOp
	if len(keepOp) >= MaxPerOperatorPerMin {
		return CodeOperatorRateLimited
	}
	return ""
}

// guardProcess runs the platform guard: self/ancestor, PID validity,
// existence, real-name match (R2) and protected list (R6). It returns
// the blocking code ("" = the target survived every check) plus the
// platform-resolved real name when the target got that far — the
// audit lines of the attempt carry it (R5a, re-revisión O1).
func (m *Manager) guardProcess(req Request) (string, string) {
	// the engine never kills itself or its parent (design §2.4c) —
	// os.Getpid/os.Getppid are the cheap ancestors the design names.
	if req.PID == os.Getpid() || req.PID == os.Getppid() {
		return CodeSelfProtected, ""
	}
	// PID validity (dictamen §4.2): 0/1/negative carry mass-signal
	// semantics on Unix and are denied with their own named code
	// before any syscall touches the target.
	if req.PID <= 1 {
		return CodePIDInvalid, ""
	}
	resolved, rerr := resolveProcessName(req.PID)
	if rerr != nil {
		return processCodeFor(rerr), ""
	}
	if !nameMatches(resolved, req.ProcessName) {
		// R2/dictamen Q3: this check protects against the MECHANICAL
		// error (wrong PID through recycling), not against malware
		// disguising its identity — the -allow-kill flag text says
		// so and the decision stays with the operator.
		return CodePIDMismatch, resolved
	}
	// protected list: platform defaults merged with the operator's
	// optional file. Linux adds no names by default (PID 1 is
	// excluded by the pid>1 gate above and unkillable by the kernel
	// anyway; ancestors are covered by self_protected) — the Windows
	// defaults are the documented unkillable system set.
	m.mu.RLock()
	names := m.protected
	m.mu.RUnlock()
	if isProtectedDefault(req.PID, resolved) || nameInSet(resolved, names) {
		return CodeProcessProtected, resolved
	}
	return "", resolved
}

// recordCommit persists the idempotency key (R4 bounded, oldest-first
// eviction), the rate windows and the cooldown marker. It runs inside
// the single-flight span and returns false when the key was already
// committed by another request: the pre-check in Kill runs outside the
// span, so the authoritative re-check happens here. A false return
// means the caller must deny with CodeIdempotencyRepeated before
// anything executes — the key already proves this is a client retry.
func (m *Manager) recordCommit(req Request, now time.Time) bool {
	if req.IdempotencyKey != "" {
		m.mu.Lock()
		if _, seen := m.keys[req.IdempotencyKey]; seen {
			m.mu.Unlock()
			return false
		}
		if len(m.keyOrder) >= MaxIdempotencyKeys {
			// R4 eviction: the oldest key degrades to
			// "idempotency not remembered"; the cooldown
			// still covers the immediate retry.
			oldest := m.keyOrder[0]
			delete(m.keys, oldest)
			m.keyOrder = m.keyOrder[1:]
		}
		m.keys[req.IdempotencyKey] = struct{}{}
		m.keyOrder = append(m.keyOrder, req.IdempotencyKey)
		m.mu.Unlock()
	}
	m.globalTimes = append(m.globalTimes, now)
	m.opTimes[req.Operator] = append(m.opTimes[req.Operator], now)
	m.cooldown[coKey{req.Host, req.PID}] = now
	return true
}

// auditRecord builds the base record of one attempt (R5a schema):
// requested fields verbatim, attribution (source) included. The
// decision, code and mechanism are filled by the caller depending on
// the outcome.
func (m *Manager) auditRecord(req Request, now time.Time, actionID string) Record {
	return Record{
		TS:       now.UTC().Format(time.RFC3339Nano),
		ActionID: actionID,
		PID:      req.PID,
		Process:  req.ProcessName,
		Operator: req.Operator,
		RuleID:   req.RuleID,
		AlertID:  req.AlertID,
		Reason:   req.Reason,
		Host:     req.Host,
		Source:   req.Source,
		Signal:   Signal,
	}
}

// deny finalizes a denial: audit line (loud engine-log line when the
// writer is down) + code/status on the returned result.
func (m *Manager) deny(res Result, req Request, now time.Time, code, mechanism, resolved string) Result {
	res.Code = code
	res.HTTPStatus = httpStatusFor(code)
	rec := m.auditRecord(req, now, res.ActionID)
	rec.Decision = "denied"
	rec.Code = code
	rec.Mechanism = mechanism
	rec.Resolved = resolved
	if err := m.audit.Write(rec); err != nil {
		logAuditDown(res, req, err)
	}
	return res
}

// logAuditDown reports an audit write failure on the engine log. For
// denials the action already did not happen (the code is unchanged);
// for committed actions blocked at layer 5 the denial reaches the
// client as audit_unavailable. Either way the log line is the trace
// of record when the JSONL is down.
func logAuditDown(res Result, req Request, err error) {
	log.Printf("[RESPOND] AUDIT WRITE FAILED action=%s code=%s pid=%d operator=%s from=%s: %v",
		oneLineLog(res.ActionID), res.Code, req.PID, oneLineLog(req.Operator),
		oneLineLog(req.Source), err)
}

// logExecuted is the engine-log trace of a landed kill: action id,
// resolved name and mechanism let the operator correlate the JSONL
// audit, the API response and the log without guesswork. A fallback
// kill also logs WHY pidfd_open failed — a enosys is an old kernel,
// a emfile/enfile on a kernel that used to pin is an alarm.
func logExecuted(res Result, req Request) {
	if res.FallbackReason != "" {
		log.Printf("[RESPOND] kill executed action=%s pid=%d operator=%s mechanism=%s fallback_reason=%s from=%s",
			oneLineLog(res.ActionID), req.PID, oneLineLog(req.Operator),
			res.Mechanism, oneLineLog(res.FallbackReason), oneLineLog(req.Source))
		return
	}
	log.Printf("[RESPOND] kill executed action=%s pid=%d operator=%s mechanism=%s from=%s",
		oneLineLog(res.ActionID), req.PID, oneLineLog(req.Operator),
		res.Mechanism, oneLineLog(req.Source))
}

// oneLineLog keeps client-controlled strings to one log line (same
// threat model as internal/api oneLine: C0/DEL/C1 become %XX).
func oneLineLog(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) {
			fmt.Fprintf(&b, "%%%02X", r)
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// Validate is the structural gate the handler runs before Kill: it
// returns the first structural problem it finds (rendered as 400) or
// nil when the body is well-formed enough to be an attempt. Semantic
// denials (operator, host, guards) live in Kill and ARE audited.
func (r Request) Validate() error {
	if r.Host == "" {
		return errors.New("host is required (the engine refuses to guess which host the PID belongs to)")
	}
	if len([]rune(r.Host)) > MaxHostLen {
		return fmt.Errorf("host exceeds %d characters", MaxHostLen)
	}
	if r.PID == 0 {
		return errors.New("pid is required")
	}
	if r.ProcessName == "" {
		return errors.New("process_name is required")
	}
	if len([]rune(r.ProcessName)) > MaxNameLen {
		return fmt.Errorf("process_name exceeds %d characters", MaxNameLen)
	}
	if strings.TrimSpace(r.Reason) == "" {
		return errors.New("reason is required and must not be empty")
	}
	if len([]rune(r.Reason)) > MaxReasonLen {
		return fmt.Errorf("reason exceeds %d characters", MaxReasonLen)
	}
	if r.Operator == "" {
		return errors.New("operator is required")
	}
	if len([]rune(r.Operator)) > MaxOperatorLen {
		return fmt.Errorf("operator exceeds %d characters", MaxOperatorLen)
	}
	if len(r.OperatorToken) > MaxOperatorTokenLen {
		return fmt.Errorf("X-SF-Operator-Token exceeds %d bytes", MaxOperatorTokenLen)
	}
	if len([]rune(r.RuleID)) > MaxRuleIDLen {
		return fmt.Errorf("rule_id exceeds %d characters", MaxRuleIDLen)
	}
	if len([]rune(r.AlertID)) > MaxAlertIDLen {
		return fmt.Errorf("alert_id exceeds %d characters", MaxAlertIDLen)
	}
	if len([]rune(r.IdempotencyKey)) > MaxKeyLen {
		return fmt.Errorf("idempotency_key exceeds %d characters", MaxKeyLen)
	}
	return nil
}
