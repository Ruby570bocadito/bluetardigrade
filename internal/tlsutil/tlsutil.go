// Package tlsutil owns the hot-rotating TLS certificate loader the
// ingest listener pioneered (certReloader) so every encrypted listener
// in the engine — ingest and the HTTP API — shares one
// implementation, one set of rotation semantics and one place to
// audit. The reloader serves the current certificate to every
// handshake and re-reads the cert/key pair from disk ONLY when the
// mtime of either file has changed since the last load: certificate
// rotation is a file replacement instead of a restart, and the NEXT
// connection is wrapped with the new material while connections
// already established keep the handshake they were born with.
//
// Failure semantics are asymmetric on purpose:
//
//   - The FIRST load (Reloader constructor) is fail-loud: a wrong
//     path or a mismatched pair aborts startup — a half-encrypted
//     surface never serves traffic.
//   - Every REload is fail-safe: broken material (a truncated file
//     caught mid-copy, a cert whose key does not match, an empty
//     write) leaves the CURRENT certificate serving and counts one
//     error. An encrypted channel can never degrade to anything worse
//     than "previous cert"; the operator sees the failure through the
//     reload-error counter and the notify hook wired by the host.
//
// mtime is the change signal because it is portable (no signals — the
// product is Windows-first and SIGHUP does not exist there) and cheap
// (two os.Stat per handshake, a full re-read only when something
// changed). A replacement that preserves the original mtimes is not
// detected: touch the files to force it.
package tlsutil

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// Reloader is the hot-rotation state for one listener's certificate.
// The zero value is not usable: construct it with NewReloader, which
// eagerly loads and validates the pair.
type Reloader struct {
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
	// voice. tlsutil itself stays silent (no logger of its own).
	notify func(event string, reloads, reloadErrs uint64)
}

// NewReloader eagerly loads the cert/key pair so a typo in a path or
// a mismatched pair fails at startup instead of silently serving in
// clear text.
func NewReloader(certFile, keyFile string) (*Reloader, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load TLS cert/key (%s, %s): %w", certFile, keyFile, err)
	}
	return &Reloader{
		certFile:  certFile,
		keyFile:   keyFile,
		cert:      &cert,
		certMtime: mtimeOrZero(certFile),
		keyMtime:  mtimeOrZero(keyFile),
	}, nil
}

// getCertificate satisfies tls.Config.GetCertificate. Returning the
// (possibly stale) certificate instead of an error is the fail-safe
// branch: a handshake that would fail outright leaves the client with
// a verification error anyway, while the listener keeps its current
// state clean and countable.
func (r *Reloader) getCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
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

// GetCertificate is the tls.Config callback exported for listeners
// built by their owners (the API wraps it this way).
func (r *Reloader) GetCertificate(hi *tls.ClientHelloInfo) (*tls.Certificate, error) {
	return r.getCertificate(hi)
}

// NotAfter returns the expiry of the certificate currently being
// served (SET-3: the console warns before a listener's pair lapses).
// ok is false only if the loaded material carries no parseable leaf —
// which cannot happen for pairs LoadX509KeyPair accepted, so the flag
// exists to keep the caller honest rather than to be exercised.
func (r *Reloader) NotAfter() (time.Time, bool) {
	r.mu.Lock()
	cert := r.cert
	r.mu.Unlock()
	if cert == nil || len(cert.Certificate) == 0 {
		return time.Time{}, false
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return time.Time{}, false
	}
	return leaf.NotAfter, true
}

// CertFile returns the configured certificate path (reported verbatim
// by the stats surface so an operator can find the file to renew).
func (r *Reloader) CertFile() string { return r.certFile }

// emit delivers a reload event through the notify hook, if any.
// Called with r.mu held: the hook must be quick and non-blocking (the
// engine only formats a line).
func (r *Reloader) emit(event string) {
	if r.notify != nil {
		r.notify(event, r.reloads.Load(), r.errors.Load())
	}
}

// SetReloadNotify wires the host binary's voice into certificate
// rotation events (reloaded / reload failed). The callback runs on
// the handshake path: keep it quick and non-blocking. nil (the
// default) keeps the reloader silent.
func (r *Reloader) SetReloadNotify(fn func(event string, reloads, reloadErrs uint64)) {
	r.notify = fn
}

// Reloads returns how many times the pair was re-read and swapped in
// place (rotation events; zero until the operator replaces a file).
func (r *Reloader) Reloads() uint64 { return r.reloads.Load() }

// Errors returns how many reload attempts were refused (stat failure
// or invalid material): the current certificate kept serving in every
// one of those cases.
func (r *Reloader) Errors() uint64 { return r.errors.Load() }

// Listen wraps a plain TCP listener on addr in TLS using r's
// certificate. Minimum protocol version is pinned to TLS 1.2: these
// listeners carry host telemetry (users, command lines) and pre-1.2
// ciphers have no place on a security pipeline.
func (r *Reloader) Listen(addr string) (net.Listener, error) {
	cfg := &tls.Config{
		MinVersion:     tls.VersionTLS12,
		GetCertificate: r.getCertificate,
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	return tls.NewListener(ln, cfg), nil
}

// mtimeOrZero records the mtimes NewReloader already knows are
// readable (the eager LoadX509KeyPair just succeeded), so the first
// handshake does not redundantly re-read the pair it was born with.
func mtimeOrZero(path string) time.Time {
	fi, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return fi.ModTime()
}
