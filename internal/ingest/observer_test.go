package ingest

import (
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

type recordingObserver struct {
	mu    sync.Mutex
	seen  []string
	peers []string
}

func (o *recordingObserver) Observe(ev *model.Event, peer string, _ time.Time) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.seen = append(o.seen, ev.Type)
	o.peers = append(o.peers, peer)
}

func (o *recordingObserver) snapshot() ([]string, []string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]string{}, o.seen...), append([]string{}, o.peers...)
}

// Heartbeats reach the inventory observer and never the pipeline; every
// other accepted event reaches both, with the sensor's address.
func TestHeartbeatsAreObservedButNotForwarded(t *testing.T) {
	srv, events, addr := startTestServer(t, "")
	obs := &recordingObserver{}
	srv.SetObserver(obs)
	hb := `{"id":"hb-1","type":"sensor.heartbeat","source":"etw","host":"PC-01","attributes":{"interval_s":"60"}}`
	dialAndSend(t, addr, hb, sampleEvent(t))

	select {
	case ev := <-events:
		if ev.Type == HeartbeatType {
			t.Fatal("a heartbeat was forwarded to the pipeline")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the regular event never arrived")
	}
	select {
	case ev := <-events:
		t.Fatalf("unexpected extra event %q", ev.Type)
	case <-time.After(150 * time.Millisecond):
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		seen, peers := obs.snapshot()
		if len(seen) == 2 {
			if seen[0] != HeartbeatType || seen[1] != model.TypeProcessCreate {
				t.Fatalf("observed %v", seen)
			}
			if peers[0] != "127.0.0.1" || peers[1] != "127.0.0.1" {
				t.Fatalf("peers %v", peers)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("observer saw %v", seen)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if srv.Heartbeats() != 1 || srv.Received() != 1 {
		t.Fatalf("counters: heartbeats=%d received=%d", srv.Heartbeats(), srv.Received())
	}
}

// Without an observer heartbeats are still consumed, not forwarded.
func TestHeartbeatsWithoutObserverAreDropped(t *testing.T) {
	srv, events, addr := startTestServer(t, "")
	dialAndSend(t, addr, `{"id":"hb-2","type":"sensor.heartbeat","host":"PC-02"}`)
	select {
	case ev := <-events:
		t.Fatalf("heartbeat forwarded: %+v", ev)
	case <-time.After(300 * time.Millisecond):
	}
	if srv.Heartbeats() != 1 {
		t.Fatalf("heartbeats=%d", srv.Heartbeats())
	}
	srv.SetObserver(nil) // removing the observer is safe
}
