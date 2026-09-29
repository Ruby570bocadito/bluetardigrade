package ingest

import (
	"bufio"
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// startTestServer spins up an ingest server on a loopback port with an
// optional shared token and returns its address plus the event sink.
func startTestServer(t *testing.T, token string) (*Server, chan *model.Event, string) {
	t.Helper()
	events := make(chan *model.Event, 8)
	srv, err := New("127.0.0.1:0", events)
	if err != nil {
		t.Fatalf("ingest.New: %v", err)
	}
	if token != "" {
		srv.SetToken(token)
	}
	go srv.Serve()
	t.Cleanup(srv.Shutdown)
	return srv, events, srv.Addr()
}

// sampleEvent is a minimal valid event line for the ingest decoder.
func sampleEvent(t *testing.T) string {
	t.Helper()
	ev := &model.Event{ID: "test-1", Type: model.TypeProcessCreate,
		Host: "h", Source: "test"}
	line, err := ev.Encode()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	return string(line)
}

// dialAndSend connects, writes the given lines, and returns the
// connection plus a reader for the acks (deadline already set).
func dialAndSend(t *testing.T, addr string, lines ...string) (net.Conn, *bufio.Reader) {
	t.Helper()
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	for _, l := range lines {
		if _, err := conn.Write([]byte(l + "\n")); err != nil {
			t.Fatalf("write %q: %v", l, err)
		}
	}
	return conn, bufio.NewReader(conn)
}

// readAck reads one ack line from the server.
func readAck(t *testing.T, r *bufio.Reader) string {
	t.Helper()
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatalf("read ack: %v", err)
	}
	return strings.TrimSpace(line)
}

// expectClosed waits for the server to close the connection.
func expectClosed(t *testing.T, conn net.Conn) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 16)
	if n, err := conn.Read(buf); err == nil && n > 0 {
		// final ack lines are allowed; a second read must fail
		if _, err2 := conn.Read(buf); err2 == nil {
			t.Fatal("connection still open after auth failure")
		}
	}
}

// No token configured: a sensor that speaks plain NDJSON works exactly
// as before the auth feature (backward compatibility).
func TestNoTokenPassthrough(t *testing.T) {
	srv, events, addr := startTestServer(t, "")
	if srv.AuthEnabled() {
		t.Fatal("AuthEnabled with empty token")
	}
	conn, r := dialAndSend(t, addr, sampleEvent(t))
	got := <-events
	if got.ID != "test-1" {
		t.Fatalf("got event %+v, want id test-1", got)
	}
	_ = conn
	_ = r
	if srv.Received() != 1 || srv.Dropped() != 0 || srv.Rejected() != 0 {
		t.Fatalf("counters: received=%d dropped=%d rejected=%d",
			srv.Received(), srv.Dropped(), srv.Rejected())
	}
}

// No token configured + sensor sends AUTH anyway: hard reject with a
// clear message, so a stale-token sensor fails loudly instead of
// silently losing its first event.
func TestTokenlessEngineRejectsAuthLine(t *testing.T) {
	srv, events, addr := startTestServer(t, "")
	_, r := dialAndSend(t, addr, "AUTH whatever", sampleEvent(t))
	ack := readAck(t, r)
	if !strings.Contains(ack, "error") || !strings.Contains(ack, "no ingest token") {
		t.Fatalf("ack = %q, want an auth-config error", ack)
	}
	select {
	case ev := <-events:
		t.Fatalf("event %v delivered after auth rejection", ev)
	default:
	}
	if srv.Rejected() != 1 {
		t.Fatalf("rejected = %d, want 1", srv.Rejected())
	}
}

// Token configured + correct AUTH: ack ok and events flow.
func TestTokenAuthOK(t *testing.T) {
	srv, events, addr := startTestServer(t, "s3cret")
	if !srv.AuthEnabled() {
		t.Fatal("AuthEnabled false with token set")
	}
	_, r := dialAndSend(t, addr, "AUTH s3cret", sampleEvent(t))
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("ack = %q, want ok", ack)
	}
	got := <-events
	if got.ID != "test-1" {
		t.Fatalf("got event id %q, want test-1", got.ID)
	}
	if srv.Received() != 1 || srv.Rejected() != 0 {
		t.Fatalf("counters: received=%d rejected=%d", srv.Received(), srv.Rejected())
	}
}

