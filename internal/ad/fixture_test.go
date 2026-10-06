package ad

// Test-only LDAP fixture: a minimal directory server speaking enough
// of RFC 4511 for the connector's real client (go-ldap) to exercise
// bind, paged search (RFC 2696) and StartTLS against it over loopback
// TLS. It is INERT by design: it serves canned entries from memory and
// can neither write to nor proxy anything — the same spirit as the
// synthetic telemetry scenarios (no domain, no network beyond
// 127.0.0.1, no third-party binaries).
//
// Wire shapes mirror what the go-ldap client itself encodes and
// decodes (the fixture speaks the client's dialect, so a protocol
// drift shows up as a failing test, not as a silent false green).

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/go-asn1-ber/asn1-ber"
)

// RFC 4511 protocolOp application tags. asn1-ber only knows BER; the
// LDAP-specific tag numbers live here so the fixture states exactly
// which messages it speaks.
const (
	ApplicationBindRequest       ber.Tag = 0
	ApplicationBindResponse      ber.Tag = 1
	ApplicationSearchRequest     ber.Tag = 3
	ApplicationSearchResultEntry ber.Tag = 4
	ApplicationSearchResultDone  ber.Tag = 5
	ApplicationExtendedRequest   ber.Tag = 23
	ApplicationExtendedResponse  ber.Tag = 24
)

// fixtureBase is the DIT root the fixture serves; anything else
// matches nothing (an empty success, like a real directory).
const fixtureBase = "DC=testdom,DC=example,DC=com"

// pagingControlOID is RFC 2696's paged-results control.
const pagingControlOID = "1.2.840.113556.1.4.319"

// fixtureEntry is one canned directory object.
type fixtureEntry struct {
	dn    string
	attrs map[string][]string
}

// fixtureServer is the test LDAP server (LDAPS from accept, or plain
// until the client asks for StartTLS).
type fixtureServer struct {
	listener net.Listener
	tlsOn    bool
	tlsCfg   *tls.Config

	bindDN   string
	password string
	entries  []fixtureEntry

	// pageSize is the fixture's own server-side maximum page (a real
	// DC enforces MaxPageSize no matter what the client asks for).
	pageSize int

	// bindOK gates the connection loop: after a refused bind the
	// response carries the result code and the connection closes.
	bindOK bool
	// bindAttempts records every bind attempt (name, password) for the
	// tests to assert the connector never went anonymous.
	bindMu    sync.Mutex
	bindLog   [][2]string
	t         *testing.T
	closeOnce sync.Once
	closed    chan struct{}
}

func newFixtureServer(t *testing.T, entries []fixtureEntry, ldaps bool) (*fixtureServer, string, string) {
	t.Helper()
	caPath, tlsCfg := testCertificates(t)
	var ln net.Listener
	var err error
	if ldaps {
		ln, err = tls.Listen("tcp", "127.0.0.1:0", tlsCfg)
	} else {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		t.Fatalf("fixture: listen: %v", err)
	}
	s := &fixtureServer{
		listener: ln,
		tlsOn:    ldaps,
		tlsCfg:   tlsCfg,
		bindDN:   "CN=soc-reader,OU=Service Accounts," + fixtureBase,
		password: "correct horse battery staple",
		pageSize: 2, // force real pagination: the tests load 5+ entries
		entries:  entries,
		t:        t,
		closed:   make(chan struct{}),
	}
	go s.acceptLoop()
	return s, caPath, ln.Addr().String()
}

func (s *fixtureServer) bindAttempts() [][2]string {
	s.bindMu.Lock()
	defer s.bindMu.Unlock()
	return append([][2]string{}, s.bindLog...)
}

func (s *fixtureServer) close() {
	s.closeOnce.Do(func() {
		close(s.closed)
		s.listener.Close()
	})
}

func (s *fixtureServer) acceptLoop() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.closed:
				return
			default:
				continue
			}
		}
		go s.serveConn(conn)
	}
}

