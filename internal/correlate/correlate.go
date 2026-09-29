// Package correlate assembles individual rule hits into multi-stage
// kill-chain alerts. A sequence (YAML in sequences/) names the rules
// that together describe one campaign; when every step has been seen
// on the same host inside the window, a single high-signal alert is
// emitted through the alert.Manager pipeline. Steps are unordered and
// the manager survives rule hot-reloads without losing progress.
package correlate

import (
        "fmt"
        "os"
        "path/filepath"
        "strings"
        "sync"
        "time"

        "github.com/Ruby570bocadito/security-framework/internal/alert"
        "github.com/Ruby570bocadito/security-framework/internal/rules"
        "github.com/Ruby570bocadito/security-framework/pkg/model"

        "gopkg.in/yaml.v3"
)

// Step references one contributing rule by its exact name.
type Step struct {
        Rule string `yaml:"rule"`
}

// Sequence is the YAML definition of one kill chain.
type Sequence struct {
        Name        string   `yaml:"name"`
        ID          string   `yaml:"id"`
        Description string   `yaml:"description"`
        Severity    string   `yaml:"severity"`
        Window      string   `yaml:"window"`
        Tags        []string `yaml:"tags"`
        Steps       []Step   `yaml:"steps"`
}

type compiled struct {
        seq    Sequence
        window time.Duration
}

type state struct {
        matched map[int]bool
        first   time.Time
        lastEv  *model.Event
}

// Manager tracks per-host progress of every sequence.
type Manager struct {
        mu    sync.Mutex
        seqs  []*compiled
        state map[string]*state // key: sequence id | host
        emit  func(alert.Alert)
}

// LoadDir compiles every sequence file under dir. emit is called once
// per completed sequence (wire it to alert.Manager.Emit).
func LoadDir(dir string, emit func(alert.Alert)) (*Manager, error) {
        m := &Manager{state: map[string]*state{}, emit: emit}
        if err := m.load(dir); err != nil {
                return nil, err
        }
        return m, nil
}

// Reload atomically swaps the sequence set, preserving in-flight
// progress (rules hot-reload every 15s and sequences must be able to
// span several of those cycles).
func (m *Manager) Reload(dir string) error {
        fresh := &Manager{state: m.state, emit: m.emit}
        if err := fresh.load(dir); err != nil {
                return err
        }
        m.mu.Lock()
        defer m.mu.Unlock()
        m.seqs = fresh.seqs
        return nil
}

// Count returns the number of loaded sequences.
func (m *Manager) Count() int {
        m.mu.Lock()
        defer m.mu.Unlock()
        return len(m.seqs)
}

// SetEmit wires (or rewires) the completion callback, so main can
// validate the sequences directory before the alert manager exists.
func (m *Manager) SetEmit(emit func(alert.Alert)) {
        m.mu.Lock()
        defer m.mu.Unlock()
        m.emit = emit
}

// Names returns the loaded sequence names, sorted, for logging.
func (m *Manager) Names() []string {
        m.mu.Lock()
        defer m.mu.Unlock()
        out := make([]string, 0, len(m.seqs))
        for _, c := range m.seqs {
                out = append(out, c.seq.Name)
        }
        return out
}

// Observe feeds one rule hit into every sequence that references it.
// Completing a sequence emits one alert and re-arms the chain.
func (m *Manager) Observe(ev *model.Event, ruleName string) {
        if ev == nil || ruleName == "" {
                return
        }
        m.mu.Lock()
        defer m.mu.Unlock()
        for _, c := range m.seqs {
                stepIdx := -1
                st := m.state[c.seq.ID+"|"+ev.Host]
                if st == nil {
                        st = &state{matched: map[int]bool{}, first: time.Time{}}
                }
                // window expiry: progress older than the window from the first
                // match cannot complete; restart the chain from this hit
                if len(st.matched) > 0 && ev.Timestamp.Sub(st.first) > c.window {
                        st = &state{matched: map[int]bool{}, first: time.Time{}}
                }
                for i, s := range c.seq.Steps {
                        if !st.matched[i] && s.Rule == ruleName {
                                stepIdx = i
                                break
                        }
                }
                if stepIdx < 0 {
                        continue
                }
                if len(st.matched) == 0 {
                        if ev.Timestamp.IsZero() {
                                st.first = time.Now()
                        } else {
                                st.first = ev.Timestamp
                        }
                }
                st.matched[stepIdx] = true
                st.lastEv = ev
                if len(st.matched) == len(c.seq.Steps) {
                        m.fire(c, st, ev)
                        delete(m.state, c.seq.ID+"|"+ev.Host) // re-arm
                        continue
                }
                m.state[c.seq.ID+"|"+ev.Host] = st
        }
}

// fire emits the sequence alert for a completed chain. Caller holds mu.
func (m *Manager) fire(c *compiled, st *state, ev *model.Event) {
        steps := make([]string, 0, len(c.seq.Steps))
        for _, s := range c.seq.Steps {
                steps = append(steps, s.Rule)
        }
        span := st.lastEv.Timestamp.Sub(st.first).Round(time.Second)
        if span < 0 {
                span = 0
        }
        a := alert.Alert{
                Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
                RuleID:    c.seq.ID,
                RuleName:  c.seq.Name,
                Severity:  c.seq.Severity,
                Host:      ev.Host,
                User:      ev.User,
                EventID:   ev.ID,
                EventType: ev.Type,
                Summary: fmt.Sprintf("%s en %d pasos: %s",
                        strings.Join(steps, " -> "), len(steps), span),
                MatchedOn: steps,
                Tags:      c.seq.Tags,
                Enrich:    ev.Enrichment,
        }
        if m.emit != nil {
                m.emit(a)
        }
}

// load parses every .yaml/.yml file under dir into compiled sequences.
func (m *Manager) load(dir string) error {
        seqs := []*compiled{}
        err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
                if err != nil {
                        return err
                }
                if info.IsDir() {
                        return nil
                }
                ext := strings.ToLower(filepath.Ext(path))
                if ext != ".yaml" && ext != ".yml" {
                        return nil
                }
                data, err := os.ReadFile(path)
                if err != nil {
                        return err
                }
                var list []Sequence
                if err := yaml.Unmarshal(data, &list); err != nil {
                        return fmt.Errorf("%s: %w", path, err)
                }
                for _, s := range list {
                        c, err := compile(s)
                        if err != nil {
                                return fmt.Errorf("%s: sequence %q: %w", path, s.Name, err)
                        }
                        seqs = append(seqs, c)
                }
                return nil
        })
        if err != nil {
                return err
        }
        m.seqs = seqs
        return nil
}

func compile(s Sequence) (*compiled, error) {
        if s.Name == "" || s.ID == "" {
                return nil, fmt.Errorf("name and id are required")
        }
        switch s.Severity {
        case rules.SevLow, rules.SevMedium, rules.SevHigh, rules.SevCritical:
        default:
                return nil, fmt.Errorf("invalid severity %q", s.Severity)
        }
        if len(s.Steps) < 2 {
                return nil, fmt.Errorf("at least 2 steps are required, got %d", len(s.Steps))
        }
        for i, st := range s.Steps {
                if st.Rule == "" {
                        return nil, fmt.Errorf("step %d: rule name is required", i)
                }
        }
        w := 5 * time.Minute
        if s.Window != "" {
                d, err := time.ParseDuration(s.Window)
                if err != nil || d <= 0 {
                        return nil, fmt.Errorf("invalid window %q", s.Window)
                }
                w = d
        }
        return &compiled{seq: s, window: w}, nil
}
