package secretfile

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const testSecret = "s3cr3t-p4ssw0rd-7f3a9c"

func plainEnvelope(t *testing.T) Envelope {
	t.Helper()
	return Envelope{
		Version:    envelopeVersion,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		Scheme:     schemePlain,
		Ciphertext: []byte(testSecret),
	}
}

func writeRaw(t *testing.T, path string, data []byte, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, data, mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// The full cycle the operator will run: engine secret-write, then the
// connector reading the file back. On Windows this exercises DPAPI for
// real (CRYPTPROTECT_LOCAL_MACHINE); on POSIX it exercises the 0600
// plain path.
func TestWriteReadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ad-bind.secret")
	if err := Write(path, []byte(testSecret)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got, warnings, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(got) != testSecret {
		t.Fatalf("round-trip mismatch: got %q, want %q", got, testSecret)
	}
	if runtime.GOOS != "windows" && len(warnings) != 0 {
		t.Fatalf("a plain POSIX envelope must carry no warnings, got %v", warnings)
	}
	Zero(got)
	if got[0] != 0 {
		t.Fatal("Zero must clear the returned buffer")
	}

	// The file on disk is a version-1 envelope with the platform
	// scheme and a parseable creation timestamp.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back envelope: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("on-disk file is not a valid envelope: %v", err)
	}
	if env.Version != envelopeVersion {
		t.Errorf("Version = %d, want %d", env.Version, envelopeVersion)
	}
	if env.Scheme != DefaultScheme() {
		t.Errorf("Scheme = %q, want platform default %q", env.Scheme, DefaultScheme())
	}
	if env.Scheme == schemePlain && string(env.Ciphertext) != testSecret {
		t.Errorf("plain envelope must hold the secret, and it must never be the empty string")
	}
	if _, err := time.Parse(time.RFC3339, env.CreatedAt); err != nil {
		t.Errorf("CreatedAt %q does not parse as RFC 3339: %v", env.CreatedAt, err)
	}
}

func TestWriteInstallsOwnerOnlyMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits carry no ACL meaning on Windows")
	}
	path := filepath.Join(t.TempDir(), "ad-bind.secret")
	if err := Write(path, []byte(testSecret)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		t.Fatalf("installed file mode = %#o, want owner-only (0600 or stricter)", perm)
	}
}

func TestWriteLeavesNoTempFilesBehind(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ad-bind.secret")
	if err := Write(path, []byte(testSecret)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "ad-bind.secret" {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("the install must leave exactly the final file, found %v", names)
	}
}

func TestWriteRejectsEmptySecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ad-bind.secret")
	if err := Write(path, nil); err == nil {
		t.Fatal("Write must refuse an empty secret")
	}
}

// A plain envelope in a world-readable file is a hard failure with an
// actionable message: the sync must not start, and the fix (chmod 600)
// is spelled out.
func TestReadRejectsLoosePerms(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits carry no ACL meaning on Windows")
	}
	path := filepath.Join(t.TempDir(), "ad-bind.secret")
	data, err := json.Marshal(plainEnvelope(t))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	writeRaw(t, path, data, 0o644)
	secret, warnings, err := Read(path)
	if err == nil {
		t.Fatal("Read must refuse a plain envelope with group/other bits")
	}
	if secret != nil {
		t.Error("no secret bytes may be returned alongside the permission error")
	}
	if warnings != nil {
		t.Error("no warnings may be returned alongside the permission error")
	}
	if !strings.Contains(err.Error(), "chmod 600") {
		t.Errorf("the error must be actionable, got: %v", err)
	}
	if strings.Contains(err.Error(), testSecret) {
		t.Error("the error must not contain the secret")
	}
}

// Laboratory parity: a legacy raw password file keeps working. On
// Windows it produces exactly one warning line; on POSIX none.
func TestReadAcceptsLegacyRawFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ad-password")
	writeRaw(t, path, []byte(testSecret+"\n"), 0o600)
	got, warnings, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(got) != testSecret {
		t.Fatalf("got %q, want %q", got, testSecret)
	}
	if runtime.GOOS == "windows" {
		if len(warnings) != 1 || !strings.Contains(warnings[0], "secret-write") {
			t.Fatalf("a raw file on Windows must yield one re-save warning, got %v", warnings)
		}
	} else if len(warnings) != 0 {
		t.Fatalf("a raw file on POSIX must yield no warnings, got %v", warnings)
	}
}

