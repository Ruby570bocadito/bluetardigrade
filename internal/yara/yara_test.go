package yara

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The golden fingerprints below are the sha256 of the stream the sensor
// hashes (sensor/src/yara.rs, load): per rule file, rel + NUL + content,
// sorted by relative path, first 16 hex characters. They pin the engine's
// pack to what a sensor with the same files reports in its heartbeat —
// keep both sides in sync.
const (
	shaOneFile  = "9c51df76c9d327b7" // a.yar alone
	shaTwoFiles = "a528402946b50be4" // a.yar + sub/b.yara
)

const ruleA = "rule a { condition: true }\n"
const ruleB = "rule b { condition: false }"

func writePack(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yar"), []byte(ruleA), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "b.yara"), []byte(ruleB), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ManifestName), []byte(`{"version": "2026-10-22.1", "files": ["a.yar", "sub/b.yara"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestPackFingerprintMirrorsTheSensorAlgorithm(t *testing.T) {
	st, err := Load(writePack(t))
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	out := st.Snapshot()
	if out.Sha16 != shaTwoFiles {
		t.Fatalf("sha16: got %q, want %q", out.Sha16, shaTwoFiles)
	}
	if out.Version != "2026-10-22.1" {
		t.Fatalf("version: %q", out.Version)
	}
	if len(out.Files) != 2 || out.Files[0].Name != "a.yar" || out.Files[1].Name != "sub/b.yara" {
		t.Fatalf("files: %+v", out.Files)
	}
	if out.TotalBytes != int64(len(ruleA)+len(ruleB)) {
		t.Fatalf("total bytes: %d", out.TotalBytes)
	}
	if len(out.Problems) != 0 {
		t.Fatalf("problems: %v", out.Problems)
	}
	if out.Files[0].Bytes != int64(len(ruleA)) {
		t.Fatalf("per-file bytes: %+v", out.Files[0])
	}
}

func TestANonUTF8RuleIsAProblemAndOutsideTheFingerprint(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yar"), []byte(ruleA), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bad.yar"), []byte{0xff, 0xfe, 'r'}, 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	out := st.Snapshot()
	if out.Sha16 != shaOneFile {
		t.Fatalf("sha16: got %q, want %q (the broken file must not join)", out.Sha16, shaOneFile)
	}
	if len(out.Files) != 1 {
		t.Fatalf("files: %+v", out.Files)
	}
	if len(out.Problems) != 1 || !strings.Contains(out.Problems[0], "bad.yar") || !strings.Contains(out.Problems[0], "UTF-8") {
		t.Fatalf("problems: %v", out.Problems)
	}
}

func TestDotDirectoriesAndForeignFilesAreNotThePack(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yar"), []byte(ruleA), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".hidden"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".hidden", "x.yar"), []byte("rule x { condition: true }"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("not a rule"), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	out := st.Snapshot()
	if out.Sha16 != shaOneFile || len(out.Files) != 1 {
		t.Fatalf("pack picked up foreign files: sha %q files %+v", out.Sha16, out.Files)
	}
}

func TestAnEmptyDirectoryHasNoFingerprint(t *testing.T) {
	st, err := Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	out := st.Snapshot()
	if out.Sha16 != "" || len(out.Files) != 0 {
		t.Fatalf("empty pack: %+v", out)
	}
	if err := st.Zip(&bytes.Buffer{}); err != ErrEmptyPack {
		t.Fatalf("zip of an empty pack: %v", err)
	}
}

