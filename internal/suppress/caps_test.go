// Adversarial round (agent 04): entry fields carry length caps shared
// by the YAML loader and the API write path, and SaveFile refuses to
// persist a set that breaks them (a set the next hot-reload would
// reject must never reach the disk).
package suppress

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateEntryFieldCaps(t *testing.T) {
	ok := func(e Entry, name string) {
		t.Helper()
		if err := ValidateEntry(e); err != nil {
			t.Errorf("%s: unexpected error: %v", name, err)
		}
	}
	bad := func(e Entry, name, want string) {
		t.Helper()
		err := ValidateEntry(e)
		if err == nil {
			t.Errorf("%s: expected an error, got none", name)
			return
		}
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%s: error = %q, want it to mention %q", name, err, want)
		}
	}

	ok(Entry{RuleID: strings.Repeat("a", MaxRuleIDLen)}, "rule_id at cap")
	ok(Entry{Host: strings.Repeat("h", MaxHostLen)}, "host at cap")
	ok(Entry{RuleID: "r", Reason: strings.Repeat("n", MaxReasonLen)}, "reason at cap")
	ok(Entry{RuleID: "r", Expires: "2026-10-02T00:00:00.999999999+23:59"}, "expires at max length")

	bad(Entry{RuleID: strings.Repeat("a", MaxRuleIDLen+1)}, "rule_id over cap", "rule_id longer")
	bad(Entry{RuleID: "r", Host: strings.Repeat("h", MaxHostLen+1)}, "host over cap", "host longer")
	bad(Entry{RuleID: "r", Reason: strings.Repeat("n", MaxReasonLen+1)}, "reason over cap", "reason longer")
	bad(Entry{RuleID: "r", Expires: strings.Repeat("9", MaxExpiresLen+1)}, "expires over cap", "expires longer")
}

func TestSaveFileRefusesOverCapEntries(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	entries := []Entry{{RuleID: strings.Repeat("a", MaxRuleIDLen+1)}}
	if err := SaveFile(p, entries); err == nil {
		t.Fatal("SaveFile accepted an over-cap entry")
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Errorf("the target file must not exist after a refused write (stat err = %v)", err)
	}
}
