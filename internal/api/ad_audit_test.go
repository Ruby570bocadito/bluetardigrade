package api

import (
	"context"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

// SEC-9: reading the record of a user leaves a trail of who (the
// account the console declared, remote otherwise), when and what they
// searched for; the other kinds, the unarmed connector and an
// unparseable needle leave the trail honest: no row, no 500.
func TestADUserReadsLeaveAnAuditRow(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/adaudit.db")
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	defer st.Close()

	users := []*store.ADObject{
		{DN: "CN=ana,OU=SOC,DC=corp,DC=example,DC=invalid", Kind: store.ADKindUser, Name: "ana"},
		{DN: "CN=luis,OU=SOC,DC=corp,DC=example,DC=invalid", Kind: store.ADKindUser, Name: "luis"},
	}
	if err := st.ReplaceADSnapshot(users, nil); err != nil {
		t.Fatalf("ReplaceADSnapshot: %v", err)
	}

	// A config that passes validation but is never dialed: the read
	// path serves the local snapshot (the same seam
	// TestADPostureServesStoredScore uses).
	cfg := &ad.Config{
		Server:       "dc01.corp.example.invalid",
		BaseDN:       "DC=corp,DC=example,DC=invalid",
		CAFile:       "/nonexistent/ca.pem",
		BindDN:       "CN=svc-ro,DC=corp,DC=example,DC=invalid",
		PasswordFile: "/nonexistent/secret.bin",
	}
	conn, err := ad.New(cfg, st, log.New(io.Discard, "", 0), nil)
	if err != nil {
		t.Fatalf("ad.New: %v", err)
	}

	h, addr := newTestHub(t)
	h.SetStore(st)
	h.SetAD(conn)

	get := func(path, account string) *http.Response {
		req, err := http.NewRequestWithContext(context.Background(), "GET", "http://"+addr+path, nil)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		if account != "" {
			req.Header.Set("X-SF-Account", account)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}
	auditRows := func() []store.ADReadAuditRow {
		_, rows, _, err := st.QueryRO(context.Background(), "SELECT remote, account, q, status, rows FROM ad_read_audit ORDER BY id", 100)
		if err != nil {
			t.Fatalf("QueryRO audit: %v", err)
		}
		out := make([]store.ADReadAuditRow, 0, len(rows))
		for _, r := range rows {
			out = append(out, store.ADReadAuditRow{
				Remote:  r[0].(string),
				Account: r[1].(string),
				Q:       r[2].(string),
				Status:  r[3].(string),
				Rows:    int(r[4].(int64)),
			})
		}
		return out
	}

	// A user read with an oversized account header: audited, capped.
	if res := get("/api/ad/objects/user?q=ana", "ana@"+strings.Repeat("m", 100)); res.StatusCode != http.StatusOK {
		t.Fatalf("GET user: status %d, want 200", res.StatusCode)
	}
	rows1 := auditRows()
	if len(rows1) != 1 {
		t.Fatalf("audit rows = %d, want 1 after one user read", len(rows1))
	}
	if rows1[0].Q != "ana" || rows1[0].Status != "ok" || rows1[0].Rows != 1 {
		t.Errorf("row = %+v, want q=ana status=ok rows=1", rows1[0])
	}
	if got := rows1[0].Account; len(got) != adAuditAccountCap || !strings.HasPrefix(got, "ana@") {
		t.Errorf("account = %q (%d runes), want the header capped to %d", got, len([]rune(got)), adAuditAccountCap)
	}
	if rows1[0].Remote == "" {
		t.Error("remote empty, want the caller address")
	}

	// A second user read without the header (direct bearer caller):
	// the row keeps its remote and an empty account.
	if res := get("/api/ad/objects/user", ""); res.StatusCode != http.StatusOK {
		t.Fatalf("GET user without account: status %d, want 200", res.StatusCode)
	}
	rows2 := auditRows()
	if len(rows2) != 2 || rows2[1].Account != "" {
		t.Errorf("rows = %+v, want a second row with an empty account", rows2)
	}

	// Groups, computers and OUs are not personal records: no row.
	for _, kind := range []string{"group", "computer", "ou"} {
		if res := get("/api/ad/objects/"+kind, "ana"); res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: status %d, want 200", kind, res.StatusCode)
		}
	}
	if rows3 := auditRows(); len(rows3) != 2 {
		t.Errorf("audit rows = %d, want still 2 after group/computer/ou reads", len(rows3))
	}

	// An unknown kind is refused before the connector: no row either.
	if res := get("/api/ad/objects/secret", "ana"); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("GET unknown kind: status %d, want 400", res.StatusCode)
	}
	if rows4 := auditRows(); len(rows4) != 2 {
		t.Errorf("audit rows = %d, want still 2 after an unknown kind", len(rows4))
	}
}
