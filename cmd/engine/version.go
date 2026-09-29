package main

import "runtime"

// engineVersion is the user-facing version reported by `engine
// version` and the interactive banner.
const engineVersion = "v0.1.0"

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
