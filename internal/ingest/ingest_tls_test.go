package ingest

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// writeSelfSignedCert generates a self-signed TLS certificate with the
// given IP SANs into dir and returns the cert/key file paths. Using
// crypto/x509 keeps the suite hermetic: no openssl dependency, same
// behavior on every platform CI runs.
func writeSelfSignedCert(t *testing.T, dir string, ips ...net.IP) (certPath, keyPath string) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		t.Fatalf("generate serial: %v", err)
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "ingest-test"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true, // self-signed: the cert is its own trust anchor
		IPAddresses:           ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}

	certPath = filepath.Join(dir, "cert.pem")
	keyPath = filepath.Join(dir, "key.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		t.Fatalf("write cert: %v", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	return certPath, keyPath
}

// startTLSTestServer spins up a TLS ingest server on a loopback port
// with a freshly generated self-signed certificate and returns the
// server, the event sink and the cert path (usable as its own CA).
func startTLSTestServer(t *testing.T, token string) (*Server, chan *model.Event, string) {
	t.Helper()
	dir := t.TempDir()
	certPath, keyPath := writeSelfSignedCert(t, dir, net.ParseIP("127.0.0.1"))

	events := make(chan *model.Event, 8)
	srv, err := NewTLS("127.0.0.1:0", certPath, keyPath, events)
	if err != nil {
		t.Fatalf("ingest.NewTLS: %v", err)
	}
	if token != "" {
		srv.SetToken(token)
	}
	go srv.Serve()
	t.Cleanup(srv.Shutdown)
	return srv, events, certPath
}

