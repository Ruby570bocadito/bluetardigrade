package ingest

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// fakeEnroller is a registry in memory: one token, credentials by value.
type fakeEnroller struct {
	mu     sync.Mutex
	token  string
	auto   bool
	creds  map[string]EnrollCheck
	issued int
}

func (f *fakeEnroller) Enroll(token, host, peer string) (EnrollGrant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if token != f.token {
		return EnrollGrant{}, errors.New("unknown enrollment token")
	}
	f.issued++
	cred := "btsensor_" + strings.Repeat("c", f.issued)
	state := EnrollPending
	if f.auto {
		state = EnrollActive
	}
	f.creds[cred] = EnrollCheck{Name: "enr-" + strings.ToLower(host), Host: host, State: state}
	return EnrollGrant{Name: "enr-" + strings.ToLower(host), Credential: cred, Active: f.auto}, nil
}

func (f *fakeEnroller) Authenticate(cred string) (EnrollCheck, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.creds[cred]
	return c, ok
}

func (f *fakeEnroller) set(cred, state string) {
	f.mu.Lock()
	c := f.creds[cred]
	c.State = state
	f.creds[cred] = c
	f.mu.Unlock()
}

func startEnrollServer(t *testing.T, token string) (*Server, *fakeEnroller, chan *model.Event, string) {
	t.Helper()
	events := make(chan *model.Event, 8)
	srv, err := New("127.0.0.1:0", events)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		srv.SetToken(token)
	}
	fe := &fakeEnroller{token: "btenroll_good", creds: map[string]EnrollCheck{}}
	srv.SetEnroller(fe)
	go srv.Serve()
	t.Cleanup(srv.Shutdown)
	return srv, fe, events, srv.Addr()
}

type enrollAck struct {
	Ack        string `json:"ack"`
	Identity   string `json:"identity"`
	Credential string `json:"credential"`
	State      string `json:"state"`
	Error      string `json:"error"`
}

func enroll(t *testing.T, addr, line string) enrollAck {
	t.Helper()
	conn, r := dialAndSend(t, addr, line)
	var a enrollAck
	if err := json.Unmarshal([]byte(readAck(t, r)), &a); err != nil {
		t.Fatal(err)
	}
	expectClosed(t, conn)
	return a
}

func TestEnrollHandsOutACredentialAndCloses(t *testing.T) {
	srv, _, _, addr := startEnrollServer(t, "")
	a := enroll(t, addr, "ENROLL btenroll_good PC-AULA-01")
	if a.Ack != "enrolled" || a.State != EnrollPending || a.Identity != "enr-pc-aula-01" || !strings.HasPrefix(a.Credential, "btsensor_") {
		t.Fatalf("ack = %+v", a)
	}
	if srv.Enrolled() != 1 {
		t.Fatalf("enrolled counter = %d", srv.Enrolled())
	}
	for _, line := range []string{"ENROLL btenroll_bad PC-1", "ENROLL btenroll_good", "ENROLL a b c"} {
		if a := enroll(t, addr, line); a.Ack != "error" || !strings.Contains(a.Error, "enrollment refused") {
			t.Fatalf("%q: ack = %+v", line, a)
		}
	}
}

func TestEnrollOffSaysHowToTurnItOn(t *testing.T) {
	_, _, addr := startTestServer(t, "tok")
	conn, r := dialAndSend(t, addr, "ENROLL btenroll_good PC-1")
	if ack := readAck(t, r); !strings.Contains(ack, "-enroll") {
		t.Fatalf("ack = %s", ack)
	}
	expectClosed(t, conn)
}

func TestEnrollNeedsTLSBeyondLoopback(t *testing.T) {
	srv := &Server{enroller: &fakeEnroller{token: "btenroll_good", creds: map[string]EnrollCheck{}}}
	server, client := net.Pipe()
	defer client.Close()
	go func() {
		srv.handleEnroll(server, []byte("ENROLL btenroll_good PC-1"), "10.0.0.5")
		server.Close()
	}()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	line, err := bufio.NewReader(client).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(line, "needs TLS") || strings.Contains(line, "btsensor_") {
		t.Fatalf("a plain remote ENROLL must be refused before any credential: %s", line)
	}
}

