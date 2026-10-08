// Package forensic is the engine's flight recorder and evidence
// capture layer. Two cooperating halves:
//
//   - a per-host ring of the most recent raw events (the flight
//     recorder), maintained continuously by the event loop;
//   - evidence bundles written when a high-signal alert fires: the
//     alert itself plus the host's event timeline that preceded it,
//     frozen to disk at the moment of detection.
//
// The design goal is answerability: when an operator (or the AI
// analyst) asks "what was happening on this host when it alerted",
// the answer must not depend on SQLite being enabled, on the ring
// not having rotated, or on the alert still being live. Bundles are
// written atomically, bounded on disk (LRU eviction), and readable
// back through the API for the lifetime of the retention window.
//
// Every bound in this file is a deliberate worst-case cap: memory is
// bounded by maxHosts x maxEventsPerHost pointers; disk by
// maxBundleFiles x the serialized size of timelineCap events.
package forensic

import (
        "encoding/json"
        "errors"
        "fmt"
        "os"
        "path/filepath"
        "strings"
        "sync"
        "time"

        "github.com/Ruby570bocadito/bluetardigrade/internal/alert"
        "github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Recorder is the flight recorder plus bundle writer. The zero value
// is not usable: construct with New.
type Recorder struct {
        mu    sync.Mutex
        dir   string // bundle output directory; "" disables disk writes
        hosts map[string][]*model.Event
        order []string // LRU order of hosts, order[0] = coldest
}

// Bounds and constants. See the package comment: each one caps a
// specific worst case, and the numbers trade evidence depth against
// footprint on a long-lived engine.
const (
        maxHosts         = 64
        maxEventsPerHost = 256

        // CaptureWindow is how far back the timeline of a bundle reaches
        // from the alert timestamp.
        CaptureWindow = 5 * time.Minute

        // timelineCap bounds the events serialized into one bundle: a
        // saturated host under attack produces more than this inside the
        // window, and the tail (closest to the alert) is the part an
        // investigator reads first.
        timelineCap = 200

        // maxBundleFiles bounds the bundle directory: oldest files are
        // evicted after a write crosses the cap.
        maxBundleFiles = 256

        // alertIDLen is the addressability contract of NewID (16 hex).
        alertIDLen = 16
)

// Bundle is the on-disk and on-the-wire evidence document.
type Bundle struct {
        Alert      alert.Alert    `json:"alert"`
        CapturedAt string         `json:"captured_at"`
        Host       string         `json:"host"`
        Window     string         `json:"window"`
        Timeline   []*model.Event `json:"timeline"`
        Summary    Summary        `json:"summary"`
}

// Summary is the counted shape of the timeline: what an operator
// scans before reading a single event.
type Summary struct {
        Events          int      `json:"events"`
        ProcessCreates  int      `json:"process_creates"`
        NetworkConnects int      `json:"network_connects"`
        FileWrites      int      `json:"file_writes"`
        RegistrySets    int      `json:"registry_sets"`
        ProcessAccesses int      `json:"process_accesses"`
        Other           int      `json:"other"`
        DistinctUsers   int      `json:"distinct_users"`
        DistinctImages  []string `json:"distinct_images"`
}

// ErrDisabled is returned by Load when the recorder has no directory
// configured. The API surfaces it as a distinct "feature off" state
// instead of a misleading 404.
var ErrDisabled = errors.New("forensic capture disabled: start the engine without -forensic=false and see -forensic-dir")

// ErrNotFound is returned by Load when no bundle exists for the id.
var ErrNotFound = errors.New("no forensic bundle for this alert id (severity below capture threshold, evicted by retention, or engine restarted before capture)")

// New returns a Recorder writing bundles under dir. An empty dir
// keeps the flight recorder in memory only (Load answers ErrDisabled).
func New(dir string) *Recorder {
        return &Recorder{dir: dir, hosts: make(map[string][]*model.Event)}
}

// Dir reports the bundle directory ("" when disk capture is off).
func (r *Recorder) Dir() string { return r.dir }

// ObserveEvent feeds the flight recorder. It runs on the hot ingest
// path: no allocation beyond the slice append, no I/O, no clock read.
func (r *Recorder) ObserveEvent(ev *model.Event) {
        if ev == nil || ev.Host == "" {
                return
        }
        r.mu.Lock()
        defer r.mu.Unlock()
        r.hosts[ev.Host] = append(r.hosts[ev.Host], ev)
        if len(r.hosts[ev.Host]) > maxEventsPerHost {
                r.hosts[ev.Host] = r.hosts[ev.Host][len(r.hosts[ev.Host])-maxEventsPerHost:]
        }
        r.touchHost(ev.Host)
}

// touchHost moves host to the MRU end of the eviction order. Called
// with the lock held.
func (r *Recorder) touchHost(host string) {
        for i, h := range r.order {
                if h == host {
                        if i == len(r.order)-1 {
                                return
                        }
                        copy(r.order[i:], r.order[i+1:])
                        r.order[len(r.order)-1] = host
                        return
                }
        }
        r.order = append(r.order, host)
        if len(r.order) > maxHosts {
                delete(r.hosts, r.order[0])
                r.order = r.order[1:]
        }
}

// captureSeverity reports whether an alert freezes evidence. Every
// high/critical rule hit and every correlation campaign qualifies.
func captureSeverity(sev string) bool {
        switch sev {
        case "critical", "high":
                return true
        }
        return false
}

// Capture freezes the evidence bundle for an alert when its severity
// qualifies. It returns (path, true, nil) when a bundle was written
// and ("", false, nil) when the alert did not qualify or capture is
// off. A write failure is returned as an error — the caller logs it
// loudly, but detection never fails because of it.
func (r *Recorder) Capture(a alert.Alert, now time.Time) (string, bool, error) {
        if r == nil || r.dir == "" || !captureSeverity(a.Severity) {
                return "", false, nil
        }
        if len(a.ID) != alertIDLen || !isHex(a.ID) {
                // Alerts without a well-formed id cannot be addressed back
                // through the API: refuse to write an unreachable bundle.
                return "", false, fmt.Errorf("forensic: alert id %q is not addressable, bundle skipped", a.ID)
        }

        alerted, err := time.Parse(time.RFC3339, a.Timestamp)
        if err != nil {
                alerted = now // malformed timestamps degrade to "now", not to silence
        }

        b := &Bundle{
                Alert:      a,
                CapturedAt: now.UTC().Format(time.RFC3339Nano),
                Host:       a.Host,
                Window:     CaptureWindow.String() + " before alert (plus the triggering event)",
                Timeline:   make([]*model.Event, 0),
        }

        r.mu.Lock()
        cutoff := alerted.Add(-CaptureWindow)
        ring := r.hosts[a.Host]
        for _, ev := range ring {
                if (!ev.Timestamp.Before(cutoff) && !ev.Timestamp.After(alerted)) || ev.ID == a.EventID {
                        b.Timeline = append(b.Timeline, ev)
                }
        }
        r.mu.Unlock()

        // Keep the tail: the events closest to the alert are the ones an
        // investigator reads; the head of the window is context.
        if len(b.Timeline) > timelineCap {
                start := len(b.Timeline) - timelineCap
                var trigger *model.Event
                for _, ev := range b.Timeline[:start] {
                        if ev.ID == a.EventID {
                                trigger = ev
                                break
                        }
                }
                if trigger != nil {
                        // Preserve the trigger when it predates the retained tail.
                        b.Timeline = append([]*model.Event{trigger}, b.Timeline[start+1:]...)
                } else {
                        b.Timeline = b.Timeline[start:]
                }
        }
        b.Summary = summarize(b.Timeline)

        path := filepath.Join(r.dir, a.ID+".json")
        if err := writeAtomic(path, b); err != nil {
                return "", false, err
        }
        r.evictOldFiles()
        return path, true, nil
}

// summarize counts the shape of the timeline in one pass.
func summarize(timeline []*model.Event) Summary {
        s := Summary{Events: len(timeline)}
        users := map[string]struct{}{}
        images := map[string]struct{}{}
        imageList := []string{}
        for _, ev := range timeline {
                switch ev.Type {
                case model.TypeProcessCreate:
                        s.ProcessCreates++
                case model.TypeNetworkConnect:
                        s.NetworkConnects++
                case model.TypeFileWrite:
                        s.FileWrites++
                case model.TypeRegistrySet:
                        s.RegistrySets++
                case model.TypeProcessAccess:
                        s.ProcessAccesses++
                default:
                        s.Other++
                }
                if ev.User != "" {
                        users[ev.User] = struct{}{}
                }
                if ev.Process != nil && ev.Process.Image != "" {
                        if _, ok := images[ev.Process.Image]; !ok {
                                images[ev.Process.Image] = struct{}{}
                                imageList = append(imageList, ev.Process.Image)
                        }
                }
        }
        s.DistinctUsers = len(users)
        s.DistinctImages = imageList
        return s
}

// writeAtomic serializes the bundle to a temp file in the target
// directory and renames it into place: a reader either sees the
// complete bundle or nothing, never a partial JSON document.
func writeAtomic(path string, b *Bundle) error {
        if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
                return fmt.Errorf("forensic: bundle dir: %w", err)
        }
        data, err := json.MarshalIndent(b, "", "  ")
        if err != nil {
                return fmt.Errorf("forensic: bundle encode: %w", err)
        }
        tmp, err := os.CreateTemp(filepath.Dir(path), ".bundle-*")
        if err != nil {
                return fmt.Errorf("forensic: temp file: %w", err)
        }
        name := tmp.Name()
        if _, err := tmp.Write(data); err != nil {
                tmp.Close()
                os.Remove(name)
                return fmt.Errorf("forensic: temp write: %w", err)
        }
        // fsync before the rename: without it a power cut can persist the
        // rename while the data blocks are still in flight, leaving a
        // truncated evidence bundle on disk.
        if err := tmp.Sync(); err != nil {
                tmp.Close()
                os.Remove(name)
                return fmt.Errorf("forensic: temp sync: %w", err)
        }
        if err := tmp.Close(); err != nil {
                os.Remove(name)
                return fmt.Errorf("forensic: temp close: %w", err)
        }
        if err := os.Rename(name, path); err != nil {
                os.Remove(name)
                return fmt.Errorf("forensic: rename into place: %w", err)
        }
        return nil
}

