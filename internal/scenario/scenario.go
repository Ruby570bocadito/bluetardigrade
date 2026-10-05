// Package scenario loads and replays detection-validation scenarios
// (TODO SIM-1/SIM-2): inert, synthetic event sequences in the exact
// schema the sensors send, authored as YAML. Each scenario declares
// the ATT&CK techniques it exercises and the alerts (shipped rule IDs
// or kill-chain sequence IDs) the engine MUST raise when the sequence
// is replayed.
//
// Two consumers share the loader:
//   - the in-process Runner (this package), which the CI regression
//     net uses to fail the build when a shipped rule or chain stops
//     detecting, and
//   - the "sf-engine scenarios replay" command, which streams the same
//     files to a LABORATORY engine over loopback and checks the alerts
//     the engine raised through its API.
//
// Project boundary: validation uses inert telemetry only. A scenario
// is data — nothing here executes anything on any machine, and every
// event is tagged "simulation" and pinned to a LAB-SIM-* host so a
// replay can never be mistaken for real evidence.
package scenario

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"

	"gopkg.in/yaml.v3"
)

// Event is one scenario event declaration. The scenario YAML declares
// events with the SAME field names the sensors send on the wire — the
// JSON schema of pkg/model — so the declaration round-trips through
// encoding/json: yaml tags on the model would fork the wire contract
// into a second schema, and a YAML-native decode would silently miss
// every json-tagged field ("command_line" is not a YAML field name).
// Unknown fields fail loud: a typo'd declaration must never load as a
// half-empty event that matches nothing.
type Event struct {
	*model.Event
}

