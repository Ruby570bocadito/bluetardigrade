package known

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const validDoc = `version: 1
software:
  - name: Lenovo Vantage
    image: 'C:\Program Files (x86)\Lenovo\VantageService\*\LenovoVantage-*.exe'
    signer: 'Lenovo'
  - name: Inventory agent
    sha256:
      - '9a1f2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff'
`

func load(t *testing.T, doc string) *Manager {
	t.Helper()
	p := filepath.Join(t.TempDir(), "known-software.yaml")
	if err := os.WriteFile(p, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	m := New()
	if err := m.LoadFile(p); err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	return m
}

func vantageEvent(image string) *model.Event {
	return &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "LAB-WKS-01",
		Process: &model.Process{PID: 5, Name: "LenovoVantage-something.exe", Image: image},
	}
}

func TestParseAndMatchImageGlob(t *testing.T) {
	m := load(t, validDoc)
	if got := m.Count(); got != 2 {
		t.Fatalf("Count = %d, want 2", got)
	}
	// the plan's exact case: a single-level star inside the path
	name, ok := m.Match(vantageEvent(`C:\Program Files (x86)\Lenovo\VantageService\_6.1.9\LenovoVantage-(4000) Portrait.exe`))
	if !ok || name != "Lenovo Vantage" {
		t.Fatalf("Match = %q %v, want Lenovo Vantage", name, ok)
	}
}

func TestMatchIsCaseInsensitiveAndNormalizesSlashes(t *testing.T) {
	m := load(t, validDoc)
	// arbitrary case (Windows reports paths in any case)
	name, ok := m.Match(vantageEvent(`c:\program files (x86)\LENOVO\vantageservice\6.1\lenovovantage-1.exe`))
	if !ok || name != "Lenovo Vantage" {
		t.Fatalf("case-insensitive match failed: %q %v", name, ok)
	}
	// forward slashes from a non-Windows producer still match
	if _, ok := m.Match(vantageEvent(`C:/Program Files (x86)/Lenovo/VantageService/6.1/LenovoVantage-1.exe`)); !ok {
		t.Fatal("forward-slash path must match the same entry")
	}
}

func TestStarDoesNotCrossDirectorySeparator(t *testing.T) {
	m := load(t, `version: 1
software:
  - name: One Level
    image: 'C:\tools\*\app.exe'
`)
	if _, ok := m.Match(vantageEvent(`C:\tools\app.exe`)); ok {
		t.Fatal("a star must match exactly one path level, not zero")
	}
	if _, ok := m.Match(vantageEvent(`C:\tools\a\b\app.exe`)); ok {
		t.Fatal("a star must not cross a directory separator")
	}
	if _, ok := m.Match(vantageEvent(`C:\tools\vendor\app.exe`)); !ok {
		t.Fatal("single-level star must match one level")
	}
}

func TestMatchBySHA256(t *testing.T) {
	m := load(t, validDoc)
	ev := &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "LAB-WKS-01",
		Process: &model.Process{PID: 5, Name: "invagent.exe", Hashes: model.Hashes{"sha256": "9A1F2C3D4E5F60718293A4B5C6D7E8F900112233445566778899AABBCCDDEEFF"}},
	}
	if name, ok := m.Match(ev); !ok || name != "Inventory agent" {
		t.Fatalf("hash match failed: %q %v", name, ok)
	}
	// a different hash matches nothing
	ev.Process.Hashes["sha256"] = strings.Repeat("0", 64)
	if _, ok := m.Match(ev); ok {
		t.Fatal("a non-listed hash must not match")
	}
}

func TestNoProcessNeverMatches(t *testing.T) {
	m := load(t, validDoc)
	if _, ok := m.Match(&model.Event{Type: model.TypeProcessCreate, Host: "X"}); ok {
		t.Fatal("an event without process telemetry cannot match the list")
	}
	if _, ok := m.Match(nil); ok {
		t.Fatal("nil event cannot match")
	}
}

func TestEnrichmentIsNotForged(t *testing.T) {
	// sanity: the engine-owned key deletion lives in the enricher; here
	// we only assert Match does not depend on any client-provided
	// enrichment (it reads evidence fields only).
	m := load(t, validDoc)
	ev := vantageEvent(`C:\Windows\System32\cmd.exe`)
	ev.Enrichment = map[string]string{"known_software": "Lenovo Vantage"}
	if _, ok := m.Match(ev); ok {
		t.Fatal("a client-supplied enrichment must never influence matching")
	}
}

func TestValidateRejections(t *testing.T) {
	cases := []struct {
		name    string
		doc     string
		wantErr string
	}{
		{"bad version", "version: 2\nsoftware: []\n", "version 2 not supported"},
		{"empty entry", "version: 1\nsoftware:\n  - name: x\n", "both empty"},
		{"no name", "version: 1\nsoftware:\n  - image: 'C:\\a.exe'\n", "name is required"},
		{"bad hash", "version: 1\nsoftware:\n  - name: x\n    sha256: ['abc']\n", "64 hex"},
		{"bad glob", "version: 1\nsoftware:\n  - name: x\n    image: 'C:\\[a'\n", "bad image glob"},
		{"empty name after trim", "version: 1\nsoftware:\n  - name: '   '\n    image: 'C:\\a.exe'\n", "name is required"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Parse([]byte(c.doc))
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("Parse = %v, want error containing %q", err, c.wantErr)
			}
		})
	}
}

func TestMissingFileIsFeatureOff(t *testing.T) {
	m := New()
	if err := m.LoadFile(filepath.Join(t.TempDir(), "absent.yaml")); err != nil {
		t.Fatalf("a missing file is not an error: %v", err)
	}
	if m.Count() != 0 {
		t.Fatal("missing file must yield an empty set")
	}
}

func TestMalformedFileIsAnError(t *testing.T) {
	p := filepath.Join(t.TempDir(), "known-software.yaml")
	if err := os.WriteFile(p, []byte("version: 1\nsoftware:\n  - name: [unclosed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := New().LoadFile(p); err == nil {
		t.Fatal("malformed YAML must fail the load loudly")
	}
}

func TestHotReloadSwapsSet(t *testing.T) {
	p := filepath.Join(t.TempDir(), "known-software.yaml")
	if err := os.WriteFile(p, []byte(validDoc), 0o600); err != nil {
		t.Fatal(err)
	}
	// mtime granularity can swallow a fast rewrite: backdate the first
	// load so the second write is guaranteed to move the mtime.
	past := time.Now().Add(-2 * time.Second)
	if err := os.Chtimes(p, past, past); err != nil {
		t.Fatal(err)
	}
	m := New()
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	changed := validDoc + "  - name: Extra\n    image: 'C:\\extra.exe'\n"
	if err := os.WriteFile(p, []byte(changed), 0o600); err != nil {
		t.Fatal(err)
	}
	reloaded, err := m.ReloadIfChanged(p)
	if err != nil || !reloaded {
		t.Fatalf("ReloadIfChanged = %v %v, want true nil", reloaded, err)
	}
	if m.Count() != 3 {
		t.Fatalf("Count after reload = %d, want 3", m.Count())
	}
	// no change -> no reload
	reloaded, err = m.ReloadIfChanged(p)
	if err != nil || reloaded {
		t.Fatalf("ReloadIfChanged = %v %v, want false nil", reloaded, err)
	}
}