func (s *fixtureServer) serveConn(raw net.Conn) {
	defer raw.Close()
	conn := raw
	if !s.tlsOn {
		upgraded, ok := s.upgradeStartTLS(conn)
		if !ok {
			return
		}
		conn = upgraded
	}
	for {
		p, raw, err := decodePacketConn(conn)
		if err != nil {
			return
		}
		if len(p.Children) < 2 {
			return
		}
		msgID := p.Children[0].Value.(int64)
		op := p.Children[1]
		switch {
		case op.ClassType == ber.ClassApplication && op.Tag == ApplicationBindRequest:
			ok := s.handleBind(conn, msgID, op, raw)
			if !ok {
				return // refused: result code sent, close like a real DC
			}
		case op.ClassType == ber.ClassApplication && op.Tag == ApplicationSearchRequest:
			s.serveSearch(conn, msgID, p, op)
		default:
			return // unbind (2) or anything unsupported: close
		}
	}
}

// decodePacketConn reads exactly one BER TLV from the stream and
// decodes it (definite-length form, the only one the go-ldap client
// emits). It returns the decoded packet AND the raw frame: the bind
// handler needs the raw octets because the simple password is a
// context-class primitive asn1-ber does not surface.
func decodePacketConn(conn net.Conn) (*ber.Packet, []byte, error) {
	var hdr [2]byte
	if _, err := io.ReadFull(conn, hdr[:]); err != nil {
		return nil, nil, err
	}
	buf := append([]byte{}, hdr[:]...)
	length := int(hdr[1])
	if hdr[1]&0x80 != 0 {
		n := int(hdr[1] & 0x7f)
		if n == 0 || n > 4 {
			return nil, nil, fmt.Errorf("fixture: unsupported BER length form %#x", hdr[1])
		}
		lenBuf := make([]byte, n)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return nil, nil, err
		}
		// long form: the first byte only counts the octets that
		// follow; the value comes solely from those octets
		length = 0
		for _, b := range lenBuf {
			length = length<<8 | int(b)
		}
		buf = append(buf, lenBuf...)
	}
	if length < 0 || length > 1<<24 {
		return nil, nil, fmt.Errorf("fixture: implausible BER length %d", length)
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(conn, body); err != nil {
		return nil, nil, err
	}
	raw := append(buf, body...)
	return ber.DecodePacket(raw), raw, nil
}

// simpleBindPassword walks the raw LDAPMessage frame to the Bind
// Request's [0] simple authentication octets:
// LDAPMessage(SEQUENCE) > messageID, BindRequest([APPLICATION 0]) >
// version, name, authentication([CONTEXT 0]).
func simpleBindPassword(raw []byte) (string, bool) {
	_, msgContent, ok := berCut(raw)
	if !ok {
		return "", false
	}
	kids := berTLVs(msgContent)
	if len(kids) < 2 {
		return "", false
	}
	_, bindContent, ok := berCut(kids[1])
	if !ok {
		return "", false
	}
	fields := berTLVs(bindContent)
	if len(fields) < 3 {
		return "", false
	}
	id, content, ok := berCut(fields[2])
	if !ok || id != 0x80 { // [0] simple, primitive context class
		return "", false
	}
	return string(content), true
}

// berTLVs splits a constructed element's content into its immediate
// child TLVs.
func berTLVs(content []byte) [][]byte {
	var out [][]byte
	for len(content) > 0 {
		_, _, kid, rest, ok := berCutAll(content)
		if !ok {
			return out
		}
		out = append(out, kid)
		content = rest
	}
	return out
}

// berCut takes one definite-length TLV off the front of buf and
// returns its identifier octet and content.
func berCut(buf []byte) (byte, []byte, bool) {
	id, content, _, _, ok := berCutAll(buf)
	return id, content, ok
}

// berCutAll is berCut but also returns the whole TLV and the
// remainder so callers can walk a constructed buffer.
func berCutAll(buf []byte) (byte, []byte, []byte, []byte, bool) {
	if len(buf) < 2 {
		return 0, nil, nil, nil, false
	}
	id := buf[0]
	length := int(buf[1])
	hdr := 2
	if buf[1]&0x80 != 0 {
		n := int(buf[1] & 0x7f)
		if n == 0 || n > 4 || 2+n > len(buf) {
			return 0, nil, nil, nil, false
		}
		length = 0
		for _, b := range buf[2 : 2+n] {
			length = length<<8 | int(b)
		}
		hdr = 2 + n
	}
	if hdr+length > len(buf) {
		return 0, nil, nil, nil, false
	}
	return id, buf[hdr : hdr+length], buf[:hdr+length], buf[hdr+length:], true
}

