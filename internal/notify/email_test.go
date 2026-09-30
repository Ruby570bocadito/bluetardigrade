package notify

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
)

// fakeSMTP is a minimal in-process SMTP server for exercising the
// email channel end to end: greeting, EHLO, optional STARTTLS with a
// self-signed certificate, optional AUTH PLAIN with credential
// checking, envelope capture, DATA capture and configurable rejection
// of one recipient. It implements only what net/smtp's client speaks.
type fakeSMTP struct {
	ln       net.Listener
	tlsCfg   *tls.Config // nil until mint() runs; used by STARTTLS
	wg       sync.WaitGroup
	mu       sync.Mutex
	starttls bool   // advertise + support STARTTLS
	require  bool   // require AUTH before MAIL FROM
	user     string // credentials the server accepts
	pass     string
	reject   string // RCPT address to reject with 550

	authSeen  bool
	froms     []string
	rcpts     []string
	bodies    []string
	ehloPeers []string
}

func newFakeSMTP(t *testing.T, starttls bool) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &fakeSMTP{ln: ln, starttls: starttls}
	if starttls {
		s.tlsCfg = mintCert(t)
	}
	s.wg.Add(1)
	go s.serve()
	t.Cleanup(func() {
		ln.Close()
		s.wg.Wait()
	})
	return s
}

func (s *fakeSMTP) addr() string { return s.ln.Addr().String() }

// mintCert builds a self-signed certificate valid for 127.0.0.1 so
// the STARTTLS handshake can complete with full verification against
// the injected root pool.
func mintCert(t *testing.T) *tls.Config {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa key: %v", err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:     []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("self-signed cert: %v", err)
	}
	cert := tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
	root := x509.NewCertPool()
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	root.AddCert(leaf)
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.NoClientCert,
		MinVersion:   tls.VersionTLS12,
	}
}

func (s *fakeSMTP) serve() {
	defer s.wg.Done()
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return
		}
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.session(conn)
		}()
	}
}

// envelopeAddr extracts the address from a "VERB:<addr> PARAMS" line
// using the angle brackets, ignoring any ESMTP parameters the client
// appends (net/smtp sends BODY=8BITMIME alongside MAIL FROM).
func envelopeAddr(line string) string {
	i := strings.Index(line, "<")
	j := strings.LastIndex(line, ">")
	if i >= 0 && j > i {
		return line[i+1 : j]
	}
	return strings.TrimSpace(line[len("XXXX "):])
}

func (s *fakeSMTP) session(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	w := bufio.NewWriter(conn)
	write := func(line string) {
		w.WriteString(line + "\r\n")
		w.Flush()
	}
	write("220 fake-smtp ESMTP")

	var authed bool
	var secured bool
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		cmd := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(cmd, "EHLO") || strings.HasPrefix(cmd, "HELO"):
			s.mu.Lock()
			s.ehloPeers = append(s.ehloPeers, strings.TrimSpace(line[4:]))
			s.mu.Unlock()
			features := "250-fake-smtp\r\n250-8BITMIME\r\n250-SIZE 10485760"
			if s.starttls && !secured {
				features += "\r\n250-STARTTLS"
			}
			features += "\r\n250-AUTH PLAIN"
			features += "\r\n250 OK"
			write(features)
		case cmd == "STARTTLS":
			if !s.starttls {
				write("502 5.5.1 not implemented")
				continue
			}
			write("220 2.0.0 Ready to start TLS")
			tlsConn := tls.Server(conn, s.tlsCfg)
			if err := tlsConn.Handshake(); err != nil {
				return
			}
			conn = tlsConn
			r = bufio.NewReader(conn)
			w = bufio.NewWriter(conn)
			secured = true
		case strings.HasPrefix(cmd, "AUTH PLAIN"):
			raw := strings.TrimSpace(line[len("AUTH PLAIN"):])
			decoded, derr := base64.StdEncoding.DecodeString(raw)
			if derr != nil {
				write("501 5.5.2 cannot decode")
				continue
			}
			parts := strings.SplitN(string(decoded), "\x00", 3)
			s.mu.Lock()
			ok := len(parts) == 3 && parts[1] == s.user && parts[2] == s.pass
			s.authSeen = s.authSeen || ok
			s.mu.Unlock()
			if !ok {
				write("535 5.7.8 authentication credentials rejected")
				continue
			}
			authed = true
			write("235 2.7.0 Accepted")
		case strings.HasPrefix(cmd, "MAIL FROM:"):
			if s.require && !authed {
				write("530 5.7.0 authentication required")
				continue
			}
			s.mu.Lock()
			s.froms = append(s.froms, envelopeAddr(line))
			s.mu.Unlock()
			write("250 2.1.0 OK")
		case strings.HasPrefix(cmd, "RCPT TO:"):
			addr := envelopeAddr(line)
			if s.reject != "" && addr == s.reject {
				write("550 5.1.1 mailbox unavailable")
				continue
			}
			s.mu.Lock()
			s.rcpts = append(s.rcpts, addr)
			s.mu.Unlock()
			write("250 2.1.5 OK")
		case cmd == "DATA":
			write("354 End data with <CR><LF>.<CR><LF>")
			var body strings.Builder
			for {
				l, derr := r.ReadString('\n')
				if derr != nil {
					return
				}
				l = strings.TrimRight(l, "\r\n")
				if l == "." {
					break
				}
				if strings.HasPrefix(l, "..") { // client dot-escaping
					l = l[1:]
				}
				body.WriteString(l + "\n")
			}
			s.mu.Lock()
			s.bodies = append(s.bodies, body.String())
			s.mu.Unlock()
			write("250 2.0.0 OK: queued")
		case cmd == "RSET":
			write("250 2.0.0 OK")
		case cmd == "NOOP":
			write("250 2.0.0 OK")
		case cmd == "QUIT":
			write("221 2.0.0 Bye")
			return
		default:
			write("500 5.5.2 unrecognized command")
		}
	}
}

