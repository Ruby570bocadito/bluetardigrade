package main

import (
	"strings"
	"testing"
)

// The startup auth banner must name HOW sensors authenticate. An
// identities-only deployment (no shared token) used to print the
// shared-token hint (-token/SF_INGEST_TOKEN), sending the operator to
// arm a credential the engine never checks (SEC-8: the confusing
// "ingest auth: ENABLED" message).
func TestIngestAuthBannerNamesTheCredential(t *testing.T) {
	shared := "[ENGINE] ingest auth: ENABLED (sensors must send 'AUTH <token>' first, or -token/SF_INGEST_TOKEN)"
	if got := ingestAuthBanner(false, "secret", 0); got != shared {
		t.Fatalf("token-only banner changed: %q", got)
	}
	if got := ingestAuthBanner(true, "secret", 0); !strings.Contains(got, "rotation window OPEN") {
		t.Fatalf("rotation banner lost: %q", got)
	}
	both := ingestAuthBanner(false, "secret", 3)
	if !strings.Contains(both, "identity token") || !strings.Contains(both, "-token/SF_INGEST_TOKEN") {
		t.Fatalf("token+identities banner must name both credentials: %q", both)
	}
	identitiesOnly := ingestAuthBanner(false, "", 3)
	if strings.Contains(identitiesOnly, "-token") || strings.Contains(identitiesOnly, "SF_INGEST_TOKEN") {
		t.Fatalf("identities-only banner must not advertise the shared token: %q", identitiesOnly)
	}
	if !strings.Contains(identitiesOnly, "per-sensor identity token") {
		t.Fatalf("identities-only banner must name the per-sensor credential: %q", identitiesOnly)
	}
}
