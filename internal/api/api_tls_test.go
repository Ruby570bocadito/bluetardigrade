package api

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeSelfSignedCert mints a throwaway self-signed pair for the TLS
// listener tests (the ingest suite uses the same recipe; it stays
// local to keep the api package free of test-only dependencies).
func writeSelfSignedCert(t *testing.T) (certFile, keyFile string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, err := rand.Int(rand.Reader, big.NewInt(1<<62))
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "api-test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certFile = filepath.Join(dir, "cert.pem")
	keyFile = filepath.Join(dir, "key.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(certFile, certPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	return certFile, keyFile
}

func TestNewTLSServesHealthOverTLS(t *testing.T) {
	certFile, keyFile := writeSelfSignedCert(t)
	h, err := NewTLS("127.0.0.1:0", certFile, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	if !h.TLS() {
		t.Fatal("NewTLS hub must report TLS()")
	}
	go func() { _ = h.Run() }()
	defer h.Shutdown()

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // test-only: trust anything
		},
	}
	resp, err := client.Get("https://" + h.Addr() + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health over TLS: status %d", resp.StatusCode)
	}
}

func TestNewTLSRejectsMissingPair(t *testing.T) {
	dir := t.TempDir()
	if _, err := NewTLS("127.0.0.1:0", filepath.Join(dir, "nope.pem"), filepath.Join(dir, "nope-key.pem")); err == nil {
		t.Fatal("missing cert/key must fail NewTLS at construction")
	}
}

func TestNewPlainReportsNoTLS(t *testing.T) {
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer h.Shutdown()
	if h.TLS() || h.CertReloads() != 0 || h.CertReloadErrors() != 0 {
		t.Fatal("plain listener must report no TLS and no reloads")
	}
}

func TestAuthThrottleAfterBudget(t *testing.T) {
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer h.Shutdown()
	h.SetToken("secret-token")
	go func() { _ = h.Run() }()

	client := &http.Client{Timeout: 5 * time.Second}
	url := "http://" + h.Addr() + "/api/stats"
	// burn the budget from one address (loopback is always the same
	// remote addr here, which is exactly the brute-force shape)
	got429 := false
	for i := 0; i < authFailBudget+5; i++ {
		resp, err := client.Get(url)
		if err != nil {
			t.Fatal(err)
		}
		code := resp.StatusCode
		resp.Body.Close()
		if code == http.StatusTooManyRequests {
			got429 = true
			break
		}
		if code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status %d, want 401", i, code)
		}
	}
	if !got429 {
		t.Fatal("brute force past the budget must hit a 429")
	}
}
