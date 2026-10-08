// Audit writer for active response (C3, layer 5): append-only JSONL,
// one line per attempt, fsync per line, 64 MiB ceiling with
// audit_unavailable semantics (Q4: "sin respuesta > respuesta
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

// MaxAuditBytes is the file-size ceiling (Q4): attempts
// beyond it deny with audit_unavailable until the operator rotates
// the file. 64 MiB of one-line JSON records is ~100k attempts — far
// beyond any honest operator pace, given the 20/min global ceiling.
const MaxAuditBytes = 64 << 20

// MaxDenialAuditBytes is the ceiling DENIAL lines must respect:
// 4 MiB of the file stay reserved for EXECUTED lines (the proof of a
// real kill) so a hostile client hammering denials can never fill the
// file to the point where a legitimate kill degrades to
// audit_unavailable. With ~400 B per line that reserves ~10k executed
// records — orders of magnitude above the 20/min committed-action
// ceiling between rotations.
const MaxDenialAuditBytes = MaxAuditBytes - 4<<20

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
        // FallbackReason travels ONLY with mechanism=fallback: the errno
        // name that made pidfd_open fail and forced the classic-kill path.
        // enosys means the kernel predates pidfd (permanent, expected);
        // emfile/enfile mean fd-table exhaustion of a LIVE mechanism —
        // operationally different, sometimes an alarm. Without this field
        // a fallback line cannot tell those apart (forward requirement of
        // the pidfd->fallback degradation).
        FallbackReason string `json:"fallback_reason,omitempty"`
        Source         string `json:"source"`             // client RemoteAddr (R5a)
        Followup       bool   `json:"followup,omitempty"` // second line of a committed send that failed
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
//
// Torn-tail recovery: a process crash can leave a final line without
// its \n (fsync per line bounds the window, but the crash can land
// between the write and the sync). Appending after a torn line would
// concatenate the next record onto the partial line and corrupt BOTH —
// the fragment is already unreadable, the next record must not die
// with it. One recovery newline re-aligns the boundary without
// touching a single existing byte: append-only and never rewritten
// stay true, the torn fragment remains in the file for forensics, and
// the read side (audit_read.go) already degrades a malformed line to
// absence instead of a fake record.
func OpenAudit(path string) (*Audit, error) {
        // O_RDWR (not O_WRONLY): the recovery probes the last byte with
        // ReadAt, which needs a readable fd; O_APPEND keeps every write
        // landing at the end exactly as before.
        f, err := os.OpenFile(path, os.O_RDWR|os.O_APPEND|os.O_CREATE, 0o600)
        if err != nil {
                return nil, fmt.Errorf("respond audit: open %s: %w", path, err)
        }
        st, err := f.Stat()
        if err != nil {
                f.Close()
                return nil, fmt.Errorf("respond audit: stat %s: %w", path, err)
        }
        size := st.Size()
        if size > 0 {
                last := make([]byte, 1)
                if _, rerr := f.ReadAt(last, size-1); rerr == nil && last[0] != '\n' {
                        if _, werr := f.Write([]byte{'\n'}); werr != nil {
                                f.Close()
                                return nil, fmt.Errorf("respond audit: torn-tail recovery: %w", werr)
                        }
                        size++
                }
        }
        return &Audit{f: f, size: size}, nil
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
// be recorded never executes and never half-writes. Executed lines
// (and only they) may use the FULL ceiling — the denial headroom is
// reserved for exactly this call.
func (a *Audit) Write(rec Record) error {
        return a.write(rec, MaxAuditBytes)
}

// WriteDenial appends one denial line under the REDUCED ceiling: past
// MaxDenialAuditBytes denials stop being recorded (the denial itself
// still reaches the client unchanged) and the headroom stays intact
// for executed lines until an operator rotates the file.
func (a *Audit) WriteDenial(rec Record) error {
        return a.write(rec, MaxDenialAuditBytes)
}

func (a *Audit) write(rec Record, ceiling int64) error {
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
        if a.size+int64(len(line)) > ceiling {
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
