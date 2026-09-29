// Package ingest accepts NDJSON event streams from sensors over TCP.
// One JSON object per newline-terminated line; oversized lines are
// rejected to protect the engine's memory.
package ingest

import (
	"bufio"
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
)

// Server is a concurrent NDJSON-over-TCP listener.
type Server struct {
	addr     string
	events   chan<- *model.Event
	listener net.Listener
	conns    sync.WaitGroup
	mu       sync.Mutex
	closing  bool

	received atomic.Uint64
	dropped  atomic.Uint64
}

// New creates a server bound to addr, pushing parsed events into the
// provided channel.
func New(addr string, events chan<- *model.Event) (*Server, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("ingest: listen %s: %w", addr, err)
	}
	return &Server{addr: addr, events: events, listener: ln}, nil
}

// Addr returns the bound address (useful when listening on :0).
func (s *Server) Addr() string { return s.listener.Addr().String() }

// Received returns the number of valid events ingested.
func (s *Server) Received() uint64 { return s.received.Load() }

// Dropped returns the number of malformed lines rejected.
func (s *Server) Dropped() uint64 { return s.dropped.Load() }

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

// Shutdown stops the accept loop and waits for in-flight connections.
func (s *Server) Shutdown() {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return
	}
	s.closing = true
	s.mu.Unlock()
	_ = s.listener.Close()
	s.conns.Wait()
}

func (s *Server) handle(conn net.Conn) {
	defer s.conns.Done()
	defer conn.Close()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineSize)

	deadline := time.Now().Add(idleTimeout)
	conn.SetReadDeadline(deadline)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
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
