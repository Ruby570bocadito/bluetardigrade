package tlsutil

import (
	"bytes"
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
)

// writePair writes a fresh self-signed cert/key pair for cn and returns
// the DER of the certificate (to tell rotations apart).
func writePair(t *testing.T, certPath, keyPath, cn string) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	kder, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kder}), 0o600); err != nil {
		t.Fatal(err)
	}
	return der
}

// bump moves both mtimes forward so the reloader sees a change even on
// filesystems with coarse timestamp resolution.
func bump(t *testing.T, at time.Time, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if err := os.Chtimes(p, at, at); err != nil {
			t.Fatal(err)
		}
	}
}

func served(t *testing.T, r *Reloader) []byte {
	t.Helper()
	c, err := r.GetCertificate(&tls.ClientHelloInfo{})
	if err != nil || c == nil {
		t.Fatalf("GetCertificate: %v", err)
	}
	return c.Certificate[0]
}

func TestNewReloaderFailsLoud(t *testing.T) {
	dir := t.TempDir()
	if _, err := NewReloader(filepath.Join(dir, "nope.pem"), filepath.Join(dir, "nope.key")); err == nil {
		t.Fatal("missing files accepted")
	}
	c1, k1 := filepath.Join(dir, "a.pem"), filepath.Join(dir, "a.key")
	c2, k2 := filepath.Join(dir, "b.pem"), filepath.Join(dir, "b.key")
	writePair(t, c1, k1, "a")
	writePair(t, c2, k2, "b")
	if _, err := NewReloader(c1, k2); err == nil {
		t.Fatal("mismatched cert/key pair accepted")
	}
}

func TestRotationServesNewPairAndKeepsCurrentOnBrokenReload(t *testing.T) {
	dir := t.TempDir()
	cert, key := filepath.Join(dir, "c.pem"), filepath.Join(dir, "c.key")
	first := writePair(t, cert, key, "first")
	r, err := NewReloader(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	var events []string
	r.SetReloadNotify(func(event string, _, _ uint64) { events = append(events, event) })

	if !bytes.Equal(served(t, r), first) || r.Reloads() != 0 || r.Errors() != 0 {
		t.Fatal("unchanged files must serve the startup pair without reloading")
	}

	// rotation: new pair, new mtime -> next handshake gets it
	second := writePair(t, cert, key, "second")
	bump(t, time.Now().Add(time.Minute), cert, key)
	if !bytes.Equal(served(t, r), second) || r.Reloads() != 1 {
		t.Fatalf("rotation not picked up (reloads=%d)", r.Reloads())
	}

	// broken reload (truncated cert caught mid-copy): keep serving the
	// current pair, count one error, do not retry until mtime moves
	if err := os.WriteFile(cert, []byte("-----BEGIN CERTIFICATE-----\ntrunc"), 0o600); err != nil {
		t.Fatal(err)
	}
	bump(t, time.Now().Add(2*time.Minute), cert, key)
	if !bytes.Equal(served(t, r), second) || r.Errors() != 1 {
		t.Fatalf("broken reload must keep the current cert (errors=%d)", r.Errors())
	}
	served(t, r)
	if r.Errors() != 1 {
		t.Fatalf("broken pair retried on every handshake (errors=%d)", r.Errors())
	}

	// operator fixes the files: recovery on the next mtime change
	third := writePair(t, cert, key, "third")
	bump(t, time.Now().Add(3*time.Minute), cert, key)
	if !bytes.Equal(served(t, r), third) || r.Reloads() != 2 {
		t.Fatalf("fixed pair not loaded (reloads=%d)", r.Reloads())
	}
	if len(events) != 3 {
		t.Fatalf("notify events = %v, want reloaded, failed, reloaded", events)
	}

	// a vanished file is a counted error, never an outage
	if err := os.Remove(key); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(served(t, r), third) || r.Errors() != 2 {
		t.Fatalf("missing key must keep serving (errors=%d)", r.Errors())
	}
}

// Listen pins TLS 1.2 as the floor.
func TestListenRefusesLegacyTLS(t *testing.T) {
	dir := t.TempDir()
	cert, key := filepath.Join(dir, "c.pem"), filepath.Join(dir, "c.key")
	writePair(t, cert, key, "srv")
	r, err := NewReloader(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	ln, err := r.Listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				_ = c.(*tls.Conn).Handshake()
				c.Close()
			}()
		}
	}()
	dial := func(maxVersion uint16) error {
		c, err := tls.Dial("tcp", ln.Addr().String(), &tls.Config{
			InsecureSkipVerify: true, // the handshake version is under test, not the chain
			MaxVersion:         maxVersion,
		})
		if err == nil {
			c.Close()
		}
		return err
	}
	if err := dial(tls.VersionTLS11); err == nil {
		t.Fatal("TLS 1.1 handshake accepted")
	}
	if err := dial(tls.VersionTLS13); err != nil {
		t.Fatalf("TLS 1.3 handshake refused: %v", err)
	}
}
