package respond

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func writeAudit(t *testing.T, lines ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "")), 0o600); err != nil {
		t.Fatalf("write audit: %v", err)
	}
	return path
}

func recLine(ts, actionID, decision string) string {
	return fmt.Sprintf(`{"ts":%q,"action_id":%q,"decision":%q,"pid":4242,"process_name":"evil.exe","operator":"ana","reason":"triage","host":"lab","signal":"SIGKILL","source":"127.0.0.1:5000"}`+"\n", ts, actionID, decision)
}

func TestReadAuditTailEmptyFile(t *testing.T) {
	path := writeAudit(t, "")
	recs, skipped, truncated, err := ReadAuditTail(path, 10)
	if err != nil {
		t.Fatalf("empty file must not error: %v", err)
	}
	if len(recs) != 0 || skipped != 0 || truncated {
		t.Fatalf("empty file: recs=%d skipped=%d truncated=%v, want 0/0/false", len(recs), skipped, truncated)
	}
}

func TestReadAuditTailNewestFirst(t *testing.T) {
	path := writeAudit(t, recLine("2026-09-30T17:00:01Z", "a1", "executed"), recLine("2026-09-30T17:00:02Z", "a2", "denied"), recLine("2026-09-30T17:00:03Z", "a3", "executed"))
	recs, skipped, truncated, err := ReadAuditTail(path, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if skipped != 0 || truncated {
		t.Fatalf("full scan: skipped=%d truncated=%v, want 0/false", skipped, truncated)
	}
	if len(recs) != 3 {
		t.Fatalf("got %d records, want 3", len(recs))
	}
	for i, want := range []string{"a3", "a2", "a1"} {
		if recs[i].ActionID != want {
			t.Fatalf("record %d = %s, want %s (newest first)", i, recs[i].ActionID, want)
		}
	}
	if recs[0].Decision != "executed" || recs[1].Decision != "denied" {
		t.Fatalf("decision not preserved: %+v", recs)
	}
}

func TestReadAuditTailLimit(t *testing.T) {
	path := writeAudit(t, recLine("2026-09-30T17:00:01Z", "a1", "executed"), recLine("2026-09-30T17:00:02Z", "a2", "denied"), recLine("2026-09-30T17:00:03Z", "a3", "executed"))
	recs, _, truncated, err := ReadAuditTail(path, 2)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(recs) != 2 || recs[0].ActionID != "a3" || recs[1].ActionID != "a2" {
		t.Fatalf("limit: got %v, want [a3 a2]", recs)
	}
	if truncated {
		t.Fatalf("limit does not truncate the scan (the file fit the window)")
	}
}

func TestReadAuditTailTornTailDropped(t *testing.T) {
	// a concurrent append observed mid-write: the last fragment has no
	// closing newline and must be counted, never parsed
	path := writeAudit(t, recLine("2026-09-30T17:00:01Z", "a1", "executed"), `{"ts":"2026-09-30T17:00:02Z","action_id":"a2","dec`)
	recs, skipped, _, err := ReadAuditTail(path, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(recs) != 1 || recs[0].ActionID != "a1" {
		t.Fatalf("torn tail parsed as data: %+v", recs)
	}
	if skipped != 1 {
		t.Fatalf("skipped=%d, want 1 (the torn fragment)", skipped)
	}
}

func TestReadAuditTailMalformedLineSkipped(t *testing.T) {
	// a malformed line in the middle: counted, the rest stays readable
	path := writeAudit(t, recLine("2026-09-30T17:00:01Z", "a1", "executed"), "not-json-at-all\n", recLine("2026-09-30T17:00:03Z", "a3", "executed"))
	recs, skipped, _, err := ReadAuditTail(path, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(recs) != 2 || recs[0].ActionID != "a3" || recs[1].ActionID != "a1" {
		t.Fatalf("malformed line broke the feed: %+v", recs)
	}
	if skipped != 1 {
		t.Fatalf("skipped=%d, want 1", skipped)
	}
}

func TestReadAuditTailTruncatedFlag(t *testing.T) {
	// a file whose whole content exceeds the scan window reports
	// truncated even when the requested records fit inside the window
	var sb strings.Builder
	for i := 0; sb.Len() <= maxAuditScanBytes; i++ {
		sb.WriteString(recLine(fmt.Sprintf("2026-09-30T17:00:%02dZ", i%60), fmt.Sprintf("a%d", i), "executed"))
	}
	path := filepath.Join(t.TempDir(), "big.jsonl")
	if err := os.WriteFile(path, []byte(sb.String()), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	recs, _, truncated, err := ReadAuditTail(path, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !truncated {
		t.Fatalf("truncated=false over a window smaller than the file")
	}
	// the newest record is the last line of the file, window or not
	if len(recs) != 10 {
		t.Fatalf("tail over a truncated window: %d records, want 10", len(recs))
	}
	if recs[0].ActionID == "" {
		t.Fatalf("newest record missing")
	}
	for i := 1; i < len(recs); i++ {
		if recs[i-1].ActionID == recs[i].ActionID {
			t.Fatalf("duplicate record in the tail: %s twice", recs[i].ActionID)
		}
	}
}

func TestReadAuditTailMissingFile(t *testing.T) {
	_, _, _, err := ReadAuditTail(filepath.Join(t.TempDir(), "nope.jsonl"), 10)
	if err == nil {
		t.Fatalf("missing file must error: the armed surface opened it at startup")
	}
}

func TestReadAuditTailLimitZero(t *testing.T) {
	if _, _, _, err := ReadAuditTail(writeAudit(t, ""), 0); err == nil {
		t.Fatalf("limit 0 must error")
	}
}

// The reader must never fight the writer: append lines concurrently
// while tailing and check every returned record is whole and the
// process does not race (run under -race by the battery).
func TestReadAuditTailConcurrentAppend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.jsonl")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	var mu sync.Mutex
	stop := make(chan struct{})
	go func() {
		i := 0
		for {
			select {
			case <-stop:
				return
			default:
			}
			mu.Lock()
			f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
			if err == nil {
				fmt.Fprintf(f, "%s", recLine(time.Now().UTC().Format(time.RFC3339Nano), fmt.Sprintf("live%d", i), "executed"))
				f.Close()
			}
			mu.Unlock()
			i++
			time.Sleep(time.Millisecond)
		}
	}()
	deadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		recs, _, _, err := ReadAuditTail(path, 100)
		if err != nil {
			t.Fatalf("read under concurrent append: %v", err)
		}
		for _, r := range recs {
			if !strings.HasPrefix(r.ActionID, "live") {
				t.Fatalf("torn record surfaced as data: %+v", r)
			}
		}
	}
	close(stop)
}