// upgradeStartTLS answers the client's StartTLS extended request and
// wraps the connection in TLS (RFC 4511 §4.14.3).
func (s *fixtureServer) upgradeStartTLS(conn net.Conn) (net.Conn, bool) {
	p, _, err := decodePacketConn(conn)
	if err != nil {
		return conn, false
	}
	op := p.Children[1]
	if !(op.ClassType == ber.ClassApplication && op.Tag == ApplicationExtendedRequest) {
		return conn, false
	}
	resp := ber.Encode(ber.ClassApplication, ber.TypeConstructed, ApplicationExtendedResponse, nil, "StartTLS Response")
	resp.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, int64(0), "resultCode"))
	resp.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "matchedDN"))
	resp.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "errorMessage"))
	msg := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAPMessage")
	msg.AppendChild(p.Children[0])
	msg.AppendChild(resp)
	if _, err := conn.Write(msg.Bytes()); err != nil {
		return conn, false
	}
	tlsConn := tls.Server(conn, s.tlsCfg)
	if err := tlsConn.Handshake(); err != nil {
		return conn, false
	}
	return tlsConn, true
}

func (s *fixtureServer) handleBind(conn net.Conn, msgID int64, op *ber.Packet, raw []byte) bool {
	name, password := "", ""
	if len(op.Children) >= 2 {
		if v, ok := op.Children[1].Value.(string); ok {
			name = v
		}
	}
	// The simple bind password is a context-class primitive ([0] OCTET
	// STRING): asn1-ber populates Value/Data only for the universal
	// class, so those octets are read straight from the wire frame.
	if pw, ok := simpleBindPassword(raw); ok {
		password = pw
	}
	ok := name == s.bindDN && password == s.password
	code := int64(0)
	if !ok {
		code = 49 // invalidCredentials (anonymous or wrong password alike)
	}
	s.bindMu.Lock()
	s.bindLog = append(s.bindLog, [2]string{name, password})
	s.bindOK = ok
	s.bindMu.Unlock()

	resp := ber.Encode(ber.ClassApplication, ber.TypeConstructed, ApplicationBindResponse, nil, "BindResponse")
	resp.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, code, "resultCode"))
	resp.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "matchedDN"))
	resp.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "errorMessage"))
	msg := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAPMessage")
	msg.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, msgID, "MessageID"))
	msg.AppendChild(resp)
	conn.Write(msg.Bytes())
	return ok
}