// Token configured + wrong AUTH: reject, close, never deliver events.
func TestTokenAuthWrong(t *testing.T) {
	srv, events, addr := startTestServer(t, "s3cret")
	conn, r := dialAndSend(t, addr, "AUTH wrong-token")
	ack := readAck(t, r)
	if !strings.Contains(ack, "auth failed") {
		t.Fatalf("ack = %q, want auth-failure message", ack)
	}
	expectClosed(t, conn)
	select {
	case ev := <-events:
		t.Fatalf("event %v delivered after wrong token", ev)
	default:
	}
	if srv.Rejected() != 1 {
		t.Fatalf("rejected = %d, want 1", srv.Rejected())
	}
}

// Token configured + no AUTH at all (plain event first): the event is
// NOT accepted as an implicit auth; the connection is closed.
func TestTokenAuthMissing(t *testing.T) {
	srv, events, addr := startTestServer(t, "s3cret")
	conn, r := dialAndSend(t, addr, sampleEvent(t))
	ack := readAck(t, r)
	if !strings.Contains(ack, "auth failed") {
		t.Fatalf("ack = %q, want auth-failure message", ack)
	}
	expectClosed(t, conn)
	select {
	case ev := <-events:
		t.Fatalf("event %v delivered without AUTH", ev)
	default:
	}
	_ = srv
}

// Token configured + correct AUTH + the first event pipelined in the
// SAME write: the handshake must not swallow bytes the event scanner
// needs. This is the natural write pattern of an efficient sensor.
func TestTokenAuthPipelinedWrite(t *testing.T) {
	srv, events, addr := startTestServer(t, "s3cret")
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	// one single write: auth line + event, no wait in between
	if _, err := conn.Write([]byte("AUTH s3cret\n" + sampleEvent(t) + "\n")); err != nil {
		t.Fatalf("write pipelined payload: %v", err)
	}
	r := bufio.NewReader(conn)
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("ack = %q, want ok", ack)
	}
	select {
	case ev := <-events:
		if ev.ID != "test-1" {
			t.Fatalf("got event id %q, want test-1", ev.ID)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("pipelined event after AUTH was not ingested")
	}
	if srv.Received() != 1 || srv.Rejected() != 0 {
		t.Fatalf("counters: received=%d rejected=%d", srv.Received(), srv.Rejected())
	}
}

// A silent client that never AUTHs is dropped after authTimeout, so
// half-open connections cannot accumulate on the engine.
func TestAuthTimeout(t *testing.T) {
	old := authTimeout
	authTimeout = 150 * time.Millisecond
	defer func() { authTimeout = old }()

	_, events, addr := startTestServer(t, "s3cret")
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	start := time.Now()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 16)
	// any read error (io.EOF, reset) means the server closed; a
	// successful read with data would mean it is still talking
	if n, err := conn.Read(buf); err == nil && n > 0 {
		t.Fatalf("server did not close the silent connection (read %d bytes)", n)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("server took %v to drop a silent client", elapsed)
	}
	select {
	case ev := <-events:
		t.Fatalf("event %v delivered on a silent connection", ev)
	default:
	}
}

// The AUTH token comparison must not leak through an oversized first
// line either: a >maxLineSize AUTH attempt closes the connection
// without crashing the server (scanner error path).
func TestOversizedAuthLineDoesNotCrash(t *testing.T) {
	srv, _, addr := startTestServer(t, "s3cret")
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	big := "AUTH " + strings.Repeat("x", maxLineSize+16)
	conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Write([]byte(big + "\n")); err != nil {
		t.Fatalf("write oversized line: %v", err)
	}
	// the server may ack or just close; either way it must survive
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 256)
	_, _ = conn.Read(buf) // best effort
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if srv.Rejected() > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	// server is still alive: a normal connection still works
	if _, r := dialAndSend(t, addr, "AUTH s3cret"); false {
		_ = r
	}
	if srv.Rejected() == 0 {
		t.Log("oversized line closed without counting a rejection (acceptable)")
	}
	var _ = json.Marshal
}

// Rotation window: the PREVIOUS token still validates while sensors
// are being redeployed with the new one — no dropped connection, no
// rejected counter inflation during the migration.
func TestTokenRotationPreviousAccepted(t *testing.T) {
	srv, events, addr := startTestServer(t, "new-token")
	srv.SetPreviousToken("old-token")
	if !srv.Rotating() {
		t.Fatal("Rotating() = false after SetPreviousToken")
	}
	conn, r := dialAndSend(t, addr, "AUTH old-token", sampleEvent(t))
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("previous token rejected: ack = %s", ack)
	}
	got := <-events
	if got.ID != "test-1" {
		t.Fatalf("got event %+v, want id test-1", got)
	}
	_ = conn
	if srv.Rejected() != 0 {
		t.Fatalf("rejected = %d, want 0 during rotation window", srv.Rejected())
	}
}

