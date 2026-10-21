package api

import (
	"fmt"
	"log"
	"sync/atomic"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// persistEvent writes one event to the store if attached.
func (h *Hub) persistEvent(ev *model.Event) { h.PersistEvents([]*model.Event{ev}) }

// PersistEvents writes a batch of events to the store (one SQLite
// transaction) when one is attached. Failures are logged with a
// throttle (first, then every 500th) so a full disk does not flood the
// log while detection keeps running; id conflicts are not failures —
// the first copy is safe on disk — and are logged on their own
// throttle. The engine loop calls it once per drained batch, BEFORE
// PublishEvent fans each event out: durable evidence first, live
// delivery second.
func (h *Hub) PersistEvents(evs []*model.Event) {
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	if st == nil || len(evs) == 0 {
		return
	}
	res := st.InsertEvents(evs)
	for _, err := range res.Failed {
		n := atomic.AddUint64(&h.storeFails, 1)
		if n == 1 || n%500 == 0 {
			log.Printf("[API] store write FAILED (%d total): %v", n, err)
		}
	}
	if len(res.Conflicts) > 0 {
		total := st.IDConflicts()
		prev := total - int64(len(res.Conflicts))
		// log when the running total crosses 1 or a multiple of 500
		if prev == 0 || prev/500 != total/500 {
			log.Printf("[API] event id conflict, stored evidence kept (%d total, last id %s)", total, oneLine(res.Conflicts[len(res.Conflicts)-1]))
		}
	}
}

// persistAlert is persistEvent for alerts.
func (h *Hub) persistAlert(a alert.Alert) {
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	if st == nil {
		return
	}
	if err := st.InsertAlert(a); err != nil {
		n := atomic.AddUint64(&h.storeFails, 1)
		if n == 1 || n%500 == 0 {
			log.Printf("[API] store write FAILED (%d total): %v", n, err)
		}
	}
}

// mustMemoryLifecycle gives every hub a working default store so the
// POST endpoint never dereferences nil. lifecycle.New("") cannot fail
// (no file to read); the panic guard is for future refactors only.
func mustMemoryLifecycle() *lifecycle.Store {
	s, err := lifecycle.New("")
	if err != nil {
		panic(fmt.Sprintf("api: memory lifecycle store: %v", err))
	}
	return s
}
