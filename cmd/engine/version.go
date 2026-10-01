package main

import "runtime"

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
var engineVersion = "v0.2.0"

// buildInfo is the payload of the version block.
type buildInfo struct {
	Version string
	Go      string
	OS      string
	Arch    string
}

// buildInfoNow captures the version and the runtime of the binary.
func buildInfoNow() buildInfo {
	return buildInfo{
		Version: engineVersion,
		Go:      runtime.Version(),
		OS:      runtime.GOOS,
		Arch:    runtime.GOARCH,
	}
}