func (s *fakeSMTP) snapshot() (froms, rcpts, bodies []string, authed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.froms...),
		append([]string(nil), s.rcpts...),
		append([]string(nil), s.bodies...),
		s.authSeen
}

func sampleAlert() alert.Alert {
	return alert.Alert{
		ID:        "LAB-0001",
		Timestamp: "2026-09-30T12:00:00Z",
		RuleID:    "lsass_dump_comsvcs",
		RuleName:  "LSASS dump via comsvcs",
		Severity:  "critical",
		Host:      "LAB-WKS-01",
		User:      "alice",
		EventID:   "ev-1",
		EventType: "process.create",
		Summary:   "rundll32.exe requested MiniDump of lsass",
		MatchedOn: []string{"process.command_line"},
	}
}

func TestEmailDeliversOverPlaintextLoopback(t *testing.T) {
	srv := newFakeSMTP(t, false)
	srv.mu.Lock()
	srv.user, srv.pass, srv.require = "alerts", "s3cret", true
	srv.mu.Unlock()

	ch := NewEmail("mail", srv.addr(), "sf@lab.test", []string{"soc@lab.test", "oncall@lab.test"}, "alerts", "s3cret", false, "engine.lab.test")
	if err := ch.Deliver(context.Background(), sampleAlert()); err != nil {
		t.Fatalf("Deliver: %v", err)
	}

	froms, rcpts, bodies, authed := srv.snapshot()
	if len(froms) != 1 || froms[0] != "sf@lab.test" {
		t.Fatalf("MAIL FROM = %v", froms)
	}
	if len(rcpts) != 2 || rcpts[0] != "soc@lab.test" || rcpts[1] != "oncall@lab.test" {
		t.Fatalf("RCPT TO = %v", rcpts)
	}
	if !authed {
		t.Fatal("AUTH PLAIN never accepted (loopback exception expected)")
	}
	if len(bodies) != 1 {
		t.Fatalf("expected 1 message body, got %d", len(bodies))
	}
	body := bodies[0]
	for _, want := range []string{
		"From: sf@lab.test\n",
		"To: soc@lab.test, oncall@lab.test\n",
		"Subject: [security-framework] [CRITICAL] LSASS dump via comsvcs @ LAB-WKS-01\n",
		"MIME-Version: 1.0\n",
		"[CRITICAL] LSASS dump via comsvcs @ LAB-WKS-01",
		"rundll32.exe requested MiniDump of lsass",
		`"rule_id":"lsass_dump_comsvcs"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %q;\n got:\n%s", want, body)
		}
	}
}

func TestEmailStartTLSNegotiates(t *testing.T) {
	srv := newFakeSMTP(t, true) // advertises STARTTLS
	ch := NewEmail("mail", srv.addr(), "sf@lab.test", []string{"soc@lab.test"}, "", "", true, "")
	// Trust the self-signed lab certificate the server mints.
	pool := x509.NewCertPool()
	leaf, err := x509.ParseCertificate(srv.tlsCfg.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	pool.AddCert(leaf)
	ch.tlsCfg = &tls.Config{ServerName: "127.0.0.1", RootCAs: pool}

	if err := ch.Deliver(context.Background(), sampleAlert()); err != nil {
		t.Fatalf("Deliver with STARTTLS: %v", err)
	}
	_, rcpts, bodies, _ := srv.snapshot()
	if len(rcpts) != 1 || len(bodies) != 1 {
		t.Fatalf("message not delivered over TLS: rcpts=%v bodies=%d", rcpts, len(bodies))
	}
}

func TestEmailRefusesToDowngradeWhenSTARTTLSMissing(t *testing.T) {
	srv := newFakeSMTP(t, false) // does NOT advertise STARTTLS
	ch := NewEmail("mail", srv.addr(), "sf@lab.test", []string{"soc@lab.test"}, "", "", true, "")

	err := ch.Deliver(context.Background(), sampleAlert())
	if err == nil {
		t.Fatal("expected a refusal when STARTTLS is configured but the server does not offer it")
	}
	if ch.Retryable(err) {
		t.Fatalf("downgrade refusal must be permanent, got retryable: %v", err)
	}
	if !strings.Contains(err.Error(), "does not offer STARTTLS") {
		t.Fatalf("error does not name the problem: %v", err)
	}
	_, _, bodies, _ := srv.snapshot()
	if len(bodies) != 0 {
		t.Fatalf("alert content leaked in cleartext despite refusal: %d bodies", len(bodies))
	}
}

func TestEmailRecipientRejectionIsPermanent(t *testing.T) {
	srv := newFakeSMTP(t, false)
	srv.mu.Lock()
	srv.reject = "gone@lab.test"
	srv.mu.Unlock()

	ch := NewEmail("mail", srv.addr(), "sf@lab.test", []string{"gone@lab.test"}, "", "", false, "")
	err := ch.Deliver(context.Background(), sampleAlert())
	if err == nil {
		t.Fatal("expected RCPT rejection to surface")
	}
	if ch.Retryable(err) {
		t.Fatalf("mailbox rejection must be permanent: %v", err)
	}
}

func TestEmailDialFailureIsRetryable(t *testing.T) {
	// Port 1 on loopback: connection refused, immediate and reliable.
	ch := NewEmail("mail", "127.0.0.1:1", "sf@lab.test", []string{"soc@lab.test"}, "", "", false, "")
	err := ch.Deliver(context.Background(), sampleAlert())
	if err == nil {
		t.Fatal("expected dial failure")
	}
	if !ch.Retryable(err) {
		t.Fatalf("transport failure must be retryable: %v", err)
	}
}

func TestEmailSubjectIsHeaderSafe(t *testing.T) {
	a := sampleAlert()
	a.RuleName = "evil\r\nBcc: victim@example.com"
	subj := mailSubject(a)
	if strings.ContainsAny(subj, "\r\n") {
		t.Fatalf("subject smuggles a header: %q", subj)
	}
	// The folded text survives as ONE line of subject text; the attack
	// (a second header) is structurally impossible.
	if !strings.Contains(subj, "Bcc: victim@example.com @ LAB-WKS-01") {
		t.Fatalf("subject lost the folded content as text: %q", subj)
	}
}

func TestEmailLongSubjectIsClamped(t *testing.T) {
	a := sampleAlert()
	a.RuleName = strings.Repeat("x", 300) // the subject is built from rule+host
	subj := mailSubject(a)
	if runes := len([]rune(subj)); runes > maxSubjectRunes {
		t.Fatalf("subject = %d runes, cap is %d", runes, maxSubjectRunes)
	}
	if !strings.HasSuffix(subj, "…") {
		t.Fatalf("clamped subject should end with an ellipsis: %q", subj)
	}
}

func TestEmailMessageIDUsesAlertID(t *testing.T) {
	srv := newFakeSMTP(t, false)
	ch := NewEmail("mail", srv.addr(), "sf@lab.test", []string{"soc@lab.test"}, "", "", false, "")
	if err := ch.Deliver(context.Background(), sampleAlert()); err != nil {
		t.Fatalf("Deliver: %v", err)
	}
	_, _, bodies, _ := srv.snapshot()
	if len(bodies) != 1 || !strings.Contains(bodies[0], "Message-ID: <LAB-0001@security-framework>\n") {
		t.Fatalf("Message-ID missing or wrong:\n%s", bodies)
	}
}
