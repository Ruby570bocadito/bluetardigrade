package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

// TestADPostureServesStoredScore is the probe SEG-A ronda 11 asked for
// (finding 1, MEDIA): the /api/ad/posture envelope declared the Score
// field but the handler never filled it, so the response carried
// "score": null even with a stored analysis — the 0-100 the console
// renders never travelled the wire. The probe stores a posture with
// score 87, arms the connector WITHOUT any network (ad.New never
// dials; Run is never called) and requires the envelope to carry 87.
func TestADPostureServesStoredScore(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/posture.db")
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	defer st.Close()

	const want = 87
	doc := `{"score":87,"generated_at_unix":1760000000,"summary":{"high":1},"findings":[{"id":"stale-krbtgt","title":"t","severity":"high","description":"d","remediation":"r","count":1,"objects":[]}],"objects_checked":10}`
	if err := st.SaveADPostureJSON(time.Now().Unix(), want, doc); err != nil {
		t.Fatalf("SaveADPostureJSON: %v", err)
	}

	// A config that passes validation but is never used: no sync runs,
	// so nothing dials the (nonexistent) server.
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
	h.SetAD(conn)

	res, err := http.Get("http://" + addr + "/api/ad/posture")
	if err != nil {
		t.Fatalf("GET /api/ad/posture: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/ad/posture: status %d", res.StatusCode)
	}
	var got postureWire
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.Ready {
		t.Fatalf("ready=false, want true (a stored analysis exists)")
	}
	if got.Score == nil {
		t.Fatalf("score=null on the wire with a stored analysis (the SEG-A finding)")
	}
	if *got.Score != want {
		t.Fatalf("score=%d, want %d", *got.Score, want)
	}
	if got.GeneratedAt == "" {
		t.Fatalf("generated_at empty with a stored analysis")
	}
}