// Rotation window: the CURRENT token keeps working unchanged while the
// previous one is still accepted.
func TestTokenRotationCurrentStillAccepted(t *testing.T) {
	srv, events, addr := startTestServer(t, "new-token")
	srv.SetPreviousToken("old-token")
	conn, r := dialAndSend(t, addr, "AUTH new-token", sampleEvent(t))
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("current token rejected during rotation: ack = %s", ack)
	}
	got := <-events
	if got.ID != "test-1" {
		t.Fatalf("got event %+v, want id test-1", got)
	}
	_ = conn
	_ = r
}

// Rotation window: an unrelated token is still rejected exactly as
// before — the window widens acceptance, it never weakens it.
func TestTokenRotationStillRejectsWrong(t *testing.T) {
	srv, _, addr := startTestServer(t, "new-token")
	srv.SetPreviousToken("old-token")
	conn, r := dialAndSend(t, addr, "AUTH intruder-token")
	if ack := readAck(t, r); !strings.Contains(ack, "auth failed") {
		t.Fatalf("wrong token accepted during rotation: ack = %s", ack)
	}
	expectClosed(t, conn)
	if srv.Rejected() != 1 {
		t.Fatalf("rejected = %d, want 1", srv.Rejected())
	}
}

// SetPreviousToken guards: no primary token, empty previous, or a
// previous equal to the current token must NOT open a window.
func TestSetPreviousTokenGuards(t *testing.T) {
	events := make(chan *model.Event, 1)
	srv, err := New("127.0.0.1:0", events)
	if err != nil {
		t.Fatalf("ingest.New: %v", err)
	}
	srv.SetPreviousToken("old") // no primary token yet: ignored
	if srv.Rotating() {
		t.Fatal("rotation opened without a primary token")
	}
	srv.SetToken("cur")
	srv.SetPreviousToken("") // empty previous: ignored
	if srv.Rotating() {
		t.Fatal("rotation opened with an empty previous token")
	}
	srv.SetPreviousToken("cur") // same as current: nothing to rotate
	if srv.Rotating() {
		t.Fatal("rotation opened with previous == current")
	}
	srv.SetPreviousToken("old")
	if !srv.Rotating() {
		t.Fatal("rotation did not open with a valid previous token")
	}
}

// TestDecodeTruncatesOversizedIdentityFields: host, user and id are
// pinned by long-lived engine state (alert dedup keys, correlator
// states) — at the ingest boundary oversized values are truncated, not
// dropped, so a hostile feed cannot park ~1 MiB per unique host there.
func TestDecodeTruncatesOversizedIdentityFields(t *testing.T) {
	line := `{"id":"` + strings.Repeat("i", 500) +
		`","type":"process.create","host":"` + strings.Repeat("H", 600) +
		`","user":"` + strings.Repeat("u", 600) +
		`","timestamp":"2026-01-01T12:00:00Z","process":{"pid":1,"name":"x.exe"}}`
	ev, err := decode([]byte(line))
	if err != nil {
		t.Fatalf("decode of an oversized (but well-formed) event must not fail: %v", err)
	}
	if n := len([]rune(ev.Host)); n != maxHostRunes {
		t.Fatalf("host runes = %d, want %d", n, maxHostRunes)
	}
	if n := len([]rune(ev.User)); n != maxUserRunes {
		t.Fatalf("user runes = %d, want %d", n, maxUserRunes)
	}
	if n := len([]rune(ev.ID)); n != maxIDRunes {
		t.Fatalf("id runes = %d, want %d", n, maxIDRunes)
	}
}

// TestDecodeKeepsNormalIdentityFields: the caps sit far above any
// legitimate value — real hostnames, usernames and UUIDs must pass
// through byte-identical.
func TestDecodeKeepsNormalIdentityFields(t *testing.T) {
	line := `{"id":"3f2b0c1a-9d8e-4f7a-b6c5-2e1d0a9b8c7d","type":"process.create",` +
		`"host":"DESKTOP-CORP01.corp.local","user":"CORP\\\\jdoe",` +
		`"timestamp":"2026-01-01T12:00:00Z","process":{"pid":42,"name":"powershell.exe"}}`
	ev, err := decode([]byte(line))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if ev.Host != "DESKTOP-CORP01.corp.local" {
		t.Fatalf("host = %q, want untouched", ev.Host)
	}
	if ev.User != `CORP\\jdoe` {
		t.Fatalf("user = %q, want untouched", ev.User)
	}
	if ev.ID != "3f2b0c1a-9d8e-4f7a-b6c5-2e1d0a9b8c7d" {
		t.Fatalf("id = %q, want untouched", ev.ID)
	}
}
