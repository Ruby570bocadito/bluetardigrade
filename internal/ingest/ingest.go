// Package ingest accepts NDJSON event streams from sensors over TCP.
// One JSON object per newline-terminated line; oversized lines are
// rejected to protect the engine's memory.
//
// Optional shared-token auth: when a token is configured (SetToken),
// every connection must send "AUTH <token>" as its FIRST line within
// authTimeout, before any event. During a token rotation
// (SetPreviousToken) both the current and the previous token validate,
// so sensors can be redeployed without dropping a single connection.
// The comparison is constant-time and failures close the connection
// with a clear ack, so a misconfigured sensor fails loudly instead of
// silently losing events.
package ingest

import (
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/tlsutil"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const (
	maxLineSize = 1 << 20 // 1 MiB per event line
	idleTimeout = 5 * time.Minute
	ackOK       = `{"ack":"ok"}` + "\n"

	// maxConns caps concurrent ingest connections. Every conn pins a
	// goroutine and up to maxLineSize of scanner buffer BEFORE any
	// authentication completes, so an unbounded accept loop turns a
	// pre-auth connection flood into FD/RAM exhaustion — a remote-bind
	// engine (0.0.0.0 + token) must not be cheaper to crash than to
	// authenticate against. Legitimate fleets sit far below this; over
	// the cap the connection is closed immediately and counted in
	// Rejected (the same counter the console already surfaces).
	maxConns = 512
)

// authTimeout bounds how long the server waits for the AUTH line.
// Held atomically (not a plain var) so tests can shorten it: handle()
// goroutines from a neighboring test's connections can still be
// running when the next test swaps the value, and a plain variable
// is a data race under -race.
var authTimeoutNanos atomic.Int64

const defaultAuthTimeout = 10 * time.Second

func authTimeout() time.Duration { return time.Duration(authTimeoutNanos.Load()) }

func init() { authTimeoutNanos.Store(int64(defaultAuthTimeout)) }

// Server is a concurrent NDJSON-over-TCP listener. Connections arrive
// either in clear text (New) or wrapped in TLS (NewTLS); the handlers
// below are agnostic to the difference.
type Server struct {
	addr      string
	events    chan<- *model.Event
	listener  net.Listener
	conns     sync.WaitGroup
	mu        sync.Mutex
	closing   bool
	open      map[net.Conn]struct{}
	token     string            // empty = auth disabled (loopback deployments)
	prevToken string            // still accepted during a rotation window
	tls       bool              // true when the listener wraps connections in TLS
	reloader  *tlsutil.Reloader // hot-rotation state; nil on plain listeners

	received atomic.Uint64
	dropped  atomic.Uint64
	rejected atomic.Uint64
}

// New creates a server bound to addr, pushing parsed events into the
// provided channel. For encrypted transport use NewTLS.
func New(addr string, events chan<- *model.Event) (*Server, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("ingest: listen %s: %w", addr, err)
	}
	return &Server{addr: addr, events: events, listener: ln,
		open: make(map[net.Conn]struct{})}, nil
}

// SetToken enables shared-token auth: connections must send
// "AUTH <token>" as their first line. Call before Serve. An empty
// token disables auth (loopback-only deployments).
func (s *Server) SetToken(token string) { s.token = token }

// SetPreviousToken registers the previous ingest token, which stays
// valid alongside the current one until the process restarts — the
// window operators need to redeploy sensors with the new token
// without downtime. Call after SetToken and before Serve. It is
// ignored when no primary token is configured or when it equals the
// current token (nothing to rotate).
func (s *Server) SetPreviousToken(prev string) {
	if s.token != "" && prev != "" && prev != s.token {
		s.prevToken = prev
	}
}

// Rotating reports whether a previous token is still being accepted.
func (s *Server) Rotating() bool { return s.prevToken != "" }

// AuthEnabled reports whether the ingest requires the AUTH handshake.
func (s *Server) AuthEnabled() bool { return s.token != "" }

// Addr returns the bound address (useful when listening on :0).
func (s *Server) Addr() string { return s.listener.Addr().String() }

// Received returns the number of valid events ingested.
func (s *Server) Received() uint64 { return s.received.Load() }

// Dropped returns the number of malformed lines rejected.
func (s *Server) Dropped() uint64 { return s.dropped.Load() }

// Rejected returns the number of connections closed before serving
// events: failing the AUTH handshake (wrong token, missing token, or
// timeout) or tripping the concurrent-connection cap.
func (s *Server) Rejected() uint64 { return s.rejected.Load() }