func TestLoadRejectsANonDirectory(t *testing.T) {
	file := filepath.Join(t.TempDir(), "file.yar")
	if err := os.WriteFile(file, []byte(ruleA), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(file); err == nil {
		t.Fatal("a file as rules directory must be an error")
	}
	if _, err := Load(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("a missing rules directory must be an error")
	}
}

func TestRefreshOnlyWhenTheDirectoryChanges(t *testing.T) {
	dir := writePack(t)
	st, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Refresh() {
		t.Fatal("the first refresh must read the pack")
	}
	if st.Refresh() {
		t.Fatal("an unchanged directory must not re-read")
	}
	// the same content with a fresh mtime: the pack changes, the
	// fingerprint does not (the sensor hashes content, not times)
	path := filepath.Join(dir, "a.yar")
	future := time.Now().Add(2 * time.Hour)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatal(err)
	}
	if !st.Refresh() {
		t.Fatal("an mtime change must re-read")
	}
	if out := st.Snapshot(); out.Sha16 != shaTwoFiles {
		t.Fatalf("sha16 moved with a pure mtime change: %q", out.Sha16)
	}
	// new content: the fingerprint follows
	if err := os.WriteFile(filepath.Join(dir, "sub", "b.yara"), []byte(ruleB+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	if out := st.Snapshot(); out.Sha16 == shaTwoFiles {
		t.Fatalf("sha16 did not follow the content: %q", out.Sha16)
	}
}

func TestTheZipIsDeterministicAndComplete(t *testing.T) {
	st, err := Load(writePack(t))
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	var first, second bytes.Buffer
	if err := st.Zip(&first); err != nil {
		t.Fatal(err)
	}
	if err := st.Zip(&second); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first.Bytes(), second.Bytes()) {
		t.Fatal("the same pack produced two different zips")
	}
	zr, err := zip.NewReader(bytes.NewReader(first.Bytes()), int64(first.Len()))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"a.yar": ruleA, "sub/b.yara": ruleB, ManifestName: `{"version": "2026-10-22.1", "files": ["a.yar", "sub/b.yara"]}`}
	if len(zr.File) != len(want) {
		t.Fatalf("entries: %v", zr.File)
	}
	seen := map[string]bool{}
	for _, f := range zr.File {
		data, err := readEntry(f)
		if err != nil {
			t.Fatal(err)
		}
		if want[f.Name] != string(data) {
			t.Fatalf("entry %s: %q", f.Name, data)
		}
		seen[f.Name] = true
	}
	for name := range want {
		if !seen[name] {
			t.Fatalf("missing entry: %s", name)
		}
	}
}

func readEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(rc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func TestTheZipRefusesAPackBeyondTheCap(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "big.yar"), bytes.Repeat([]byte{0}, MaxPackBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	if err := st.Zip(&bytes.Buffer{}); err != ErrTooLarge {
		t.Fatalf("zip over the cap: %v", err)
	}
}

func TestAFileBeyondTheCapIsListedFromTheStatAndNeverRead(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "big.yar"), bytes.Repeat([]byte{0}, MaxPackBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	out := st.Snapshot()
	if len(out.Files) != 1 || out.Files[0].Name != "big.yar" || out.Files[0].Bytes != MaxPackBytes+1 {
		t.Fatalf("files: %+v", out.Files)
	}
	if out.TotalBytes != MaxPackBytes+1 {
		t.Fatalf("total bytes: %d", out.TotalBytes)
	}
	if len(out.Problems) != 1 || !strings.Contains(out.Problems[0], "big.yar") || !strings.Contains(out.Problems[0], "cap") {
		t.Fatalf("problems: %v", out.Problems)
	}
	if out.Sha16 != "" {
		t.Fatalf("sha16: got %q, want empty (nothing joined the fingerprint)", out.Sha16)
	}
}

func TestTheManifestBeyondTheCapIsAProblemWithTheVersionIgnored(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yar"), []byte(ruleA), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ManifestName), bytes.Repeat([]byte("a"), MaxPackBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Refresh()
	out := st.Snapshot()
	if out.Version != "" {
		t.Fatalf("version: %q", out.Version)
	}
	if out.Sha16 != shaOneFile {
		t.Fatalf("sha16: got %q, want %q (the manifest is not the fingerprint)", out.Sha16, shaOneFile)
	}
	if len(out.Files) != 1 {
		t.Fatalf("files: %+v", out.Files)
	}
	if len(out.Problems) != 1 || !strings.Contains(out.Problems[0], ManifestName) {
		t.Fatalf("problems: %v", out.Problems)
	}
}