// evictOldFiles enforces maxBundleFiles by removing the oldest
// bundles (mtime order). Called after each successful write; it is
// best-effort by design — a failed unlink retries on the next write.
func (r *Recorder) evictOldFiles() {
        entries, err := os.ReadDir(r.dir)
        if err != nil || len(entries) <= maxBundleFiles {
                return
        }
        type aged struct {
                path string
                at   time.Time
        }
        files := make([]aged, 0, len(entries))
        for _, e := range entries {
                if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
                        continue
                }
                info, err := e.Info()
                if err != nil {
                        continue
                }
                files = append(files, aged{filepath.Join(r.dir, e.Name()), info.ModTime()})
        }
        excess := len(files) - maxBundleFiles
        if excess <= 0 {
                return
        }
        // insertion sort by mtime: excess is a handful per write in practice
        for i := 1; i < len(files); i++ {
                for j := i; j > 0 && files[j].at.Before(files[j-1].at); j-- {
                        files[j], files[j-1] = files[j-1], files[j]
                }
        }
        for i := 0; i < excess && i < len(files); i++ {
                _ = os.Remove(files[i].path)
        }
}

// Load reads a bundle back by alert id. The id is validated before it
// touches the filesystem: bundle names are exactly the 16-hex alert
// id, so anything else is a client error, not a missing file.
func (r *Recorder) Load(alertID string) (*Bundle, error) {
        if r == nil || r.dir == "" {
                return nil, ErrDisabled
        }
        if len(alertID) != alertIDLen || !isHex(alertID) {
                return nil, fmt.Errorf("malformed alert id %q: want 16 lowercase hex characters", alertID)
        }
        data, err := os.ReadFile(filepath.Join(r.dir, alertID+".json"))
        if err != nil {
                if errors.Is(err, os.ErrNotExist) {
                        return nil, ErrNotFound
                }
                return nil, fmt.Errorf("forensic: bundle read: %w", err)
        }
        var b Bundle
        if err := json.Unmarshal(data, &b); err != nil {
                return nil, fmt.Errorf("forensic: bundle decode (corrupt or foreign file): %w", err)
        }
        return &b, nil
}

// isHex accepts only lowercase hex: bundle filenames are generated by
// the engine from alert.NewID (lowercase hex) and Load must not be a
// path-traversal oracle for mixed-case or dotted ids.
func isHex(s string) bool {
        for _, c := range s {
                switch {
                case c >= '0' && c <= '9':
                case c >= 'a' && c <= 'f':
                default:
                        return false
                }
        }
        return true
}

// CountBundles reports how many bundles the directory holds. It
// exists for tests and for the /api/stats gauge.
func (r *Recorder) CountBundles() int {
        if r == nil || r.dir == "" {
                return 0
        }
        entries, err := os.ReadDir(r.dir)
        if err != nil {
                return 0
        }
        n := 0
        for _, e := range entries {
                if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
                        n++
                }
        }
        return n
}

// TrackedEvents reports the flight-recorder size (all hosts). It
// exists for tests and observability.
func (r *Recorder) TrackedEvents() int {
        r.mu.Lock()
        defer r.mu.Unlock()
        n := 0
        for _, ring := range r.hosts {
                n += len(ring)
        }
        return n
}
