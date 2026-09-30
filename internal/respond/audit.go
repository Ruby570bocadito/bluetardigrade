// Audit writer for active response (C3, layer 5): append-only JSONL,
// one line per attempt, fsync per line, 64 MiB ceiling with
// audit_unavailable semantics (dictamen Q4: "sin respuesta > respuesta
// sin auditoría"). The file is the proof surface of a destructive
// mechanism, so it is never truncated or rewritten — rotation is an
// operator task, exactly like the lifecycle file; when the ceiling is
// reached every attempt degrades to the denial the design already
// defines, never to an unrecorded action.

package respond

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
)

// MaxAuditBytes is the file-size ceiling (dictamen Q4): attempts
// beyond it deny with audit_unavailable until the operator rotates
// the file. 64 MiB of one-line JSON records is ~100k attempts — far
// beyond any honest operator pace, given the 20/min global ceiling.
const MaxAuditBytes = 64 << 20

// ErrCeiling reports the audit file reached MaxAuditBytes.
var ErrCeiling = errors.New("respond audit file reached its 64 MiB ceiling (rotate the file to keep using active response)")

// Record is the audit line schema (R5a — declared here, not implied
// by the encoder): timestamp, decision + code, target, attribution
// and the mechanism actually used. json.Marshal is the escaping
// contract (R5c): control characters in client-supplied strings
// become \u00XX escapes, so one attempt is always exactly one JSONL
// line — noted as a contract, not left to luck.
type Record struct {
	TS        string `json:"ts"`                      // RFC3339Nano, UTC
	ActionID  string `json:"action_id"`               // one id per attempt
	Decision  string `json:"decision"`                // executed | denied
	Code      string `json:"code,omitempty"`          // denial code (R5a vocabulary)
	PID       int    `json:"pid"`                     // requested pid
	Process   string `json:"process_name"`            // requested name
	Resolved  string `json:"resolved_name,omitempty"` // platform-resolved basename when known
	Operator  string `json:"operator"`
	RuleID    string `json:"rule_id,omitempty"`
	AlertID   string `json:"alert_id,omitempty"`
	Reason    string `json:"reason"`
	Host      string `json:"host"`
	Signal    string `json:"signal,omitempty"`    // SIGKILL (Q1: fixed)
	Mechanism string `json:"mechanism,omitempty"` // pidfd | fallback | handle (R1)
	Source    string `json:"source"`              // client RemoteAddr (R5a)
	Followup  bool   `json:"followup,omitempty"`  // second line of a committed send that failed
}

// Audit is the append-only JSONL writer. Write serializes on its own
// mutex: audit lines interleave safely even though the action span is
// single-flight (denials from concurrent requests audit outside it).
type Audit struct {
	mu   sync.Mutex
	f    *os.File
	size int64
}

// ErrAuditDown is returned by methods that need an audit writer and
// got none (the surface must not arm without audit, but a nil-guard
// here keeps the failure loud instead of panicking).
var ErrAuditDown = errors.New("respond audit writer is not open")

// OpenAudit opens (or creates) the audit file in append mode. The
// caller decides what an open failure means (R5b: run.go disables the
// surface loudly and keeps detection alive — it is NOT fatal).
func OpenAudit(path string) (*Audit, error) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("respond audit: open %s: %w", path, err)
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("respond audit: stat %s: %w", path, err)
	}
	return &Audit{f: f, size: st.Size()}, nil
}

// Size reports the current audit file size (startup banner checks the
// ceiling and warns before the first denial does).
func (a *Audit) Size() int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.size
}

// Write appends exactly one JSONL line and fsyncs it (design §4:
// "append-only JSONL, 1 línea por intento, fsync por línea"). The
// ceiling check happens BEFORE the write, so an attempt that cannot
// be recorded never executes and never half-writes.
func (a *Audit) Write(rec Record) error {
	if a == nil || a.f == nil {
		return ErrAuditDown
	}
	line, err := json.Marshal(rec)
	if err != nil {
		// unreachable for this struct (all fields are JSON-safe),
		// but a proof surface does not assume "unreachable"
		return fmt.Errorf("respond audit: marshal: %w", err)
	}
	line = append(line, '\n')
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.size+int64(len(line)) > MaxAuditBytes {
		return ErrCeiling
	}
	n, err := a.f.Write(line)
	a.size += int64(n)
	if err != nil {
		return fmt.Errorf("respond audit: write: %w", err)
	}
	if err := a.f.Sync(); err != nil {
		return fmt.Errorf("respond audit: fsync: %w", err)
	}
	return nil
}

// Close closes the underlying file (engine shutdown path).
func (a *Audit) Close() error {
	if a == nil || a.f == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	err := a.f.Close()
	a.f = nil
	return err
}

// newActionID mints the per-attempt id (128 bits of crypto/rand, hex)
// shared by the audit line and the API response, so an incident
// reviewer can join both without timestamps alone.
func newActionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand never fails on Linux/Windows in practice; a
		// proof surface does not guess an id silently on failure —
		// the attempt is denied upstream (Kill still returns a
		// result; the empty id surfaces in the audit as a defect).
		return "unavailable"
	}
	return hex.EncodeToString(b[:])
}
