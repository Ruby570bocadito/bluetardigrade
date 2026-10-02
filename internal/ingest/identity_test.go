package ingest

import (
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func writeIdentities(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "identities.yaml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func identitiesYAML() string {
	return `version: 1
identities:
  - name: wks-01-sensor
    token_sha256: ` + TokenDigest("tok-wks-01") + `
    hosts: [WKS-01]
  - name: ids-collector
    token_sha256: ` + TokenDigest("tok-ids") + `
    hosts: ["*"]
`
}

func eventLine(t *testing.T, id, host string, attrs map[string]string) string {
	t.Helper()
	ev := &model.Event{ID: id, Type: model.TypeProcessCreate, Host: host, Source: "test", Attributes: attrs}
	line, err := ev.Encode()
	if err != nil {
		t.Fatal(err)
	}
	return string(line)
}

func startIdentityServer(t *testing.T, token string) (*Server, chan *model.Event, string) {
	t.Helper()
	ids, err := LoadIdentities(writeIdentities(t, identitiesYAML()))
	if err != nil {
		t.Fatalf("LoadIdentities: %v", err)
	}
	events := make(chan *model.Event, 8)
	srv, err := New("127.0.0.1:0", events)
	if err != nil {
		t.Fatal(err)
	}
	srv.SetToken(token)
	srv.SetIdentities(ids)
	go srv.Serve()
	t.Cleanup(srv.Shutdown)
	return srv, events, srv.Addr()
}

func recvEvent(t *testing.T, events chan *model.Event) *model.Event {
	t.Helper()
	select {
	case ev := <-events:
		return ev
	case <-time.After(3 * time.Second):
		t.Fatal("event not delivered")
		return nil
	}
}

// A bound identity delivers events for its own host, stamped with its
// name; events claiming another host are refused and counted.
func TestIdentityBindsHostAndStampsProvenance(t *testing.T) {
	srv, events, addr := startIdentityServer(t, "")
	if !srv.AuthEnabled() || srv.Identities() != 2 {
		t.Fatalf("identities not in force: auth=%v n=%d", srv.AuthEnabled(), srv.Identities())
	}
	_, r := dialAndSend(t, addr,
		"AUTH tok-wks-01",
		eventLine(t, "own", "wks-01", map[string]string{IdentityAttribute: "forged"}),
		eventLine(t, "spoof", "DC-01", nil),
	)
	if ack := readAck(t, r); !strings.Contains(ack, `"ok"`) {
		t.Fatalf("auth ack = %s", ack)
	}
	ev := recvEvent(t, events)
	if ev.ID != "own" || ev.Attributes[IdentityAttribute] != "wks-01-sensor" {
		t.Fatalf("own-host event: id=%s identity=%q (feed value must be overwritten)", ev.ID, ev.Attributes[IdentityAttribute])
	}
	if ack := readAck(t, r); !strings.Contains(ack, "outside the binding") {
		t.Fatalf("spoofed host ack = %s", ack)
	}
	if srv.IdentityViolations() != 1 || srv.Received() != 1 {
		t.Fatalf("violations=%d received=%d, want 1/1", srv.IdentityViolations(), srv.Received())
	}
}

// A wildcard identity (collector) may report any host.
func TestWildcardIdentityReportsAnyHost(t *testing.T) {
	_, events, addr := startIdentityServer(t, "")
	_, r := dialAndSend(t, addr, "AUTH tok-ids", eventLine(t, "a", "DC-01", nil), eventLine(t, "b", "WKS-77", nil))
	readAck(t, r)
	for _, want := range []string{"a", "b"} {
		ev := recvEvent(t, events)
		if ev.ID != want || ev.Attributes[IdentityAttribute] != "ids-collector" {
			t.Fatalf("got %s/%q, want %s stamped ids-collector", ev.ID, ev.Attributes[IdentityAttribute], want)
		}
	}
}

// The shared token keeps working next to identities (migration), is
// unbound and stamped as such; unknown tokens are rejected.
func TestSharedTokenAlongsideIdentities(t *testing.T) {
	srv, events, addr := startIdentityServer(t, "shared-secret")
	_, r := dialAndSend(t, addr, "AUTH shared-secret", eventLine(t, "s", "ANY-HOST", nil))
	readAck(t, r)
	if ev := recvEvent(t, events); ev.Attributes[IdentityAttribute] != "shared-token" {
		t.Fatalf("shared-token event stamped %q", ev.Attributes[IdentityAttribute])
	}
	conn, r2 := dialAndSend(t, addr, "AUTH nope")
	if ack := readAck(t, r2); !strings.Contains(ack, "auth failed") {
		t.Fatalf("unknown token ack = %s", ack)
	}
	expectClosed(t, conn)
	if srv.Rejected() != 1 {
		t.Fatalf("rejected = %d, want 1", srv.Rejected())
	}
}

// Identities alone (no shared token) still demand AUTH.
func TestIdentitiesRequireAuth(t *testing.T) {
	srv, _, addr := startIdentityServer(t, "")
	conn, r := dialAndSend(t, addr, eventLine(t, "x", "WKS-01", nil))
	if ack := readAck(t, r); !strings.Contains(ack, "auth failed") {
		t.Fatalf("unauthenticated event ack = %s", ack)
	}
	expectClosed(t, conn)
	if srv.Received() != 0 {
		t.Fatal("event accepted without AUTH")
	}
}

// Hot-reload swaps the set for new handshakes.
func TestSetIdentitiesHotSwap(t *testing.T) {
	srv, events, addr := startIdentityServer(t, "")
	ids, err := LoadIdentities(writeIdentities(t, `version: 1
identities:
  - name: new-sensor
    token_sha256: `+TokenDigest("tok-new")+`
    hosts: [NEW-01]
`))
	if err != nil {
		t.Fatal(err)
	}
	srv.SetIdentities(ids)
	_, r := dialAndSend(t, addr, "AUTH tok-new", eventLine(t, "n", "new-01", nil))
	readAck(t, r)
	if ev := recvEvent(t, events); ev.Attributes[IdentityAttribute] != "new-sensor" {
		t.Fatalf("reloaded identity not used: %q", ev.Attributes[IdentityAttribute])
	}
	conn, r2 := dialAndSend(t, addr, "AUTH tok-wks-01")
	if ack := readAck(t, r2); !strings.Contains(ack, "auth failed") {
		t.Fatalf("removed identity still accepted: %s", ack)
	}
	expectClosed(t, conn)
}

func TestLoadIdentitiesValidation(t *testing.T) {
	digest := TokenDigest("x")
	cases := map[string]string{
		"missing version":   "identities:\n  - {name: a, token_sha256: " + digest + ", hosts: [A]}\n",
		"no identities":     "version: 1\nidentities: []\n",
		"clear token":       "version: 1\nidentities:\n  - {name: a, token: secret, hosts: [A]}\n",
		"bad digest":        "version: 1\nidentities:\n  - {name: a, token_sha256: abc, hosts: [A]}\n",
		"no hosts":          "version: 1\nidentities:\n  - {name: a, token_sha256: " + digest + "}\n",
		"wildcard mixed":    "version: 1\nidentities:\n  - {name: a, token_sha256: " + digest + ", hosts: ['*', B]}\n",
		"duplicate name":    "version: 1\nidentities:\n  - {name: a, token_sha256: " + digest + ", hosts: [A]}\n  - {name: a, token_sha256: " + TokenDigest("y") + ", hosts: [B]}\n",
		"shared digest":     "version: 1\nidentities:\n  - {name: a, token_sha256: " + digest + ", hosts: [A]}\n  - {name: b, token_sha256: " + digest + ", hosts: [B]}\n",
		"reserved name":     "version: 1\nidentities:\n  - {name: shared-token, token_sha256: " + digest + ", hosts: [A]}\n",
		"control in name":   "version: 1\nidentities:\n  - {name: \"a\\nb\", token_sha256: " + digest + ", hosts: [A]}\n",
		"control in host":   "version: 1\nidentities:\n  - {name: a, token_sha256: " + digest + ", hosts: [\"A\\u001b\"]}\n",
		"unknown top field": "version: 1\nextra: true\nidentities:\n  - {name: a, token_sha256: " + digest + ", hosts: [A]}\n",
	}
	for name, body := range cases {
		if _, err := LoadIdentities(writeIdentities(t, body)); err == nil {
			t.Errorf("%s: accepted, want error", name)
		}
	}
	if _, err := LoadIdentities(filepath.Join(t.TempDir(), "missing.yaml")); err == nil {
		t.Error("missing file accepted")
	}
}

// Before AUTH completes, a connection cannot make the engine buffer
// more than maxAuthLine: an endless first line is cut and rejected.
func TestPreAuthLineIsCapped(t *testing.T) {
	srv, _, addr := startTestServer(t, "s3cr3t")
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	chunk := strings.Repeat("A", 1024)
	// write up to 64 KiB without a newline; the server must give up
	// long before (writes may start failing once it closes)
	for i := 0; i < 64; i++ {
		if _, err := conn.Write([]byte(chunk)); err != nil {
			break
		}
	}
	// the server answers and closes; unread bytes may turn the close
	// into a reset, so only "the connection ended before the deadline"
	// is asserted here, not the ack text
	if _, err := io.ReadAll(conn); err != nil {
		if ne, ok := err.(net.Error); ok && ne.Timeout() {
			t.Fatal("connection still open after an oversized pre-auth line")
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for srv.Rejected() != 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if srv.Rejected() != 1 {
		t.Fatalf("oversized pre-auth line not rejected (rejected=%d)", srv.Rejected())
	}
}

// After AUTH, events keep the full maxLineSize budget.
func TestLargeEventAfterAuthStillAccepted(t *testing.T) {
	_, events, addr := startTestServer(t, "s3cr3t")
	ev := &model.Event{ID: "big", Type: model.TypeProcessCreate, Host: "h",
		Process: &model.Process{CommandLine: strings.Repeat("x", 200<<10)}}
	line, _ := ev.Encode()
	_, r := dialAndSend(t, addr, "AUTH s3cr3t", string(line))
	readAck(t, r)
	if got := recvEvent(t, events); got.ID != "big" {
		t.Fatalf("large post-auth event lost: %s", got.ID)
	}
}