func TestPendingCredentialIsHeldOff(t *testing.T) {
	srv, _, events, addr := startEnrollServer(t, "")
	a := enroll(t, addr, "ENROLL btenroll_good PC-1")
	conn, r := dialAndSend(t, addr, "AUTH "+a.Credential, eventLine(t, "e1", "PC-1", nil))
	ack := readAck(t, r)
	if !strings.Contains(ack, `"ack":"pending"`) {
		t.Fatalf("ack = %s", ack)
	}
	expectClosed(t, conn)
	select {
	case ev := <-events:
		t.Fatalf("a pending host delivered %s", ev.ID)
	case <-time.After(100 * time.Millisecond):
	}
	if srv.PendingRefused() != 1 {
		t.Fatalf("pending counter = %d", srv.PendingRefused())
	}
}

func TestApprovedCredentialIsBoundToItsHost(t *testing.T) {
	_, fe, events, addr := startEnrollServer(t, "")
	a := enroll(t, addr, "ENROLL btenroll_good PC-1")
	fe.set(a.Credential, EnrollActive)
	conn, r := dialAndSend(t, addr, "AUTH "+a.Credential, eventLine(t, "e1", "pc-1", nil), eventLine(t, "e2", "PC-OTHER", nil))
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("auth ack = %s", ack)
	}
	ev := recvEvent(t, events)
	if ev.ID != "e1" || ev.Attributes[IdentityAttribute] != "enr-pc-1" {
		t.Fatalf("event %s stamped %q", ev.ID, ev.Attributes[IdentityAttribute])
	}
	if ack := readAck(t, r); !strings.Contains(ack, "outside the binding") {
		t.Fatalf("an enrolled sensor reporting another host must be refused: %s", ack)
	}
	conn.Close()
}

func TestRejectedCredentialFails(t *testing.T) {
	_, fe, _, addr := startEnrollServer(t, "")
	a := enroll(t, addr, "ENROLL btenroll_good PC-1")
	fe.set(a.Credential, EnrollRevoked)
	conn, r := dialAndSend(t, addr, "AUTH "+a.Credential)
	if ack := readAck(t, r); !strings.Contains(ack, "was revoked") {
		t.Fatalf("ack = %s", ack)
	}
	expectClosed(t, conn)
}

func TestDropIdentityClosesOpenConnections(t *testing.T) {
	srv, fe, events, addr := startEnrollServer(t, "")
	fe.auto = true
	a := enroll(t, addr, "ENROLL btenroll_good PC-1")
	if a.State != EnrollActive {
		t.Fatalf("auto-approved enrollment = %+v", a)
	}
	conn, r := dialAndSend(t, addr, "AUTH "+a.Credential, eventLine(t, "e1", "PC-1", nil))
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("auth ack = %s", ack)
	}
	recvEvent(t, events)
	deadline := time.Now().Add(2 * time.Second)
	for srv.DropIdentity(a.Identity) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the open connection of the identity was never tracked")
		}
		time.Sleep(10 * time.Millisecond)
	}
	expectClosed(t, conn)
	if n := srv.DropIdentity(a.Identity); n != 0 {
		t.Fatalf("a closed connection is still tracked (%d)", n)
	}
}

func TestEnrollmentRequiresAuthForEveryStream(t *testing.T) {
	_, _, _, addr := startEnrollServer(t, "")
	conn, r := dialAndSend(t, addr, eventLine(t, "e1", "PC-1", nil))
	if ack := readAck(t, r); !strings.Contains(ack, "auth failed") {
		t.Fatalf("an anonymous stream must be refused once enrollment is on: %s", ack)
	}
	expectClosed(t, conn)
}

func TestSharedTokenStillWorksWithEnrollment(t *testing.T) {
	_, _, events, addr := startEnrollServer(t, "shared")
	_, r := dialAndSend(t, addr, "AUTH shared", eventLine(t, "e1", "ANY-HOST", nil))
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("auth ack = %s", ack)
	}
	if ev := recvEvent(t, events); ev.Attributes[IdentityAttribute] != sharedIdentityName {
		t.Fatalf("shared-token event stamped %q", ev.Attributes[IdentityAttribute])
	}
}

func TestBoundIdentityIgnoresWildcards(t *testing.T) {
	srv, _, _ := startIdentityServer(t, "")
	if got := srv.BoundIdentity("wks-01"); got != "wks-01-sensor" {
		t.Fatalf("BoundIdentity(wks-01) = %q", got)
	}
	if got := srv.BoundIdentity("somewhere-else"); got != "" {
		t.Fatalf("a wildcard identity must not count as bound: %q", got)
	}
}
