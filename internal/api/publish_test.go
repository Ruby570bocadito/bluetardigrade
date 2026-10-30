package api

import (
	"sync/atomic"
	"testing"
)

// countingPayload records how many times broadcast marshals it.
type countingPayload struct{ calls *atomic.Int32 }

func (p countingPayload) MarshalJSON() ([]byte, error) {
	p.calls.Add(1)
	return []byte(`{}`), nil
}

// With no console subscribed, broadcast skips the marshal it used to pay
// for every ingested event; with a subscriber it marshals once.
func TestBroadcastMarshalsOnlyForSubscribers(t *testing.T) {
	h, _ := newTestHub(t)
	var calls atomic.Int32
	h.broadcast("event", countingPayload{&calls})
	if n := calls.Load(); n != 0 {
		t.Fatalf("marshalled %d times with no subscriber", n)
	}
	ch := make(chan frame, 1)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	h.broadcast("event", countingPayload{&calls})
	if n := calls.Load(); n != 1 {
		t.Fatalf("marshalled %d times with one subscriber, want 1", n)
	}
	if f := <-ch; len(f.msg) == 0 {
		t.Fatal("the subscriber got an empty frame")
	}
}
