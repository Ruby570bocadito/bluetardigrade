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
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
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
