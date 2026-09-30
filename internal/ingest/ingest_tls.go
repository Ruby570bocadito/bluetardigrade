package ingest

import (
	"crypto/tls"
	"fmt"
	"net"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// NewTLS creates a server bound to addr whose connections are wrapped
// in TLS, pushing parsed events into the provided channel. It is the
// encrypted variant of New: everything else (NDJSON framing, the AUTH
// handshake, counters, Shutdown semantics) is identical because the
// handlers operate on net.Conn and tls.Conn satisfies it.
//
// The certificate/key pair is loaded eagerly, so a typo in a path or a
// mismatched pair fails at startup instead of silently serving in
// clear text. Minimum protocol version is pinned to TLS 1.2: the feed
// carries host telemetry (users, command lines) and pre-1.2 ciphers
// have no place on a security pipeline.
//
// Typical deployment: sensors on other hosts dialing a loopback-open
// engine become   sf-engine -addr 0.0.0.0:7777 -ingest-cert c.pem
// -ingest-key k.pem -token ...   with sensors connecting via
// devsensor -tls -ca ca.pem. TLS encrypts the channel; the shared
// token still authenticates the sender — for untrusted networks both
// layers belong together.
func NewTLS(addr, certFile, keyFile string, events chan<- *model.Event) (*Server, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("ingest: load TLS cert/key (%s, %s): %w", certFile, keyFile, err)
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("ingest: listen %s: %w", addr, err)
	}
	cfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
	return &Server{
		addr:     addr,
		events:   events,
		listener: tls.NewListener(ln, cfg),
		open:     make(map[net.Conn]struct{}),
		tls:      true,
	}, nil
}

// TLS reports whether the listener speaks TLS (as opposed to plain
// TCP). Useful for startup banners and tests.
func (s *Server) TLS() bool { return s.tls }