// Serve accepts connections until Shutdown is called.
func (s *Server) Serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			s.mu.Lock()
			closing := s.closing
			s.mu.Unlock()
			if closing {
				return
			}
			continue // transient accept error; keep accepting
		}
		// Register the connection AND arm its handler counter under mu,
		// the same critical section Shutdown uses to set closing and
		// close everything in open: either Serve sees closing (the conn
		// is closed here, never counted) or Shutdown sees the conn in
		// open (closes it), and every Add(1) is ordered by the mutex
		// strictly before conns.Wait(). The old free-standing Add could
		// land after Wait had already returned — a data race against the
		// WaitGroup and an unsynchronized late connection on every
		// shutdown whose accept window had a connection in flight
		// (race report 03-A round 21h59, reproduced under -race).
		s.mu.Lock()
		if s.closing {
			s.mu.Unlock()
			conn.Close()
			continue
		}
		// connection cap: len(open) is exact under mu — the
		// same critical section Shutdown uses, so a connection
		// rejected here is closed by us and never counted as an
		// open one anywhere else.
		if len(s.open) >= maxConns {
			s.mu.Unlock()
			s.rejected.Add(1)
			_, _ = fmt.Fprintln(conn, `{"ack":"error","error":"connection limit reached, retry shortly"}`)
			conn.Close()
			continue
		}
		s.conns.Add(1)
		s.open[conn] = struct{}{}
		s.mu.Unlock()
		go s.handle(conn)
	}
}

// Shutdown stops the accept loop, force-closes every open connection
// (idle sensors must not delay the stop) and, once no sender goroutines
// remain, closes the events channel so the consumer's range loop drains
// the buffer and terminates.
func (s *Server) Shutdown() {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return
	}
	s.closing = true
	for c := range s.open {
		_ = c.Close() // unblock handlers parked in a read deadline
	}
	s.mu.Unlock()
	_ = s.listener.Close()
	s.conns.Wait()
	close(s.events)
}

// handle serves one connection. Serve registers the conn in open and
// arms its WaitGroup counter BEFORE starting this goroutine (see the
// shutdown-synchronization comment there) — this function only cleans
// both up: leaving the counter fires, leaving open forgets the conn so
// a concurrent Shutdown stops force-closing it.
func (s *Server) handle(conn net.Conn) {
	defer s.conns.Done()
	defer func() {
		s.mu.Lock()
		delete(s.open, conn)
		s.mu.Unlock()
		conn.Close()
	}()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineSize)

	// First line decides the connection's fate:
	//   - token configured: it MUST be "AUTH <token>" within
	//     authTimeout, before any event.
	//   - no token: an AUTH line is still rejected (closed) so a
	//     sensor with a stale token fails loudly; anything else is
	//     a regular event and gets the regular idle timeout, so
	//     legacy sensors keep their original behavior.
	if s.token != "" {
		conn.SetReadDeadline(time.Now().Add(authTimeout()))
	} else {
		conn.SetReadDeadline(time.Now().Add(idleTimeout))
	}

	first := true
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		if first {
			first = false
			if s.token != "" || isAuthLine(line) {
				if !s.checkAuth(conn, line) {
					return
				}
				conn.SetReadDeadline(time.Now().Add(idleTimeout))
				continue // AUTH consumed; events come next
			}
		}
		ev, err := decode(line)
		if err != nil {
			s.dropped.Add(1)
			fmt.Fprintf(conn, `{"ack":"error","error":%q}`+"\n", err.Error())
			continue
		}
		s.received.Add(1)
		conn.SetReadDeadline(time.Now().Add(idleTimeout))
		s.events <- ev
	}
}

// isAuthLine reports whether line is an AUTH request.
func isAuthLine(line []byte) bool {
	return len(line) >= 5 && string(line[:5]) == "AUTH "
}

// checkAuth validates the first line of a connection. It returns false
// when the connection must be closed: wrong or missing token with auth
// enabled, or any AUTH attempt with auth disabled. The token comparison
// is constant-time so connection timing cannot be used to probe it.
func (s *Server) checkAuth(conn net.Conn, line []byte) bool {
	if s.token == "" {
		s.rejected.Add(1)
		fmt.Fprintln(conn, `{"ack":"error","error":"engine has no ingest token configured; unset -token/SF_INGEST_TOKEN on the sensor or set one on the engine"}`)
		return false
	}
	if !isAuthLine(line) || !s.tokenMatches(line[5:]) {
		s.rejected.Add(1)
		fmt.Fprintln(conn, `{"ack":"error","error":"auth failed: send 'AUTH <token>' as the first line"}`)
		return false
	}
	_, _ = fmt.Fprint(conn, ackOK)
	return true
}

// tokenMatches reports whether supplied equals the current token or,
// during a rotation window, the previous one. Both comparisons run in
// constant time and are combined without branching on the content, so
// timing cannot be used to probe which token (if any) matched.
//
// The bitwise OR is a bit-parallel logical OR of two booleans: on all
// supported Go versions ConstantTimeCompare returns exactly 0 or 1
// (0 also for length mismatches), so (cur | prev) == 1 accepts exactly
// when either comparison matched. Cross-reviewed 2026-09-30 with a
// different-length previous token end-to-end; do not "fix" this to
// == 1 on each result — the combined form is what avoids leaking
// which token matched.
func (s *Server) tokenMatches(supplied []byte) bool {
	cur := subtle.ConstantTimeCompare(supplied, []byte(s.token))
	prev := 0
	if s.prevToken != "" {
		prev = subtle.ConstantTimeCompare(supplied, []byte(s.prevToken))
	}
	return (cur | prev) == 1
}

