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
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

const (
	maxLineSize = 1 << 20 // 1 MiB per event line
	idleTimeout = 5 * time.Minute
	ackOK       = `{"ack":"ok"}` + "\n"
)

// authTimeout bounds how long the server waits for the AUTH line.
// Var (not const) so tests can shorten it.
var authTimeout = 10 * time.Second

// Server is a concurrent NDJSON-over-TCP listener.
type Server struct {
	addr      string
	events    chan<- *model.Event
	listener  net.Listener
	conns     sync.WaitGroup
	mu        sync.Mutex
	closing   bool
	open      map[net.Conn]struct{}
	token     string // empty = auth disabled (loopback deployments)
	prevToken string // still accepted during a rotation window

	received atomic.Uint64
	dropped  atomic.Uint64
	rejected atomic.Uint64
}

// New creates a server bound to addr, pushing parsed events into the
// provided channel.
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

// Rejected returns the number of connections closed for failing the
// AUTH handshake (wrong token, missing token, or timeout).
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
		s.conns.Add(1)
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

func (s *Server) handle(conn net.Conn) {
	defer s.conns.Done()

	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		conn.Close()
		return
	}
	s.open[conn] = struct{}{}
	s.mu.Unlock()
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
		conn.SetReadDeadline(time.Now().Add(authTimeout))
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
	if err := ev.Validate(); err != nil {
		return nil, err
	}
	return ev, nil
}