// dialTLS connects to addr with certFile pinned as the only trust
// anchor, mirroring devsensor -tls -ca <file>.
func dialTLS(t *testing.T, addr, certFile string) (net.Conn, *bufio.Reader) {
	t.Helper()
	pem, err := os.ReadFile(certFile)
	if err != nil {
		t.Fatalf("read cert: %v", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		t.Fatalf("cert %s contains no usable certificate", certFile)
	}
	conn, err := tls.Dial("tcp", addr, &tls.Config{
		RootCAs:    pool,
		MinVersion: tls.VersionTLS12,
	})
	if err != nil {
		t.Fatalf("tls.Dial %s: %v", addr, err)
	}
	t.Cleanup(func() { conn.Close() })
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	return conn, bufio.NewReader(conn)
}

// TLS round trip: a TLS client with the right CA sends one event and
// the server parses it. Same contract as the plain listener.
func TestTLSRoundTrip(t *testing.T) {
	srv, events, certPath := startTLSTestServer(t, "")
	if !srv.TLS() {
		t.Fatal("server does not report TLS enabled")
	}
	conn, _ := dialTLS(t, srv.Addr(), certPath)
	line := sampleEvent(t)
	if _, err := conn.Write([]byte(line + "\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	select {
	case got := <-events:
		if got.ID != "test-1" {
			t.Fatalf("got event id %q, want test-1", got.ID)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("event never arrived over TLS")
	}
	if srv.Received() != 1 || srv.Dropped() != 0 || srv.Rejected() != 0 {
		t.Fatalf("counters: received=%d dropped=%d rejected=%d",
			srv.Received(), srv.Dropped(), srv.Rejected())
	}
}

// AUTH composes with TLS: the handshake travels encrypted and both a
// correct and an incorrect token behave exactly like the plain path.
func TestTLSWithAuth(t *testing.T) {
	srv, events, certPath := startTLSTestServer(t, "secret-123")

	// correct token: accepted, event flows
	conn, r := dialTLS(t, srv.Addr(), certPath)
	if _, err := conn.Write([]byte("AUTH secret-123\n")); err != nil {
		t.Fatalf("write auth: %v", err)
	}
	if ack := readAck(t, r); ack != `{"ack":"ok"}` {
		t.Fatalf("auth ack = %s", ack)
	}
	if _, err := conn.Write([]byte(sampleEvent(t) + "\n")); err != nil {
		t.Fatalf("write event: %v", err)
	}
	select {
	case <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("event never arrived after AUTH over TLS")
	}

	// wrong token: closed with the loud ack
	conn2, r2 := dialTLS(t, srv.Addr(), certPath)
	if _, err := conn2.Write([]byte("AUTH wrong\n")); err != nil {
		t.Fatalf("write bad auth: %v", err)
	}
	if ack := readAck(t, r2); ack != `{"ack":"error","error":"auth failed: send 'AUTH <token>' as the first line"}` {
		t.Fatalf("bad-token ack = %s", ack)
	}
	expectClosed(t, conn2)
	if srv.Rejected() != 1 {
		t.Fatalf("rejected = %d, want 1", srv.Rejected())
	}
}

// A client that does not trust the server's CA must fail the
// handshake: silently accepting a different CA would make the
// encryption theater.
func TestTLSRejectsWrongCA(t *testing.T) {
	srv, _, _ := startTLSTestServer(t, "")
	otherDir := t.TempDir()
	otherCert, _ := writeSelfSignedCert(t, otherDir, net.ParseIP("127.0.0.1"))

	if _, err := tls.Dial("tcp", srv.Addr(), &tls.Config{
		RootCAs:    mustCertPool(t, otherCert),
		MinVersion: tls.VersionTLS12,
	}); err == nil {
		t.Fatal("tls.Dial with the wrong CA succeeded; expected certificate verification failure")
	}
	// the server must not have counted anything from the failed handshake
	if srv.Received() != 0 || srv.Rejected() != 0 {
		t.Fatalf("counters moved on handshake failure: received=%d rejected=%d",
			srv.Received(), srv.Rejected())
	}
}

// A plain-TCP client against the TLS port cannot inject anything: the
// server sees an invalid handshake and closes the connection without
// counting an event.
func TestTLSPlainClientGetsNothing(t *testing.T) {
	srv, events, _ := startTLSTestServer(t, "")

	conn, err := net.Dial("tcp", srv.Addr())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	// looks like a perfectly valid event on the wire — but the server
	// is waiting for a TLS ClientHello, not for NDJSON
	if _, err := conn.Write([]byte(sampleEvent(t) + "\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	buf := make([]byte, 64)
	if _, err := conn.Read(buf); err == nil {
		// a reply would mean the server accepted the clear-text stream
		t.Log("plain client got bytes (handshake alert); ok as long as no event is ingested")
	}
	select {
	case ev := <-events:
		t.Fatalf("clear-text bytes were decoded into an event: %+v", ev)
	case <-time.After(1500 * time.Millisecond):
	}
	if srv.Received() != 0 || srv.Dropped() != 0 {
		t.Fatalf("counters: received=%d dropped=%d, want 0/0", srv.Received(), srv.Dropped())
	}
}

// Fail-loud surfaces: a missing cert file, a missing key file and a
// cert/key pair mismatch must all abort NewTLS with an error naming
// the problem — never start a listener that then fails per-connection.
func TestTLSFailLoudOnBadMaterial(t *testing.T) {
	dir := t.TempDir()
	certPath, keyPath := writeSelfSignedCert(t, dir, net.ParseIP("127.0.0.1"))
	events := make(chan *model.Event, 1)

	cases := []struct {
		name      string
		cert, key string
	}{
		{"missing cert file", filepath.Join(dir, "nope.pem"), keyPath},
		{"missing key file", certPath, filepath.Join(dir, "nope-key.pem")},
		{"cert/key mismatch", certPath, mustOtherKey(t, dir)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, err := NewTLS("127.0.0.1:0", tc.cert, tc.key, events)
			if err == nil {
				srv.Shutdown()
				t.Fatal("NewTLS succeeded with bad material; expected fail-loud error")
			}
			if srv != nil {
				t.Fatal("NewTLS returned a server alongside an error")
			}
		})
	}
}

// mustOtherKey generates a second, unrelated key so the mismatch case
// pairs a real certificate with a real (but wrong) private key.
func mustOtherKey(t *testing.T, dir string) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate other key: %v", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal other key: %v", err)
	}
	p := filepath.Join(dir, "other-key.pem")
	if err := os.WriteFile(p, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatalf("write other key: %v", err)
	}
	return p
}

func mustCertPool(t *testing.T, certFile string) *x509.CertPool {
	t.Helper()
	pem, err := os.ReadFile(certFile)
	if err != nil {
		t.Fatalf("read cert: %v", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		t.Fatalf("cert %s contains no usable certificate", certFile)
	}
	return pool
}

// replaceServerCert overwrites the server's cert/key files with the
// contents of the given paths and pins EXPLICIT mtimes (os.Chtimes):
// without this the swap could race the filesystem's timestamp
// granularity and the reloader would legitimately see "nothing
// changed".
func replaceServerCert(t *testing.T, srvCert, srvKey, newCert, newKey string, mtime time.Time) {
	t.Helper()
	certPEM, err := os.ReadFile(newCert)
	if err != nil {
		t.Fatalf("read new cert: %v", err)
	}
	keyPEM, err := os.ReadFile(newKey)
	if err != nil {
		t.Fatalf("read new key: %v", err)
	}
	if err := os.WriteFile(srvCert, certPEM, 0o600); err != nil {
		t.Fatalf("write server cert: %v", err)
	}
	if err := os.WriteFile(srvKey, keyPEM, 0o600); err != nil {
		t.Fatalf("write server key: %v", err)
	}
	if err := os.Chtimes(srvCert, mtime, mtime); err != nil {
		t.Fatalf("chtimes cert: %v", err)
	}
	if err := os.Chtimes(srvKey, mtime, mtime); err != nil {
		t.Fatalf("chtimes key: %v", err)
	}
}

// Certificate rotation without downtime: replacing the PEM files in
// place makes NEW connections present the new certificate (validated
// against the new CA), connections opened before the swap keep
// working, a client still trusting the OLD CA is rejected from now on,
// and the reload counter records the event. No restart, no signal.
func TestTLSCertHotSwap(t *testing.T) {
	dir := t.TempDir()
	certA, keyA := writeSelfSignedCert(t, dir, net.ParseIP("127.0.0.1"))

	events := make(chan *model.Event, 8)
	srv, err := NewTLS("127.0.0.1:0", certA, keyA, events)
	if err != nil {
		t.Fatalf("ingest.NewTLS: %v", err)
	}
	go srv.Serve()
	t.Cleanup(srv.Shutdown)

	if srv.CertReloads() != 0 || srv.CertReloadErrors() != 0 {
		t.Fatalf("precondition: reloads=%d errors=%d, want 0/0",
			srv.CertReloads(), srv.CertReloadErrors())
	}

	// the OLD trust anchor is captured BEFORE the swap: after the
	// rotation the certA PATH holds cert B, so a pool built later
	// would be the new CA, not the old one
	oldPEM, err := os.ReadFile(certA)
	if err != nil {
		t.Fatalf("read pre-rotation cert: %v", err)
	}
	poolA := x509.NewCertPool()
	if !poolA.AppendCertsFromPEM(oldPEM) {
		t.Fatal("pre-rotation cert contains no usable certificate")
	}

	// a connection born BEFORE the rotation
	oldConn, _ := dialTLS(t, srv.Addr(), certA)
	line := sampleEvent(t)
	if _, err := oldConn.Write([]byte(line + "\n")); err != nil {
		t.Fatalf("pre-swap write: %v", err)
	}
	select {
	case <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("pre-swap event never arrived")
	}

	// the rotation: cert B replaces A in place, mtime moves forward
	otherDir := t.TempDir()
	certB, keyB := writeSelfSignedCert(t, otherDir, net.ParseIP("127.0.0.1"))
	replaceServerCert(t, certA, keyA, certB, keyB, time.Now().Add(2*time.Hour))

	// NEW connections are served cert B: verify with the B pool
	connB, _ := dialTLS(t, srv.Addr(), certB)
	if _, err := connB.Write([]byte(line + "\n")); err != nil {
		t.Fatalf("post-swap write: %v", err)
	}
	select {
	case <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("post-swap event never arrived with the NEW CA")
	}

	// a client still trusting the OLD CA is now rejected: the server
	// presents B, which the captured poolA does not know
	if c, err := tls.Dial("tcp", srv.Addr(), &tls.Config{
		RootCAs:    poolA,
		MinVersion: tls.VersionTLS12,
	}); err == nil {
		c.Close()
		t.Fatal("tls.Dial with the pre-rotation CA succeeded after the swap; expected verification failure")
	}

	// the pre-rotation connection is untouched by the swap
	if _, err := oldConn.Write([]byte(line + "\n")); err != nil {
		t.Fatalf("established connection broken by rotation: %v", err)
	}

	if srv.CertReloads() < 1 {
		t.Fatalf("CertReloads = %d, want >= 1", srv.CertReloads())
	}
	if srv.CertReloadErrors() != 0 {
		t.Fatalf("CertReloadErrors = %d, want 0", srv.CertReloadErrors())
	}
}

// A broken rotation attempt must not degrade the channel: corrupted
// material on disk means the CURRENT certificate keeps serving new
// connections and the error counter tells the operator.
func TestTLSCertReloadKeepsCurrentOnCorrupt(t *testing.T) {
	dir := t.TempDir()
	certA, keyA := writeSelfSignedCert(t, dir, net.ParseIP("127.0.0.1"))

	events := make(chan *model.Event, 8)
	srv, err := NewTLS("127.0.0.1:0", certA, keyA, events)
	if err != nil {
		t.Fatalf("ingest.NewTLS: %v", err)
	}
	go srv.Serve()
	t.Cleanup(srv.Shutdown)

	// the OLD trust anchor is captured BEFORE the file is corrupted
	oldPEM, err := os.ReadFile(certA)
	if err != nil {
		t.Fatalf("read pre-rotation cert: %v", err)
	}
	poolA := x509.NewCertPool()
	if !poolA.AppendCertsFromPEM(oldPEM) {
		t.Fatal("pre-rotation cert contains no usable certificate")
	}

	// a truncated "certificate" with a fresh mtime: the classic
	// mid-copy window a reload must survive
	if err := os.WriteFile(certA, []byte("-----BEGIN CERTIFICATE-----\ntrunc"), 0o600); err != nil {
		t.Fatalf("write corrupt cert: %v", err)
	}
	broken := time.Now().Add(3 * time.Hour)
	if err := os.Chtimes(certA, broken, broken); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	// new connections still work with the OLD certificate (poolA was
	// captured before the corruption: the file itself is garbage now)
	conn, err2 := tls.Dial("tcp", srv.Addr(), &tls.Config{
		RootCAs:    poolA,
		MinVersion: tls.VersionTLS12,
	})
	if err2 != nil {
		t.Fatalf("post-corruption handshake failed: %v (the channel must keep the previous cert)", err2)
	}
	t.Cleanup(func() { conn.Close() })
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Write([]byte(sampleEvent(t) + "\n")); err != nil {
		t.Fatalf("write after broken rotation: %v", err)
	}
	select {
	case <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("event never arrived: the broken rotation degraded the channel")
	}

	if srv.CertReloadErrors() < 1 {
		t.Fatalf("CertReloadErrors = %d, want >= 1", srv.CertReloadErrors())
	}
	if srv.CertReloads() != 0 {
		t.Fatalf("CertReloads = %d, want 0 (nothing valid was loaded)", srv.CertReloads())
	}
}

// mtime is the only change signal: rewriting a file while restoring
// its original mtime is (by design) NOT detected — the cache must not
// re-read on every handshake.
func TestTLSCertNoReloadWithoutMtimeChange(t *testing.T) {
	dir := t.TempDir()
	certA, keyA := writeSelfSignedCert(t, dir, net.ParseIP("127.0.0.1"))

	events := make(chan *model.Event, 8)
	srv, err := NewTLS("127.0.0.1:0", certA, keyA, events)
	if err != nil {
		t.Fatalf("ingest.NewTLS: %v", err)
	}
	go srv.Serve()
	t.Cleanup(srv.Shutdown)

	// dial once to settle the initial mtimes in the reloader
	conn, _ := dialTLS(t, srv.Addr(), certA)
	conn.Write([]byte(sampleEvent(t) + "\n"))
	select {
	case <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("baseline event never arrived")
	}

	fi, err := os.Stat(certA)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	// rewrite the same content, then restore the original mtime
	certPEM, err := os.ReadFile(certA)
	if err != nil {
		t.Fatalf("read cert: %v", err)
	}
	if err := os.WriteFile(certA, certPEM, 0o600); err != nil {
		t.Fatalf("rewrite cert: %v", err)
	}
	if err := os.Chtimes(certA, fi.ModTime(), fi.ModTime()); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	// another connection: served from cache, no reload recorded
	conn2, _ := dialTLS(t, srv.Addr(), certA)
	conn2.Write([]byte(sampleEvent(t) + "\n"))
	select {
	case <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("second event never arrived")
	}

	if srv.CertReloads() != 0 {
		t.Fatalf("CertReloads = %d, want 0: the cache re-read without an mtime change", srv.CertReloads())
	}
}

// The notify hook receives the reload outcome in the host's own voice:
// one call per event, ordered, with the counters already updated.
func TestTLSCertReloadNotify(t *testing.T) {
	dir := t.TempDir()
	certA, keyA := writeSelfSignedCert(t, dir, net.ParseIP("127.0.0.1"))

	events := make(chan *model.Event, 8)
	srv, err := NewTLS("127.0.0.1:0", certA, keyA, events)
	if err != nil {
		t.Fatalf("ingest.NewTLS: %v", err)
	}
	type reloadEvent struct {
		event   string
		reloads uint64
		errs    uint64
	}
	var mu sync.Mutex
	var got []reloadEvent
	srv.SetReloadNotify(func(event string, reloads, reloadErrs uint64) {
		mu.Lock()
		defer mu.Unlock()
		got = append(got, reloadEvent{event, reloads, reloadErrs})
	})
	go srv.Serve()
	t.Cleanup(srv.Shutdown)

	// baseline handshake: no notify (nothing reloaded yet)
	conn, _ := dialTLS(t, srv.Addr(), certA)
	conn.Write([]byte(sampleEvent(t) + "\n"))
	<-events

	// rotate: one "reloaded" notification
	otherDir := t.TempDir()
	certB, keyB := writeSelfSignedCert(t, otherDir, net.ParseIP("127.0.0.1"))
	replaceServerCert(t, certA, keyA, certB, keyB, time.Now().Add(4*time.Hour))
	connB, _ := dialTLS(t, srv.Addr(), certB)
	connB.Write([]byte(sampleEvent(t) + "\n"))
	<-events

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("notify calls = %d (%v), want exactly 1", len(got), got)
	}
	if got[0].event != "certificate reloaded" || got[0].reloads < 1 || got[0].errs != 0 {
		t.Fatalf("notify payload wrong: %+v", got[0])
	}
}