// A plain envelope on Windows is the "plain where dpapi is expected"
// case: it still works (laboratory parity) with a one-line warning.
func TestPlainEnvelopeOnWindowsWarns(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("only meaningful on Windows")
	}
	path := filepath.Join(t.TempDir(), "ad-bind.secret")
	data, err := json.Marshal(plainEnvelope(t))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	writeRaw(t, path, data, 0o600)
	_, warnings, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "scheme=plain") {
		t.Fatalf("want exactly one plain-on-Windows warning, got %v", warnings)
	}
}

// A DPAPI envelope off Windows is an honest dead end, not a panic and
// not a silent fallback: the file was encrypted on a Windows host.
func TestDPAPIEnvelopeOffWindowsFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("meaningful only off Windows")
	}
	path := filepath.Join(t.TempDir(), "ad-bind.secret")
	env := plainEnvelope(t)
	env.Scheme = schemeDPAPI
	env.Ciphertext = []byte("irrelevant")
	data, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	writeRaw(t, path, data, 0o600)
	_, _, err = Read(path)
	if err == nil {
		t.Fatal("a dpapi envelope must not decrypt off Windows")
	}
	if !strings.Contains(err.Error(), "only available on Windows") {
		t.Errorf("the error must say why, got: %v", err)
	}
}

func TestReadEmptyAndBlankFilesFail(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{
		"empty.secret":    "",
		"newlines.secret": "\r\n",
	} {
		path := filepath.Join(dir, name)
		writeRaw(t, path, []byte(content), 0o600)
		if _, _, err := Read(path); err == nil {
			t.Errorf("%s must be rejected", name)
		}
	}
}

// Anything that opens with '{' is claimed as an envelope: a corrupted
// one must be a hard error, never a "password" silently read from the
// JSON fragments.
func TestCorruptEnvelopeIsHardError(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"truncated.secret": `{"version":1,"created_at":"2026-10-06T00:00:00Z","scheme":"plain","ciph`,
		"badb64.secret":    `{"version":1,"created_at":"2026-10-06T00:00:00Z","scheme":"plain","ciphertext":"!!!not-base64!!!"}`,
		"noscheme.secret":  `{"version":1,"created_at":"2026-10-06T00:00:00Z","ciphertext":"aG9sYQ=="}`,
	}
	for name, content := range cases {
		path := filepath.Join(dir, name)
		writeRaw(t, path, []byte(content), 0o600)
		if _, _, err := Read(path); err == nil {
			t.Errorf("%s must be rejected", name)
		} else if !strings.Contains(err.Error(), "envelope") {
			t.Errorf("%s: the error must point at the envelope, got: %v", name, err)
		}
	}
}

func TestUnknownSchemeAndVersionFail(t *testing.T) {
	dir := t.TempDir()
	env := plainEnvelope(t)
	env.Scheme = "rot13"
	data, _ := json.Marshal(env)
	path := filepath.Join(dir, "badscheme.secret")
	writeRaw(t, path, data, 0o600)
	if _, _, err := Read(path); err == nil || !strings.Contains(err.Error(), "unknown scheme") {
		t.Errorf("an unknown scheme must be rejected with a clear error, got: %v", err)
	}

	env = plainEnvelope(t)
	env.Version = 2
	data, _ = json.Marshal(env)
	path = filepath.Join(dir, "badversion.secret")
	writeRaw(t, path, data, 0o600)
	if _, _, err := Read(path); err == nil || !strings.Contains(err.Error(), "version 2") {
		t.Errorf("an unknown version must be rejected with a clear error, got: %v", err)
	}
}

// The envelope carries base64 in JSON, so a plain envelope holding the
// secret round-trips byte-exact through a hand-built file too.
func TestPlainEnvelopeExactBytes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("on Windows the plain scheme carries a warning; covered elsewhere")
	}
	dir := t.TempDir()
	// A secret with characters that stress the trim conventions of the
	// legacy raw path: interior newlines and CR are preserved verbatim.
	want := "line1\nline2\r\nline3"
	env := plainEnvelope(t)
	env.Ciphertext = []byte(want)
	data, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	path := filepath.Join(dir, "ad-bind.secret")
	writeRaw(t, path, data, 0o600)
	got, _, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(got) != want {
		t.Fatalf("envelope secret must round-trip byte-exact, got %q want %q", got, want)
	}
	if base64.StdEncoding.EncodeToString(got) == string(env.Ciphertext) && len(got) == 0 {
		t.Fatal("unreachable guard")
	}
}
