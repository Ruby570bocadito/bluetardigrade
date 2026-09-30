package ingest

// Regression tests for the Serve/Shutdown registration contract: a
// connection may join the conns WaitGroup only while closing is still
// false, observed under mu — the invariant that makes Shutdown's
// conns.Wait() sound. The fixed class: a conn accepted in the window
// between Shutdown flipping closing and the accept loop noticing used
// to be Added to the WaitGroup with the counter at (or heading to)
// zero while Wait ran — a sync.WaitGroup contract violation that -race
// reported as the flaky ingest warning (informe 03-A 21h59 §8.1,
// assigned to carril 04).

import (
	"net"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

const stageTimeout = 5 * time.Second

// stagedListener is a net.Listener scripted for the adversarial
// choreography: conns are handed to Accept through a channel the test
// controls, Close signals its entry and can park before returning, and
// an exhausted handoff makes Accept report the closed listener.
type stagedListener struct {
	handoff      chan net.Conn // conns to hand out; closed = listener retired
	closeEntered chan struct{} // closed the moment Close is called
	closeRelease chan struct{} // when non-nil, Close parks until closed
}

func newStagedListener() *stagedListener {
	return &stagedListener{
		handoff:      make(chan net.Conn, 8),
		closeEntered: make(chan struct{}),
	}
}

func (l *stagedListener) Accept() (net.Conn, error) {
	conn, ok := <-l.handoff
	if !ok {
		return nil, net.ErrClosed
	}
	return conn, nil
}

func (l *stagedListener) Close() error {
	close(l.closeEntered)
	if l.closeRelease != nil {
		<-l.closeRelease
	}
	return nil
}

func (l *stagedListener) Addr() net.Addr { return stageAddr{} }

type stageAddr struct{}

func (stageAddr) Network() string { return "tcp" }
func (stageAddr) String() string  { return "staged-listener" }

// probeConn fires one-shot hooks on a connection's first
// SetReadDeadline (handle always sets one before its read loop, so it
// proves the handler is registered and running) and first Close (with
// the caller's stack, so the test can tell which goroutine closed the
// connection).
type probeConn struct {
	net.Conn
	onDeadline   func()
	onClose      func(callerStack string)
	deadlineOnce sync.Once
	closeOnce    sync.Once
}

func (c *probeConn) SetReadDeadline(t time.Time) error {
	if c.onDeadline != nil {
		c.deadlineOnce.Do(c.onDeadline)
	}
	return c.Conn.SetReadDeadline(t)
}

func (c *probeConn) Close() error {
	if c.onClose != nil {
		buf := make([]byte, 8192)
		stack := string(buf[:runtime.Stack(buf, false)])
		c.closeOnce.Do(func() { c.onClose(stack) })
	}
	return c.Conn.Close()
}

// TestShutdownRejectsInFlightAcceptedConn pins the invariant
// deterministically: a conn handed to the accept loop while Shutdown is
// already parked inside listener.Close must be rejected by the closing
// guard, never handed a handler goroutine. Against the pre-fix code it
// fails with a stack showing ingest.(*Server).handle closing the conn —
// the handler spawned by the unguarded conns.Add.
func TestShutdownRejectsInFlightAcceptedConn(t *testing.T) {
	events := make(chan *model.Event, 4)
	ln := newStagedListener()
	ln.closeRelease = make(chan struct{})

	conn1, peer1 := net.Pipe()
	conn2, peer2 := net.Pipe()
	defer peer1.Close()
	defer peer2.Close()

	handlerAlive := make(chan struct{})
	conn1Closed := make(chan struct{})
	var conn2CloseStack string
	conn2Closed := make(chan struct{})

	p1 := &probeConn{Conn: conn1,
		onDeadline: func() { close(handlerAlive) },
		onClose:    func(string) { close(conn1Closed) },
	}
	p2 := &probeConn{Conn: conn2,
		onClose: func(stack string) {
			conn2CloseStack = stack
			close(conn2Closed)
		},
	}

	// conn1 goes through the normal path; conn2 stays withheld — the
	// in-flight conn of the race window.
	ln.handoff <- p1

	srv := &Server{events: events, listener: ln, open: make(map[net.Conn]struct{})}
	serveDone := make(chan struct{})
	go func() {
		srv.Serve()
		close(serveDone)
	}()

	select {
	case <-handlerAlive:
	case <-time.After(stageTimeout):
		t.Fatal("handler for conn1 never started")
	}

	shutdownDone := make(chan struct{})
	go func() {
		srv.Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-ln.closeEntered:
	case <-time.After(stageTimeout):
		t.Fatal("Shutdown never reached listener.Close")
	}

	// The race window: closing is already set, the accept loop gets one
	// more conn. The registration contract says: no handler for it.
	ln.handoff <- p2

	select {
	case <-conn2Closed:
	case <-time.After(stageTimeout):
		t.Fatal("conn2 was never closed")
	}

	close(ln.closeRelease) // let Shutdown: Close returns -> Wait -> close(events)
	select {
	case <-shutdownDone:
	case <-time.After(stageTimeout):
		t.Fatal("Shutdown did not return")
	}

	close(ln.handoff) // retire the accept loop
	select {
	case <-serveDone:
	case <-time.After(stageTimeout):
		t.Fatal("Serve did not return")
	}

	if st := conn2CloseStack; strings.Contains(st, "ingest.(*Server).handle") {
		t.Errorf("handler goroutine spawned for a conn accepted after Shutdown began (conns.Add outside the closing guard):\n%s", st)
	}

	select {
	case <-conn1Closed:
	default:
		t.Error("Shutdown must close open connections (conn1 was never closed)")
	}

	for range events { // closed by Shutdown; conn2 produced nothing
	}
}

// TestShutdownInFlightConnStress replays the adversarial window many
// times as a -race canary: the Add-vs-Wait overlap the deterministic
// sibling pins by construction is a couple of instructions wide, so
// only the detector can catch it live. Probabilistic by design on the
// pre-fix code; on the fixed code the registration guard makes every
// iteration clean by construction.
func TestShutdownInFlightConnStress(t *testing.T) {
	for i := 0; i < 200; i++ {
		events := make(chan *model.Event, 4)
		ln := newStagedListener()
		ln.closeRelease = make(chan struct{})

		conn1, peer1 := net.Pipe()
		conn2, peer2 := net.Pipe()
		srv := &Server{events: events, listener: ln, open: make(map[net.Conn]struct{})}
		ln.handoff <- conn1

		serveDone := make(chan struct{})
		go func() {
			srv.Serve()
			close(serveDone)
		}()

		shutdownDone := make(chan struct{})
		go func() {
			srv.Shutdown()
			close(shutdownDone)
		}()

		if i%2 == 0 {
			<-ln.closeEntered // conn lands inside Shutdown's window
			ln.handoff <- conn2
			close(ln.closeRelease)
		} else {
			ln.handoff <- conn2 // benign: both conns land before closing
			close(ln.closeRelease)
		}

		select {
		case <-shutdownDone:
		case <-time.After(stageTimeout):
			peer1.Close()
			peer2.Close()
			t.Fatalf("iteration %d: Shutdown did not return", i)
		}

		close(ln.handoff) // retire the accept loop
		select {
		case <-serveDone:
		case <-time.After(stageTimeout):
			t.Fatalf("iteration %d: Serve did not return", i)
		}

		peer1.Close() // backstop; handle already closed its side
		peer2.Close()
		for range events { // closed by Shutdown, must drain empty
		}
	}
}