// UnmarshalYAML implements yaml.v3 custom decoding.
func (e *Event) UnmarshalYAML(node *yaml.Node) error {
	raw := map[string]any{}
	if err := node.Decode(&raw); err != nil {
		return err
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var ev model.Event
	if err := dec.Decode(&ev); err != nil {
		return fmt.Errorf("evento fuera del esquema JSON del sensor: %w", err)
	}
	e.Event = &ev
	return nil
}

// HostPrefix is the mandatory host prefix of every scenario event.
// The prefix makes the synthetic origin of a replay unmistakable on
// every surface that shows a host name (console, API, reports): an
// alert for a LAB-SIM host can never belong to the monitored fleet.
const HostPrefix = "LAB-SIM-"

// idPattern is the scenario identifier shape: a stable "sim-" slug
// used by the CI coverage check and by "-only" filters.
var idPattern = regexp.MustCompile(`^sim-[a-z0-9][a-z0-9-]*$`)

// maxFileBytes caps one scenario file. Same loader discipline as the
// rules and sequences loaders: os.ReadFile has no bound of its own and
// the library is parsed on every CI run and every replay.
const maxFileBytes = 4 << 20 // 4 MiB

// eventStep is the timestamp spacing the loader assigns when an event
// declares none: a small, non-zero spread so time-window detectors see
// a realistic sequence while every event stays inside "now".
const eventStep = 10 * time.Millisecond

// Expected names one alert that MUST fire when the scenario replays.
// Rule is a shipped rule ID or a kill-chain sequence ID, as loaded by
// the engine (the same IDs the rules and sequences APIs expose).
type Expected struct {
	RuleID string `yaml:"rule"`
	// Min is how many alerts the expectation requires (default 1).
	// Duplicates beyond the minimum are never a failure: the same rule
	// legitimately fires on several events of the same scenario.
	Min int `yaml:"min,omitempty"`
}

// MinOrDefault returns the effective minimum count of the expectation
// (a declared min below 1 means 1).
func (e Expected) MinOrDefault() int {
	if e.Min < 1 {
		return 1
	}
	return e.Min
}

// Scenario is one synthetic detection exercise.
type Scenario struct {
	Name        string `yaml:"name"`
	ID          string `yaml:"id"`
	Description string `yaml:"description"`
	// Attack lists the ATT&CK techniques the sequence exercises
	// (e.g. "T1003.001"), mirroring the tags of the rules it feeds.
	Attack []string `yaml:"attack"`
	// Host is the synthetic host of the scenario. Every event whose
	// host is empty is pinned to it; an event may override it, but the
	// override must keep the LAB-SIM- prefix (multi-host lateral
	// movement scenarios).
	Host string `yaml:"host"`
	// User is the default account of the events (optional).
	User string `yaml:"user,omitempty"`
	// Expected lists the alerts that must fire. At least one.
	Expected []Expected `yaml:"expected"`
	// Events is the inert telemetry, in send order. At least one.
	Events []Event `yaml:"events"`

	origin string // file the scenario was loaded from, for diagnostics
}

// Origin returns the file the scenario was loaded from.
func (s *Scenario) Origin() string { return s.origin }

// knownTypes is the closed set of event types a scenario may declare.
// The library documents detections: an event type outside the unified
// schema is an authoring error, not a detection gap.
var knownTypes = map[string]bool{
	model.TypeProcessCreate:    true,
	model.TypeProcessTerminate: true,
	model.TypeProcessAccess:    true,
	model.TypeFileWrite:        true,
	model.TypeNetworkConnect:   true,
	model.TypeImageLoad:        true,
	model.TypeRegistrySet:      true,
	model.TypeNetworkAlert:     true,
	model.TypeHostQuery:        true,
	model.TypeHoneypotConnect:  true,
	model.TypeHoneypotLogin:    true,
	model.TypeHoneypotCommand:  true,
	model.TypeNetworkFirewall:  true,
	model.TypeEmailMessage:     true,
}

// LoadFile parses one scenario file: a YAML list of scenarios with the
// same shape discipline as the rules loader (bounded read, resource
// guard, loud validation errors).
func LoadFile(path string) ([]*Scenario, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxFileBytes {
		return nil, fmt.Errorf("%s: file is %d bytes, over the %d byte cap", path, info.Size(), maxFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if err := yamlcheck.Guard(path, data); err != nil {
		return nil, err
	}
	var list []Scenario
	// KnownFields: an unknown key in the scenario declaration is an
	// authoring typo (e.g. "expcted") and must fail loud, exactly like
	// the unknown fields of the events themselves.
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&list); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	now := time.Now()
	seen := map[string]string{}
	out := make([]*Scenario, 0, len(list))
	for i := range list {
		sc := &list[i]
		sc.origin = path
		if prev, dup := seen[sc.ID]; dup {
			return nil, fmt.Errorf("%s: scenario %q: duplicate id %q (already loaded from %s)", path, sc.Name, sc.ID, prev)
		}
		seen[sc.ID] = path
		if err := sc.finalize(now); err != nil {
			return nil, fmt.Errorf("%s: scenario %d (%q): %w", path, i, sc.Name, err)
		}
		out = append(out, sc)
	}
	return out, nil
}

// LoadDir walks dir and returns every scenario of every .yaml/.yml
// file, sorted by file and declaration order inside each file.
// Duplicate scenario ids across files fail LOUD: the id is the key of
// the CI coverage check and of the replay report.
func LoadDir(dir string) ([]*Scenario, error) {
	var files []string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".yaml" || ext == ".yml" {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	var out []*Scenario
	seen := map[string]string{}
	for _, path := range files {
		list, err := LoadFile(path)
		if err != nil {
			return nil, err
		}
		for _, sc := range list {
			if prev, dup := seen[sc.ID]; dup {
				return nil, fmt.Errorf("%s: scenario %q: duplicate id %q (already loaded from %s)", path, sc.Name, sc.ID, prev)
			}
			seen[sc.ID] = path
			out = append(out, sc)
		}
	}
	return out, nil
}

// finalize validates the scenario declaration and fills the event
// defaults: ids, timestamps, host, user and the simulation tag. The
// loader owns the marker so an authoring omission cannot send
// unmarked telemetry down a detection pipeline.
func (s *Scenario) finalize(now time.Time) error {
	switch {
	case strings.TrimSpace(s.Name) == "":
		return fmt.Errorf("sin name")
	case !idPattern.MatchString(s.ID):
		return fmt.Errorf("id %q invalido: debe coincidir %s", s.ID, idPattern)
	case strings.TrimSpace(s.Description) == "":
		return fmt.Errorf("sin description")
	case !isSimHost(s.Host):
		return fmt.Errorf("host %q invalido: debe empezar por %s", s.Host, HostPrefix)
	case len(s.Expected) == 0:
		return fmt.Errorf("sin expected: un escenario sin expectativas no valida nada")
	case len(s.Events) == 0:
		return fmt.Errorf("sin events")
	}
	seenExp := map[string]bool{}
	for i := range s.Expected {
		e := &s.Expected[i]
		if strings.TrimSpace(e.RuleID) == "" {
			return fmt.Errorf("expected %d: sin rule", i)
		}
		if e.Min < 0 {
			return fmt.Errorf("expected %d (rule %s): min negativo", i, e.RuleID)
		}
		if seenExp[e.RuleID] {
			return fmt.Errorf("expected duplicado para la regla %s", e.RuleID)
		}
		seenExp[e.RuleID] = true
	}
	base := now
	for i := range s.Events {
		w := &s.Events[i]
		if w.Event == nil {
			return fmt.Errorf("event %d: vacio", i)
		}
		ev := w.Event
		switch {
		case ev.Type == "":
			return fmt.Errorf("event %d: sin type", i)
		case !knownTypes[ev.Type]:
			return fmt.Errorf("event %d: type %q fuera del esquema de eventos", i, ev.Type)
		}
		if ev.ID == "" {
			ev.ID = fmt.Sprintf("%s-%04d", s.ID, i)
		}
		if ev.Timestamp.IsZero() {
			ev.Timestamp = base.Add(time.Duration(i) * eventStep)
		}
		if ev.Host == "" {
			ev.Host = s.Host
		} else if !isSimHost(ev.Host) {
			return fmt.Errorf("event %d: host %q invalido: debe empezar por %s", i, ev.Host, HostPrefix)
		}
		if ev.User == "" {
			ev.User = s.User
		}
		markSimulated(ev)
	}
	return nil
}

// isSimHost reports whether host names a synthetic host.
func isSimHost(host string) bool {
	return strings.HasPrefix(strings.ToUpper(host), HostPrefix)
}

// markSimulated appends the simulation tag to the event tags without
// mutating a shared backing array (events are fresh from YAML here,
// but the helper keeps the same discipline as alert.MarkSimulated).
func markSimulated(ev *model.Event) {
	for _, t := range ev.Tags {
		if t == alert.SimulationTag {
			return
		}
	}
	tags := make([]string, 0, len(ev.Tags)+1)
	tags = append(tags, ev.Tags...)
	ev.Tags = append(tags, alert.SimulationTag)
}

// Catalog is the set of alert IDs a detection stack can raise: shipped
// rule IDs and kill-chain sequence IDs. The CI net and the replay
// command validate every expectation against it BEFORE trusting a
// result: an expectation naming an unknown ID is an authoring bug
// (renamed or retired rule), not a detection failure.
type Catalog struct {
	RuleIDs map[string]bool
	SeqIDs  map[string]bool
}

// NewCatalog builds a Catalog from its parts. Both maps may be nil.
func NewCatalog(ruleIDs, seqIDs []string) *Catalog {
	c := &Catalog{RuleIDs: map[string]bool{}, SeqIDs: map[string]bool{}}
	for _, id := range ruleIDs {
		c.RuleIDs[id] = true
	}
	for _, id := range seqIDs {
		c.SeqIDs[id] = true
	}
	return c
}

// Has reports whether the catalog knows the ID.
func (c *Catalog) Has(id string) bool {
	if c == nil {
		return false
	}
	return c.RuleIDs[id] || c.SeqIDs[id]
}

// MissingExpectations returns the scenario expectations the catalog
// does not know, in declaration order.
func (c *Catalog) MissingExpectations(sc *Scenario) []string {
	var missing []string
	for _, e := range sc.Expected {
		if !c.Has(e.RuleID) {
			missing = append(missing, e.RuleID)
		}
	}
	return missing
}
