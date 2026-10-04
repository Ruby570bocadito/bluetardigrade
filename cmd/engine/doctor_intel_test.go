package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// a valid entry made by web/console/scripts/console-user.mjs
const sampleAccount = `{"user":"ana","role":"analyst","password":"pbkdf2-sha256$310000$_KLve6QYAD5I99oDLV27QQ$zXuCB95Be4Mg8BhihZCvgaL7nZB-4NMJWUrgQlOzkIA"}`

func findCheck(t *testing.T, checks []doctorCheck, name string) doctorCheck {
	t.Helper()
	for _, c := range checks {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("check %q missing in %+v", name, checks)
	return doctorCheck{}
}

func TestDoctorIntelAndBaselineChecks(t *testing.T) {
	t.Setenv("SF_BASELINE_LEARN", "")
	t.Setenv("CONSOLE_USERS_FILE", "")
	root := t.TempDir()
	if c := findCheck(t, doctorIntelChecks(root), "Inteligencia"); c.Status != "skip" {
		t.Fatalf("no folder: %+v", c)
	}
	if err := os.MkdirAll(filepath.Join(root, "intel"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "intel", "lab.txt"), []byte("203.0.113.9\nmal.example.com\n127.0.0.1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	checks := doctorIntelChecks(root)
	if c := findCheck(t, checks, "Inteligencia"); c.Status != "ok" || !strings.Contains(c.Detail, "2 indicadores en 1 lista") {
		t.Fatalf("lists: %+v", c)
	}
	if c := findCheck(t, checks, "Lista lab"); c.Status != "warn" || !strings.Contains(c.Detail, "1 lineas descartadas") {
		t.Fatalf("skipped lines: %+v", c)
	}
	t.Setenv("SF_BASELINE_LEARN", "dos horas")
	if c := findCheck(t, doctorIntelChecks(root), "Linea base"); c.Status != "warn" {
		t.Fatalf("bad duration: %+v", c)
	}
	t.Setenv("SF_BASELINE_LEARN", "")
	if err := os.MkdirAll(filepath.Join(root, "tools", "config"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "tools", "config", "baseline.learn"), []byte("\xEF\xBB\xBF3m\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if c := findCheck(t, doctorIntelChecks(root), "Linea base"); c.Status != "ok" || !strings.Contains(c.Detail, "3m0s") {
		t.Fatalf("file with a BOM: %+v", c)
	}
	t.Setenv("SF_BASELINE_LEARN", "30m")
	if c := findCheck(t, doctorIntelChecks(root), "Linea base"); c.Status != "ok" || !strings.Contains(c.Detail, "30m0s") {
		t.Fatalf("good duration: %+v", c)
	}
}

func TestDoctorConsoleUsers(t *testing.T) {
	t.Setenv("CONSOLE_USERS_FILE", "")
	root := t.TempDir()
	if c := doctorConsoleUsers(root); c.Status != "skip" {
		t.Fatalf("no file: %+v", c)
	}
	cfg := filepath.Join(root, "tools", "config")
	if err := os.MkdirAll(cfg, 0o700); err != nil {
		t.Fatal(err)
	}
	write := func(body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(cfg, "console-users.json"), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"users":[` + sampleAccount + `]}`)
	if c := doctorConsoleUsers(root); c.Status != "warn" || !strings.Contains(c.Detail, "ningun administrador") {
		t.Fatalf("no admin: %+v", c)
	}
	admin := strings.Replace(strings.Replace(sampleAccount, `"ana"`, `"jefa"`, 1), `"analyst"`, `"admin"`, 1)
	write("\xEF\xBB\xBF[" + sampleAccount + `,` + admin + `]`) // with a UTF-8 BOM
	if c := doctorConsoleUsers(root); c.Status != "ok" || !strings.Contains(c.Detail, "2 cuentas (administradores 1, analistas 1") {
		t.Fatalf("valid: %+v", c)
	}
	for body, want := range map[string]string{
		`{"users":[` + sampleAccount + `,` + sampleAccount + `]}`:       "repetida",
		`{"users":[{"user":"ana","role":"root","password":"x"}]}`:       "rol invalido",
		`{"users":[{"user":"ana","role":"viewer","password":"plain"}]}`: "formato invalido",
		`{"users":[{"user":"a b","role":"viewer","password":"plain"}]}`: "nombre de usuario",
		`{"users":[]}`: "no tiene cuentas",
		`{`:            "no es JSON",
	} {
		write(body)
		if c := doctorConsoleUsers(root); c.Status != "error" || !strings.Contains(c.Detail, want) || !strings.Contains(c.Detail, "bloqueada") {
			t.Fatalf("%s -> %+v", body, c)
		}
	}
}
