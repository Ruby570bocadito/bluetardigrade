// Adversarial round (agent 04): the store must filter exactly like the
// in-memory rings do, and the evidence file it keeps must not be
// readable by every local account. These tests pin both properties.
package store

import (
	"os"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// SQLite's LIKE (and LOWER()) fold ASCII only: a needle like "josé"
// built with Go's Unicode-aware ToLower would never match "José"
// stored mixed-case. The API layer lowercases both sides of the
// free-text filter with Unicode semantics, so the store must fold the
// haystack at write time to stay consistent with the in-memory rings
// (otherwise the same search returns different answers depending on
// whether -store is on).
func TestFreeTextQueryIsUnicodeCaseInsensitive(t *testing.T) {
	s := openTestStore(t)
	base := time.Now().Add(-time.Hour).UTC()

	e := &model.Event{
		ID:        "ev-ñ",
		Timestamp: base,
		Type:      model.TypeProcessCreate,
		Source:    "test",
		Host:      "Servidor-Ñandú",
		User:      "José-García",
		Process:   &model.Process{PID: 4242, Name: "MimiKatz.EXE", CommandLine: "MimiKatz.exe sekurlsa::logonpasswords"},
	}
	if err := s.InsertEvent(e); err != nil {
		t.Fatalf("InsertEvent: %v", err)
	}

	for _, needle := range []string{"ñandú", "ÑANDÚ", "josé-garcía", "mimikatz.exe", "sekurlsa"} {
		got, err := s.QueryEvents(EventQuery{Q: needle, Limit: 10})
		if err != nil {
			t.Fatalf("QueryEvents q=%q: %v", needle, err)
		}
		if len(got) != 1 {
			t.Fatalf("q=%q matched %d events, want 1 (Unicode fold broken)", needle, len(got))
		}
	}
	// negative control: an unrelated needle finds nothing
	if got, _ := s.QueryEvents(EventQuery{Q: "noexiste", Limit: 10}); len(got) != 0 {
		t.Fatalf("unrelated needle matched %d events", len(got))
	}

	// same property on the alert haystack
	a := alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "aaaaaaaa-0001",
		RuleName:  "Credential Dumping",
		Severity:  "high",
		Host:      "Servidor-Ñandú",
		User:      "José-García",
		EventID:   "ev-ñ",
		EventType: model.TypeProcessCreate,
		Summary:   "Atención: acceso a credenciales",
	}
	if err := s.InsertAlert(a); err != nil {
		t.Fatalf("InsertAlert: %v", err)
	}
	for _, needle := range []string{"atención", "ñandú", "josé"} {
		got, err := s.QueryAlerts(AlertQuery{Q: needle, Limit: 10})
		if err != nil {
			t.Fatalf("QueryAlerts q=%q: %v", needle, err)
		}
		if len(got) != 1 {
			t.Fatalf("alert q=%q matched %d alerts, want 1", needle, len(got))
		}
	}
}

// Open must pre-create the database file owner-only: SQLite's own
// creation mode is 0644 minus umask, which on a default server lets
// every local account read the full ingested history (command lines,
// users, hosts). Files the operator created (or chmod'ed) beforehands
// keep their mode — no surprise ownership changes.
func TestOpenPreCreatesDatabaseOwnerOnly(t *testing.T) {
	dir := t.TempDir()
	fresh := dir + "/fresh.db"

	s, err := Open(fresh)
	if err != nil {
		t.Fatalf("Open fresh: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	fi, err := os.Stat(fresh)
	if err != nil {
		t.Fatalf("stat fresh db: %v", err)
	}
	if got := fi.Mode().Perm(); got != 0o600 {
		t.Fatalf("fresh db mode is %o, want 600 (evidence readable by other accounts)", got)
	}

	existing := dir + "/existing.db"
	if err := os.WriteFile(existing, nil, 0o644); err != nil {
		t.Fatalf("seed existing db: %v", err)
	}
	s, err = Open(existing)
	if err != nil {
		t.Fatalf("Open existing: %v", err)
	}
	defer s.Close() //nolint:errcheck
	fi, err = os.Stat(existing)
	if err != nil {
		t.Fatalf("stat existing db: %v", err)
	}
	if got := fi.Mode().Perm(); got != 0o644 {
		t.Fatalf("existing db mode changed to %o, want untouched 644", got)
	}
}
