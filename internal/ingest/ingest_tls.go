package ingest

import (
	"crypto/tls"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// certReloader serves the current certificate to every TLS handshake
// and re-reads the cert/key pair from disk ONLY when the mtime of
// either file has changed since the last load. This is what makes
// certificate rotation a file replacement instead of an engine
// restart: the operator overwrites the PEM files in place and the
// NEXT connection is wrapped with the new material, while connections
// already established keep the handshake they were born with.
//
// Failure semantics are asymmetric on purpose:
//
//   - The FIRST load (NewTLS) is fail-loud: a wrong path or a
//     mismatched pair aborts startup — a half-encrypted feed never
//     serves traffic.
//   - Every REload is fail-safe: broken material (a truncated file
//     caught mid-copy, a cert whose key does not match, an empty
//     write) leaves the CURRENT certificate serving and counts one
//     error. An encrypted channel can never degrade to anything worse
//     than "previous cert"; the operator sees the failure through the
//     reload-error counter and the notify hook wired by the engine.
//
// mtime is the change signal because it is portable (no signals — the
// product is Windows-first and SIGHUP does not exist there) and cheap
// (two os.Stat per handshake, a full re-read only when something
// changed). A replacement that preserves the original mtimes is not
// detected: touch the files to force it.
type certReloader struct {
	certFile string
	keyFile  string

	mu   sync.Mutex
	cert *tls.Certificate

	certMtime time.Time
	keyMtime  time.Time

	reloads atomic.Uint64
	errors  atomic.Uint64

	// notify, when set by the host binary, receives one call per
	// reload outcome so the engine can put it in its own startup
	// voice. ingest itself stays silent (no logger of its own).
	notify func(event string, reloads, reloadErrs uint64)
}

// getCertificate satisfies tls.Config.GetCertificate. Returning the
// (possibly stale) certificate instead of an error is the fail-safe
// branch: a handshake that would fail outright leaves the client with
// a verification error anyway, while the listener keeps its current
// state clean and countable.
func (r *certReloader) getCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	ci, err := os.Stat(r.certFile)
	if err != nil {
		r.errors.Add(1)
		r.emit("reload failed: stat cert")
		return r.cert, nil
	}
	ki, err := os.Stat(r.keyFile)
	if err != nil {
		r.errors.Add(1)
		r.emit("reload failed: stat key")
		return r.cert, nil
	}
	cm, km := ci.ModTime(), ki.ModTime()
	if cm.Equal(r.certMtime) && km.Equal(r.keyMtime) {
		return r.cert, nil // cache hit: nothing changed on disk
	}

	pair, err := tls.LoadX509KeyPair(r.certFile, r.keyFile)
	if err != nil {
		r.errors.Add(1)
		r.emit("reload failed: keeping current certificate")
		// remember the mtimes we failed on so a handshake storm does
		// not retry the broken pair on every connection: the retry
		// happens when the operator fixes a file and mtime moves again
		r.certMtime, r.keyMtime = cm, km
		return r.cert, nil
	}
	r.cert = &pair
	r.certMtime, r.keyMtime = cm, km
	r.reloads.Add(1)
	r.emit("certificate reloaded")
	return r.cert, nil
}

// emit delivers a reload event through the notify hook, if any. Called
// with r.mu held: the hook must be quick and non-blocking (the engine
// only formats a line).
func (r *certReloader) emit(event string) {
	if r.notify != nil {
		r.notify(event, r.reloads.Load(), r.errors.Load())
	}
}

// NewTLS creates a server bound to addr whose connections are wrapped
// in TLS, pushing parsed events into the provided channel. It is the
// encrypted variant of New: everything else (NDJSON framing, the AUTH
// handshake, counters, Shutdown semantics) is identical because the
// handlers operate on net.Conn and tls.Conn satisfies it.
//
// The certificate/key pair is loaded eagerly, so a typo in a path or a
// mismatched pair fails at startup instead of silently serving in
// clear text. From then on the pair is re-read whenever the mtime of
// either file changes — see certReloader for the rotation semantics.
//
// Minimum protocol version is pinned to TLS 1.2: the feed carries
// host telemetry (users, command lines) and pre-1.2 ciphers have no
// place on a security pipeline.
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
	r := &certReloader{
		certFile:  certFile,
		keyFile:   keyFile,
		cert:      &cert,
		certMtime: mtimeOrZero(certFile),
		keyMtime:  mtimeOrZero(keyFile),
	}
	cfg := &tls.Config{
		MinVersion:     tls.VersionTLS12,
		GetCertificate: r.getCertificate,
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("ingest: listen %s: %w", addr, err)
	}
	return &Server{
		addr:     addr,
		events:   events,
		listener: tls.NewListener(ln, cfg),
		open:     make(map[net.Conn]struct{}),
		tls:      true,
		reloader: r,
	}, nil
}

// mtimeOrZero records the mtimes NewTLS already knows are readable
// (the eager LoadX509KeyPair just succeeded), so the first handshake
// does not redundantly re-read the pair it was born with.
func mtimeOrZero(path string) time.Time {
	fi, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return fi.ModTime()
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
	return s.reloader.reloads.Load()
}

// CertReloadErrors returns how many times a reload was attempted and
// refused (stat failure or invalid material): the current certificate
// kept serving in every one of those cases.
func (s *Server) CertReloadErrors() uint64 {
	if s.reloader == nil {
		return 0
	}
	return s.reloader.errors.Load()
}

// SetReloadNotify wires the host binary's voice into certificate
// rotation events (reloaded / reload failed). Call before Serve. The
// callback runs on the handshake path: keep it quick and
// non-blocking. nil (the default) keeps ingest silent.
func (s *Server) SetReloadNotify(fn func(event string, reloads, reloadErrs uint64)) {
	if s.reloader == nil {
		return
	}
	s.reloader.notify = fn
}
