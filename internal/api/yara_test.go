package api

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yara"
)

const testRuleA = "rule a { condition: true }\n"

// setTestYara arms the hub with a pack of one rule (and, when withManifest,
// a bundle.json naming the version).
func setTestYara(t *testing.T, h *Hub, withManifest bool) *yara.Store {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yar"), []byte(testRuleA), 0o600); err != nil {
		t.Fatal(err)
	}
	if withManifest {
		if err := os.WriteFile(filepath.Join(dir, yara.ManifestName), []byte(`{"version": "2026-10-22.1"}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	st, err := yara.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	h.SetYara(st)
	return st
}

func TestYaraEndpointWithoutPack(t *testing.T) {
	_, addr := newTestHub(t)
	var out yaraPayload
	getJSON(t, fmt.Sprintf("http://%s/api/yara", addr), &out)
	if out.Enabled || len(out.Files) != 0 || len(out.Problems) != 0 {
		t.Fatalf("payload: %+v", out)
	}
	res, err := http.Get(fmt.Sprintf("http://%s/api/yara/bundle", addr))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("bundle without a pack: %d", res.StatusCode)
	}
}

func TestYaraStatusAndBundle(t *testing.T) {
	h, addr := newTestHub(t)
	setTestYara(t, h, true)
	var out yaraPayload
	getJSON(t, fmt.Sprintf("http://%s/api/yara", addr), &out)
	if !out.Enabled || out.Version != "2026-10-22.1" || len(out.Files) != 1 || out.Files[0].Name != "a.yar" {
		t.Fatalf("payload: %+v", out)
	}
	if out.Files[0].Bytes != int64(len(testRuleA)) || out.TotalBytes != int64(len(testRuleA)) {
		t.Fatalf("bytes: %+v", out)
	}
	if out.Sha16 == "" || len(out.Sha16) != 16 {
		t.Fatalf("sha16: %q", out.Sha16)
	}
	// the bundle: a zip the operator drops next to the sensor's rules
	url := fmt.Sprintf("http://%s/api/yara/bundle", addr)
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("bundle: %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("content type: %q", ct)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.Contains(cd, "yara-bundle-"+out.Sha16+".zip") {
		t.Fatalf("content disposition: %q", cd)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("the bundle is not a zip: %v", err)
	}
	if len(zr.File) != 2 {
		t.Fatalf("entries: %v", zr.File)
	}
	for _, f := range zr.File {
		data := readZipEntry(t, f)
		if f.Name == "a.yar" && string(data) != testRuleA {
			t.Fatalf("a.yar: %q", data)
		}
		if f.Name == yara.ManifestName && !strings.Contains(string(data), "2026-10-22.1") {
			t.Fatalf("manifest: %q", data)
		}
	}
	// the same pack downloads byte-identical (deterministic zip)
	res2, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	body2, _ := io.ReadAll(res2.Body)
	if !bytes.Equal(body, body2) {
		t.Fatal("the same pack produced two different downloads")
	}
}

func TestYaraBundleEmptyPack(t *testing.T) {
	h, addr := newTestHub(t)
	// a bare directory: the status answers, the bundle has nothing to serve
	empty, err := yara.Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h.SetYara(empty)
	var out yaraPayload
	getJSON(t, fmt.Sprintf("http://%s/api/yara", addr), &out)
	if !out.Enabled || out.Sha16 != "" || len(out.Files) != 0 {
		t.Fatalf("empty pack payload: %+v", out)
	}
	res, err := http.Get(fmt.Sprintf("http://%s/api/yara/bundle", addr))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("bundle of an empty pack: %d", res.StatusCode)
	}
}

func TestYaraStatusNamesFilesASensorWouldRefuse(t *testing.T) {
	h, addr := newTestHub(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yar"), []byte(testRuleA), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bad.yar"), []byte{0xff, 0xfe, 'r'}, 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := yara.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	h.SetYara(st)
	var out yaraPayload
	getJSON(t, fmt.Sprintf("http://%s/api/yara", addr), &out)
	if len(out.Files) != 1 || len(out.Problems) != 1 || !strings.Contains(out.Problems[0], "bad.yar") {
		t.Fatalf("payload: %+v", out)
	}
	// the bundle serves exactly the files the fingerprint covers
	res, err := http.Get(fmt.Sprintf("http://%s/api/yara/bundle", addr))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	if len(zr.File) != 1 || zr.File[0].Name != "a.yar" {
		t.Fatalf("entries: %v", zr.File)
	}
}

func readZipEntry(t *testing.T, f *zip.File) []byte {
	t.Helper()
	rc, err := f.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
