package ingest

import (
	"fmt"
	"net"

	"github.com/Ruby570bocadito/bluetardigrade/internal/tlsutil"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// NewTLS creates a server bound to addr whose connections are wrapped
// in TLS, pushing parsed events into the provided channel. It is the
// encrypted variant of New: everything else (NDJSON framing, the AUTH
// handshake, counters, Shutdown semantics) is identical because the
// handlers operate on net.Conn and tls.Conn satisfies it.
//
// The certificate/key pair is loaded eagerly, so a typo in a path or a
// mismatched pair fails at startup instead of silently serving in
// clear text. From then on the pair is re-read whenever the mtime of
// either file changes — see internal/tlsutil for the rotation
// semantics (the reloader was promoted there when the HTTP API grew
// its own TLS listener; one implementation, two listeners).
//
// Typical deployment: sensors on other hosts dialing a loopback-open
// engine become   sf-engine -addr 0.0.0.0:7777 -ingest-cert c.pem
// -ingest-key k.pem -token ...   with sensors connecting via
// devsensor -tls -ca ca.pem. TLS encrypts the channel; the shared
// token still authenticates the sender — for untrusted networks both
// layers belong together.
func NewTLS(addr, certFile, keyFile string, events chan<- *model.Event) (*Server, error) {
	reloader, err := tlsutil.NewReloader(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("ingest: %w", err)
	}
	ln, err := reloader.Listen(addr)
	if err != nil {
		return nil, fmt.Errorf("ingest: listen %s: %w", addr, err)
	}
	return &Server{
		addr:     addr,
		events:   events,
		listener: ln,
		open:     make(map[net.Conn]struct{}),
		tls:      true,
		reloader: reloader,
	}, nil
}

// TLS reports whether the listener speaks TLS (as opposed to plain
// TCP). Useful for startup banners and tests.
func (s *Server) TLS() bool { return s.tls }

// CertReloads returns how many times the cert/key pair was re-read
// and swapped in place (certificate rotation events, zero until the
// operator replaces a file). Plain listeners report 0.
func (s *Server) CertReloads() uint64 {
	if s.reloader == nil {
		return 0
	}
	return s.reloader.Reloads()
}

// CertReloadErrors returns how many times a reload was attempted and
// refused (stat failure or invalid material): the current certificate
// kept serving in every one of those cases.
func (s *Server) CertReloadErrors() uint64 {
	if s.reloader == nil {
		return 0
	}
	return s.reloader.Errors()
}

// SetReloadNotify wires the host binary's voice into certificate
// rotation events (reloaded / reload failed). Call before Serve. The
// callback runs on the handshake path: keep it quick and
// non-blocking. nil (the default) keeps ingest silent.
func (s *Server) SetReloadNotify(fn func(event string, reloads, reloadErrs uint64)) {
	if s.reloader == nil {
		return
	}
	s.reloader.SetReloadNotify(fn)
}
