package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yara"
)

func TestDoctorYaraChecks(t *testing.T) {
	// an empty -yara-rules is the engine's own "off": skip, not error
	if c := findCheck(t, doctorYaraChecks(""), "Reglas YARA"); c.Status != "skip" {
		t.Fatalf("empty flag: %+v", c)
	}
	// a missing directory is a skip too: the pack is optional
	root := t.TempDir()
	if c := findCheck(t, doctorYaraChecks(filepath.Join(root, "yara-rules")), "Reglas YARA"); c.Status != "skip" || !strings.Contains(c.Detail, "es opcional") {
		t.Fatalf("missing dir: %+v", c)
	}
	// a healthy pack reports files, bytes and the sha16 the heartbeat carries
	dir := filepath.Join(root, "yara-rules")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ok.yar"), []byte("rule doctor_ok { condition: true }"), 0o600); err != nil {
		t.Fatal(err)
	}
	if c := findCheck(t, doctorYaraChecks(dir), "Reglas YARA"); c.Status != "ok" || !strings.Contains(c.Detail, "1 ficheros de reglas") || !strings.Contains(c.Detail, "sha16 ") {
		t.Fatalf("healthy pack: %+v", c)
	}
	// an empty directory keeps the distribution disabled in practice: warn
	empty := filepath.Join(root, "empty")
	if err := os.MkdirAll(empty, 0o700); err != nil {
		t.Fatal(err)
	}
	if c := findCheck(t, doctorYaraChecks(empty), "Reglas YARA"); c.Status != "warn" || !strings.Contains(c.Detail, "no tiene ficheros de reglas") {
		t.Fatalf("empty dir: %+v", c)
	}
	// a file the sensor refuses is named per file, and the pack still passes
	mixed := filepath.Join(root, "mixed")
	if err := os.MkdirAll(mixed, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mixed, "good.yar"), []byte("rule doctor_good { condition: true }"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mixed, "bad.yar"), []byte{'r', 'u', 'l', 'e', ' ', 0xff, 0xfe, ' ', '{', '}'}, 0o600); err != nil {
		t.Fatal(err)
	}
	checks := doctorYaraChecks(mixed)
	if c := findCheck(t, checks, "Reglas YARA"); c.Status != "ok" {
		t.Fatalf("mixed pack main check: %+v", c)
	}
	if c := findCheck(t, checks, "Fichero YARA"); c.Status != "warn" || !strings.Contains(c.Detail, "bad.yar") || !strings.Contains(c.Detail, "not valid UTF-8") {
		t.Fatalf("mixed pack problem: %+v", c)
	}
	// a pack over the distribution cap cannot be downloaded at all: error,
	// and the offending file is still named so the operator can trim it
	big := filepath.Join(root, "big")
	if err := os.MkdirAll(big, 0o700); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(filepath.Join(big, "huge.yar"))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(int64(yara.MaxPackBytes) + 1); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	checks = doctorYaraChecks(big)
	if c := findCheck(t, checks, "Reglas YARA"); c.Status != "error" || !strings.Contains(c.Detail, "tope de distribucion") {
		t.Fatalf("over-cap pack: %+v", c)
	}
	if c := findCheck(t, checks, "Fichero YARA"); c.Status != "warn" || !strings.Contains(c.Detail, "huge.yar") || !strings.Contains(c.Detail, "beyond the distribution cap") {
		t.Fatalf("over-cap file: %+v", c)
	}
}
