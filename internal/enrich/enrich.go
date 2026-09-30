// Package enrich adds context to events after ingestion and before
// rule evaluation. Steps are idempotent and never mutate the raw
// evidence fields coming from the sensor.
package enrich

import (
	"path/filepath"
	"strings"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// Enricher applies the v0.1 enrichment pipeline.
type Enricher struct {
	startedAt time.Time
}

// New returns an Enricher ready to use.
func New() *Enricher {
	return &Enricher{startedAt: time.Now().UTC()}
}

// Apply annotates the event in place. In phase 1 this pipeline gains
// hash lookups with an LRU cache, geoIP and TI feed checks (MISP,
// STIX/TAXII) as described in the architecture document, section 4.1.
func (en *Enricher) Apply(ev *model.Event) {
	if ev.Enrichment == nil {
		ev.Enrichment = make(map[string]string, 4)
	}
	ev.Enrichment["seen_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	ev.Enrichment["engine_uptime"] = time.Since(en.startedAt).Round(time.Second).String()

	if ev.User != "" {
		domain, user, ok := strings.Cut(ev.User, `\`)
		if ok {
			ev.Enrichment["user_domain"] = domain
			ev.Enrichment["user_name"] = user
		}
	}

	if ev.Process != nil && ev.Process.Image != "" {
		dir := imageDir(ev.Process.Image)
		ev.Enrichment["image_dir"] = dir
		if isSystemPath(dir) {
			ev.Enrichment["image_origin"] = "system"
		} else {
			ev.Enrichment["image_origin"] = "userland"
		}
	}
}

// imageDir splits the executable's directory from an image path on any
// host OS: sensors report Windows paths and the engine also runs on
// Linux, where filepath.Dir alone answers "." for every C:\... image
// and reclassifies system binaries as userland. The backslash branch
// reproduces filepath.Dir's Windows semantics byte-identically (no
// behavior change on a Windows host); the forward-slash branch stays
// with the standard library (including the /system32/ form
// isSystemPath knows).
func imageDir(image string) string {
	if strings.ContainsRune(image, '\\') {
		if i := strings.LastIndexByte(image, '\\'); i >= 0 {
			return image[:i]
		}
		return image // a lone backslash leaves no directory part
	}
	return filepath.Dir(image)
}

// isSystemPath reports whether an image directory is OS-owned: the
// Windows system root (c:\windows, case-insensitive) or the Unix-form
// /system32/ prefix.
func isSystemPath(dir string) bool {
	d := strings.ToLower(dir)
	return strings.HasPrefix(d, `c:\windows`) || strings.HasPrefix(d, `/system32/`)
}
