package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The default of a plain `go build` must be the newest released version
// of the changelog (the rule written on engineVersion): a source build
// used to call itself v1.0.0 while the last release was v1.0.0-rc1.
func TestDefaultVersionIsTheLatestReleasedOne(t *testing.T) {
	raw, err := os.ReadFile("../../CHANGELOG.md")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^## \[(v[0-9][^\]]*)\]`).FindSubmatch(raw)
	if m == nil {
		t.Fatal("CHANGELOG.md has no released version heading")
	}
	if latest := string(m[1]); engineVersion != latest {
		t.Fatalf("engineVersion = %q, the newest release in CHANGELOG.md is %q", engineVersion, latest)
	}
}

func TestVersionBlockShowsTheCommitWhenKnown(t *testing.T) {
	out := renderVersion(buildInfo{Version: "v9.9.9", Commit: "0123456789ab", Dirty: true, Go: "go1.26", OS: "windows", Arch: "amd64"})
	if !strings.Contains(out, "0123456789ab (con cambios locales)") {
		t.Fatalf("commit and local changes missing from the version block:\n%s", out)
	}
	if out := renderVersion(buildInfo{Version: "v9.9.9", Go: "go1.26", OS: "linux", Arch: "amd64"}); strings.Contains(out, "commit") {
		t.Fatalf("a build without VCS data must not print a commit line:\n%s", out)
	}
}
