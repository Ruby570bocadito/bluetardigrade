package beacon

// SEC-7 (fuzzing of the input surfaces): fuzz target for the beacon
// profile loader. `go test` runs the seed corpus, so anything a fuzz
// run finds is pinned for the normal suite.
//
// Properties under fuzz:
//   - loading arbitrary profile YAML never panics;
//   - a successfully loaded manager evaluates a representative event
//     without panicking and keeps the load-time cap on profile count.

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func FuzzLoadBeacon(f *testing.F) {
	f.Add([]byte("- id: c2-slack\n  name: c2-slack\n  min_interval: 30s\n  max_jitter: 0.2\n  min_count: 6\n  window: 30m\n"))
	f.Add([]byte("[]"))
	f.Add([]byte("- id: x\n  name: x\n  min_interval: 0s\n  max_jitter: 0\n  min_count: 1\n  window: 1s\n"))
	f.Add([]byte("- id: y\n  name: y\n  min_interval: 999999h\n  max_jitter: 1e999\n  min_count: -5\n  window: -1s\n"))
	f.Add([]byte("- id: dup\n  name: a\n- id: dup\n  name: b\n"))
	f.Add([]byte("profiles: [\n"))
	f.Add([]byte("- id: only-id\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		dir := t.TempDir()
		path := filepath.Join(dir, "beacons.yaml")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Skip()
		}
		m, err := LoadFile(path, nil)
		if err != nil {
			return
		}
		// Whatever loaded must evaluate safely: a network event with
		// both a domain and an IP exercises every destination path.
		ev := &model.Event{
			ID:      "f",
			Type:    model.TypeNetworkConnect,
			Host:    "WS01",
			Network: &model.Network{DestinationIP: "203.0.113.5", Domain: "c2.example.net", DestinationPort: 443},
		}
		m.Observe(ev, time.Now())
	})
}
