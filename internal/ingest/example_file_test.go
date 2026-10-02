package ingest

import "testing"

// The shipped example must stay loadable (it documents the format).
func TestShippedExampleIdentitiesLoad(t *testing.T) {
	ids, err := LoadIdentities("../../ingest-identities.example.yaml")
	if err != nil {
		t.Fatalf("example file: %v", err)
	}
	if len(ids) != 2 || !ids[0].AllowsHost("wks-01") || ids[0].AllowsHost("dc-01") || !ids[1].AllowsHost("anything") {
		t.Fatalf("unexpected identities: %+v", ids)
	}
	if m := matchIdentity(ids, []byte("example-wks-01")); m == nil || m.Name != "wks-01" {
		t.Fatalf("example digest does not match its documented token")
	}
}