// serveSearch handles one paged (or unpaged) search request. Cookie
// bytes are an opaque little-endian offset cursor, exactly the kind of
// server-side iteration state a real DC keeps.
func (s *fixtureServer) serveSearch(conn net.Conn, msgID int64, top, op *ber.Packet) {
	base := op.Children[0].Value.(string)
	category := filterEquality(op.Children[6], "objectCategory")
	offset := uint32(0)
	pageSize := 0
	if len(top.Children) >= 3 {
		for _, ctrl := range top.Children[2].Children {
			if len(ctrl.Children) == 0 {
				continue
			}
			ctype, _ := ctrl.Children[0].Value.(string)
			if ctype != pagingControlOID {
				continue
			}
			var value *ber.Packet
			for i := len(ctrl.Children) - 1; i >= 1; i-- {
				if ctrl.Children[i].TagType == ber.TypePrimitive && ctrl.Children[i].Tag == ber.TagOctetString {
					value = ctrl.Children[i]
					break
				}
			}
			if value == nil {
				continue
			}
			inner := ber.DecodePacket(value.Data.Bytes())
			if inner == nil || len(inner.Children) < 2 {
				continue
			}
			size, _ := inner.Children[0].Value.(int64)
			cookie := inner.Children[1].Data.Bytes()
			pageSize = int(size)
			if len(cookie) == 4 {
				offset = binary.LittleEndian.Uint32(cookie)
			}
		}
	}

	matched := []fixtureEntry{}
	if base == fixtureBase {
		for _, e := range s.entries {
			if vals := e.attrs["objectCategory"]; len(vals) > 0 && (category == "" || vals[0] == category) {
				matched = append(matched, e)
			}
		}
	}

	sendPage := func(entries []fixtureEntry, cookie []byte, withControl bool) {
		for _, e := range entries {
			msg := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAPMessage")
			msg.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, msgID, "MessageID"))
			entry := ber.Encode(ber.ClassApplication, ber.TypeConstructed, ApplicationSearchResultEntry, nil, "SearchResultEntry")
			entry.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, e.dn, "objectName"))
			attrs := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attributes")
			names := make([]string, 0, len(e.attrs))
			for name := range e.attrs {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				a := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attribute")
				a.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, name, "type"))
				vals := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSet, nil, "vals")
				for _, v := range e.attrs[name] {
					vals.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, v, "value"))
				}
				a.AppendChild(vals)
				attrs.AppendChild(a)
			}
			entry.AppendChild(attrs)
			msg.AppendChild(entry)
			conn.Write(msg.Bytes())
		}

		done := ber.Encode(ber.ClassApplication, ber.TypeConstructed, ApplicationSearchResultDone, nil, "SearchResultDone")
		done.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, int64(0), "resultCode"))
		done.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "matchedDN"))
		done.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "errorMessage"))

		msg := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAPMessage")
		msg.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, msgID, "MessageID"))
		// RFC 4511 LDAPMessage: messageID, protocolOp, controls —
		// the SearchResultDone (protocolOp) goes BEFORE the
		// response control, or the client reads tag 0 where it
		// expects tag 5 and the paging loop stalls.
		msg.AppendChild(done)
		if withControl {
			ctrls := ber.Encode(ber.ClassContext, ber.TypeConstructed, 0, nil, "Controls")
			c := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "Control")
			c.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, pagingControlOID, "controlType"))
			value := ber.Encode(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, nil, "controlValue")
			seq := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "SearchControlValue")
			seq.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, int64(s.pageSize), "size"))
			cookiePkt := ber.Encode(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, nil, "cookie")
			cookiePkt.Data.Write(cookie)
			// AppendChild writes the child's bytes into Data: the same
			// mechanics the client's own ControlPaging.Encode relies on
			seq.AppendChild(cookiePkt)
			value.AppendChild(seq)
			c.AppendChild(value)
			ctrls.AppendChild(c)
			msg.AppendChild(ctrls)
		}
		conn.Write(msg.Bytes())
	}

	if pageSize <= 0 {
		// no paging control (or the connector's abandon search with
		// size 0): serve everything from the offset, no control echo
		if int(offset) >= len(matched) {
			sendPage(nil, nil, false)
			return
		}
		sendPage(matched[offset:], nil, false)
		return
	}
	if int(offset) >= len(matched) {
		sendPage(nil, nil, true) // cursor past the end: final empty page
		return
	}
	end := int(offset) + pageSize
	if end > len(matched) {
		end = len(matched)
	}
	page := matched[offset:end]
	if end >= len(matched) {
		sendPage(page, nil, true) // empty cookie = last page
		return
	}
	next := make([]byte, 4)
	binary.LittleEndian.PutUint32(next, uint32(end))
	sendPage(page, next, true)
}

// filterEquality walks a filter packet and returns the FIRST equality
// match value for the named attribute (the fixture only needs
// objectCategory to tell its canned sets apart).
func filterEquality(filter *ber.Packet, attr string) string {
	if filter == nil {
		return ""
	}
	if filter.ClassType == ber.ClassContext && filter.Tag == 3 && len(filter.Children) >= 2 {
		if v, ok := filter.Children[0].Value.(string); ok && v == attr {
			if val, ok := filter.Children[1].Value.(string); ok {
				return val
			}
		}
	}
	for _, child := range filter.Children {
		if v := filterEquality(child, attr); v != "" {
			return v
		}
	}
	return ""
}

// testCertificates builds a throwaway CA + leaf for the loopback
// listener and returns the CA PEM path (the connector's ca_file) plus
// the server TLS config. The leaf carries DNS "localhost".
func testCertificates(t *testing.T) (string, *tls.Config) {
	t.Helper()
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("ca key: %v", err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "fixture test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("ca cert: %v", err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatalf("parse ca: %v", err)
	}
	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("leaf key: %v", err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("leaf cert: %v", err)
	}
	caPath := filepath.Join(t.TempDir(), "fixture-ca.pem")
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	if err := os.WriteFile(caPath, caPEM, 0o600); err != nil {
		t.Fatalf("write ca pem: %v", err)
	}
	serverCert := tls.Certificate{Certificate: [][]byte{leafDER}, PrivateKey: leafKey}
	return caPath, &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		MinVersion:   tls.VersionTLS12,
	}
}
