package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

// A store file that is not a SQLite database fails the start with the way
// out, not only SQLite's own words; any other failure gets no hint.
func TestStoreOpenHintForAnUnusableFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "corrupt.db")
	if err := os.WriteFile(path, []byte(strings.Repeat("not a database ", 600)), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(path)
	if err == nil {
		st.Close()
		t.Fatal("store.Open accepted a file that is not a database")
	}
	if hint := storeOpenHint(err); !strings.Contains(hint, "move it aside") {
		t.Fatalf("no hint for %q", err)
	}
	if hint := storeOpenHint(errors.New("store: open x: permission denied")); hint != "" {
		t.Fatalf("hint for an unrelated error: %q", hint)
	}
}