func decode(line []byte) (*model.Event, error) {
	ev := new(model.Event)
	if err := json.Unmarshal(line, ev); err != nil {
		return nil, fmt.Errorf("bad json: %v", err)
	}
	normalizeIdentity(ev)
	stripFieldSep(ev)
	if err := ev.Validate(); err != nil {
		return nil, err
	}
	return ev, nil
}

// Identity-field caps for boundary normalization. Host and user end up
// pinned in long-lived engine state: the alert dedup map (hard cap
// 65536 keys, keyed by rule|host|pid) and the sequence correlator (up
// to 8192 states, each keeping host and user). Ingest lines may carry
// up to maxLineSize, so without a cap a hostile or misconfigured feed
// could park ~1 MiB per unique host/user across those structures — the
// line cap bounds the count of pinned entries, not their bytes. The
// caps sit far above any legitimate value (RFC 1123 FQDN <= 253 bytes,
// Windows usernames <= 104 chars, UUIDs <= 36 chars). Oversized values
// are truncated, not dropped, so visibility wins — the same philosophy
// as the alert summary truncation.
const (
	maxHostRunes = 255
	maxUserRunes = 256
	maxIDRunes   = 128

	// maxDestRunes caps the feed-controlled network destination that
	// the beaconing detector (A3) pins as a live map key (the same
	// long-lived-state hazard host/user/ID cover): RFC 1123 caps an
	// FQDN at 253 bytes and every textual IPv4/IPv6 fits far below,
	// so legitimate destinations pass byte-identical while a hostile
	// ~1 MiB "domain" cannot park its bytes in detector state.
	maxDestRunes = 253
)

// normalizeIdentity truncates the feed-controlled identity fields that
// long-lived engine state pins (see the caps above): host/user/id, and
// the network destination the beaconing detector keys its state on.
func normalizeIdentity(ev *model.Event) {
	ev.Host = truncateRunes(ev.Host, maxHostRunes)
	ev.User = truncateRunes(ev.User, maxUserRunes)
	ev.ID = truncateRunes(ev.ID, maxIDRunes)
	if ev.Network != nil {
		ev.Network.DestinationIP = truncateRunes(ev.Network.DestinationIP, maxDestRunes)
		ev.Network.Domain = truncateRunes(ev.Network.Domain, maxDestRunes)
	}
}

// fieldSep is the control rune the search haystacks join their fields
// with (the API rings and the SQLite store use the same one): a value
// carrying it inside a single field would forge a field boundary, so
// it is stripped from every feed-controlled string at the boundary —
// the chokepoint the ring and the store share. Every other byte is
// kept: evidence fidelity wins, one control rune is not evidence.
const fieldSep = "\x1f"

// stripFieldSep removes fieldSep from every feed-controlled string of
// the event. Without this, a hostile feed could plant the separator
// inside one field and make its own row answer cross-field free-text
// queries it was never about — and the ring and the store (joined
// haystack) would disagree on the same ?q=.
func stripFieldSep(ev *model.Event) {
	ev.ID = noSep(ev.ID)
	ev.Type = noSep(ev.Type)
	ev.Source = noSep(ev.Source)
	ev.Host = noSep(ev.Host)
	ev.User = noSep(ev.User)
	for _, p := range []*model.Process{ev.Process, ev.Target} {
		if p == nil {
			continue
		}
		p.Name = noSep(p.Name)
		p.CommandLine = noSep(p.CommandLine)
		p.Image = noSep(p.Image)
		for alg, digest := range p.Hashes {
			p.Hashes[alg] = noSep(digest)
		}
	}
	if ev.Access != nil {
		ev.Access.GrantedAccess = noSep(ev.Access.GrantedAccess)
		ev.Access.CallTrace = noSep(ev.Access.CallTrace)
	}
	if ev.File != nil {
		ev.File.Path = noSep(ev.File.Path)
		ev.File.Extension = noSep(ev.File.Extension)
		for alg, digest := range ev.File.Hashes {
			ev.File.Hashes[alg] = noSep(digest)
		}
	}
	if ev.Network != nil {
		ev.Network.Protocol = noSep(ev.Network.Protocol)
		ev.Network.SourceIP = noSep(ev.Network.SourceIP)
		ev.Network.DestinationIP = noSep(ev.Network.DestinationIP)
		ev.Network.Domain = noSep(ev.Network.Domain)
	}
	if ev.Registry != nil {
		ev.Registry.Key = noSep(ev.Registry.Key)
		ev.Registry.ValueName = noSep(ev.Registry.ValueName)
		ev.Registry.Value = noSep(ev.Registry.Value)
		ev.Registry.Operation = noSep(ev.Registry.Operation)
	}
	for i, t := range ev.Tags {
		ev.Tags[i] = noSep(t)
	}
}

func noSep(s string) string { return strings.ReplaceAll(s, fieldSep, "") }

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}
