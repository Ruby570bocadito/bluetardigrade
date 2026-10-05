package enroll

import (
	"bufio"
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// The whole path with the real registry and a real ingest listener:
// enroll, wait pending, get approved, deliver, get revoked mid-stream.
func TestEnrollmentEndToEnd(t *testing.T) {
	reg, _ := newRegistry(t)
	events := make(chan *model.Event, 8)
	srv, err := ingest.New("127.0.0.1:0", events)
	if err != nil {
		t.Fatal(err)
	}
	srv.SetEnroller(Gate{Registry: reg})
	reg.SetOnWithdraw(func(name string) { srv.DropIdentity(name) })
	reg.SetBoundElsewhere(srv.BoundIdentity)
	go srv.Serve()
	t.Cleanup(srv.Shutdown)

	token, _, err := reg.CreateToken(TokenRequest{Label: "lab", By: "ana"})
	if err != nil {
		t.Fatal(err)
	}
	conn, r := dial(t, srv.Addr(), "ENROLL "+token+" PC-LAB-01")
	var got struct{ Ack, Identity, Credential, State string }
	if err := json.Unmarshal([]byte(line(t, r)), &got); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	if got.Ack != "enrolled" || got.State != "pending" {
		t.Fatalf("enroll ack = %+v", got)
	}

	conn, r = dial(t, srv.Addr(), "AUTH "+got.Credential)
	if ack := line(t, r); !strings.Contains(ack, `"ack":"pending"`) {
		t.Fatalf("pending ack = %s", ack)
	}
	conn.Close()

	if _, err := reg.Decide(got.Identity, Approve, "ana"); err != nil {
		t.Fatal(err)
	}
	ev := &model.Event{ID: "e1", Type: model.TypeProcessCreate, Host: "PC-LAB-01", Source: "test"}
	enc, _ := ev.Encode()
	conn, r = dial(t, srv.Addr(), "AUTH "+got.Credential, string(enc))
	if ack := line(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("auth ack after approval = %s", ack)
	}
	select {
	case e := <-events:
		if e.Attributes[ingest.IdentityAttribute] != got.Identity {
			t.Fatalf("event stamped %q", e.Attributes[ingest.IdentityAttribute])
		}
	case <-time.After(3 * time.Second):
		t.Fatal("approved host delivered nothing")
	}

	if _, err := reg.Decide(got.Identity, Revoke, "ana"); err != nil {
		t.Fatal(err)
	}
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := r.ReadByte(); err == nil {
		t.Fatal("the connection of a revoked identity stayed open")
	}
	conn, r = dial(t, srv.Addr(), "AUTH "+got.Credential)
	if ack := line(t, r); !strings.Contains(ack, "was revoked") {
		t.Fatalf("auth ack after revoke = %s", ack)
	}
	conn.Close()
}

func dial(t *testing.T, addr string, lines ...string) (net.Conn, *bufio.Reader) {
	t.Helper()
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	for _, l := range lines {
		if _, err := conn.Write([]byte(l + "\n")); err != nil {
			t.Fatal(err)
		}
	}
	return conn, bufio.NewReader(conn)
}

func line(t *testing.T, r *bufio.Reader) string {
	t.Helper()
	s, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(s)
}
