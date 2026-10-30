package main

import (
	"runtime"
	"runtime/debug"
)

// engineVersion is the user-facing version reported by `engine
// version` and the interactive banner. It mirrors the latest tag in
// CHANGELOG.md and can be overridden at link time so release binaries
// report exactly the tag they were built from:
//
//	go build -ldflags "-X main.engineVersion=v0.1.0" ./cmd/engine
//
// (see the make dist target and .github/workflows/release.yml). A
// plain `go build` keeps this default, which must always match the
// most recent released version in the changelog.
var engineVersion = "v1.0.0-rc1"

// buildInfo is the payload of the version block.
type buildInfo struct {
	Version string
	// Commit is the short revision of the git checkout the binary was
	// built from ("" for a source tree without git, e.g. a ZIP install):
	// two source builds of the same version differ here.
	Commit string
	// Dirty reports uncommitted changes in that checkout.
	Dirty bool
	Go    string
	OS    string
	Arch  string
}

// buildInfoNow captures the version, the VCS stamp the Go toolchain
// embeds in a build from a git checkout, and the runtime of the binary.
func buildInfoNow() buildInfo {
	b := buildInfo{
		Version: engineVersion,
		Go:      runtime.Version(),
		OS:      runtime.GOOS,
		Arch:    runtime.GOARCH,
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				b.Commit = s.Value
				if len(b.Commit) > 12 {
					b.Commit = b.Commit[:12]
				}
			case "vcs.modified":
				b.Dirty = s.Value == "true"
			}
		}
	}
	return b
}
