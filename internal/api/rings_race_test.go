package api

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// Regression (04-A, ronda 2026-10-01): handleEvents and handleAlerts
// read the h.events / h.alerts rings WITHOUT h.mu while
// RecordEvent / RecordAlert append and trim under it from the engine
// loop goroutine — a data race on the slice header on two endpoints
// the console polls continuously. The exports (export.go) already
// snapshotted under the lock; these two handlers now do the same.
//
// The test records events/alerts in a tight loop (well past the
// 1000/256 ring sizes, so the trim path runs) while a reader hammers
// both endpoints; under -race the unfixed code fails within
// milliseconds (reproduced: go test -race -run TestTelemetryReads).
func TestTelemetryReadsAreRaceFreeUnderConcurrentWrites(t *testing.T) {
	h, addr := newTestHub(t)

	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			h.RecordEvent(sampleEvent(fmt.Sprintf("ev-%d", i)))
			h.RecordAlert(alert.Alert{
				ID:        fmt.Sprintf("%016x", i&0xffffffff),
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				Severity:  "high",
				RuleID:    "race.test",
				RuleName:  "race test",
				Host:      "LAB-TEST",
				EventType: model.TypeProcessCreate,
				Summary:   "race regression probe",
			})
		}
	}()

	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			for _, path := range []string{"/api/events?limit=200", "/api/alerts?limit=200"} {
				res, err := http.Get("http://" + addr + path)
				if err == nil {
					res.Body.Close()
				}
			}
		}
	}()

	time.Sleep(750 * time.Millisecond)
	close(stop)
	wg.Wait()
}
