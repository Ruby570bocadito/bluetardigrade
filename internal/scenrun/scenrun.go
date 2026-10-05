// Package scenrun runs the detection-validation battery on demand
// (TODO SIM-4, engine side): an API caller (the console, SIM-4 part B)
// POSTs to /api/scenarios/run and the engine replays the scenario
// library against its OWN live rule set, keeping the outcome as
// history (detected / not detected and per-scenario latency).
//
// The replay is the isolated in-process runner of internal/scenario
// (the exact machinery the CI regression net uses): enrichment, rule
// evaluation and kill-chain correlation in the production order, with
// every alert travelling a private alert.Manager. Nothing the battery
// raises reaches the live engine: no ring, no store row, no webhook,
// no SSE frame — a validation run can never be mistaken for evidence,
// which is the same boundary the `simulation` tag enforces on the wire
// path (SIM-1). The engine that answers is expected to be a
// laboratory engine: the surface is armed only with -scenarios <dir>,
// and the library is reloaded per run so an edited scenario takes
// effect without a restart.
//
// One run at a time: a second POST while one is in flight answers 409
// naming the current run. History lives in SQLite when the engine has
// a store (the trend graph outlives restarts) and in memory otherwise.
package scenrun

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/scenario"
)

// Status is the outcome stage of a run or of one scenario inside it.
type Status string

const (
	// StatusRunning marks an in-flight run.
	StatusRunning Status = "running"
	// StatusCompleted marks a finished run (see the per-scenario
	// statuses for the actual outcome).
	StatusCompleted Status = "completed"
	// StatusDetected: every expectation fired.
	StatusDetected Status = "detected"
	// StatusMissing: the replay finished but some expectation did not
	// reach its minimum — a detection regression or a broken scenario.
	StatusMissing Status = "missing"
	// StatusCatalog: an expectation names a rule or sequence the
	// engine does not have. An authoring bug (renamed or retired
	// detection), never counted as a detection failure of the engine.
	StatusCatalog Status = "catalog"
	// StatusError: the scenario could not be replayed at all.
	StatusError Status = "error"
)

// Bounds for one run. The battery is a lab tool: a scenario that has
// not detected after 30 s is not going to (the isolated replay
// processes events synchronously — a passing scenario takes
// milliseconds), and an operator-triggered run must always terminate.
const (
	defaultTimeout = 10 * time.Second
	maxTimeout     = 30 * time.Second
	// memoryRuns caps the in-memory history when no store is attached.
	memoryRuns = 50
)

// ErrRunning is answered as 409 by the API layer.
var ErrRunning = errors.New("a scenario run is already in progress")

// ErrNotArmed is answered as 501 by the API layer.
var ErrNotArmed = errors.New("scenario validation is not armed")

// ErrUnknownScenario marks a Start request that picked scenario ids the
// loaded library does not have. It is answered as 400 by the API layer
// (a client error), so it is a sentinel classified with errors.Is —
// never by matching the message text, which is a wording change away
// from silently turning the 400 into a 500.
var ErrUnknownScenario = errors.New("escenario(s) desconocido(s)")

// ExpectedView is the wire shape of one library expectation.
type ExpectedView struct {
	Rule string `json:"rule"`
	Min  int    `json:"min"`
}

// ScenarioView is one library entry as GET /api/scenarios serves it.
type ScenarioView struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Attack      []string       `json:"attack"`
	Host        string         `json:"host"`
	Events      int            `json:"events"`
	Expected    []ExpectedView `json:"expected"`
	Origin      string         `json:"origin"`
}

// MissingExpectation is one expectation that did not reach its minimum.
type MissingExpectation struct {
	Rule     string `json:"rule"`
	Expected int    `json:"expected"`
	Fired    int    `json:"fired"`
}

// ScenarioResult is the per-scenario outcome of a run. It doubles as
// the persisted JSON shape (the store keeps the whole results array as
// one document), so field names are part of the on-disk contract too.
type ScenarioResult struct {
	ScenarioID string               `json:"scenario_id"`
	Name       string               `json:"name"`
	Attack     []string             `json:"attack"`
	Status     Status               `json:"status"`
	Host       string               `json:"host"`
	EventsSent int                  `json:"events_sent"`
	DurationMS int64                `json:"duration_ms"`
	Missing    []MissingExpectation `json:"missing,omitempty"`
	// Untagged counts raised alerts that arrived WITHOUT the
	// simulation tag. The loader pins the tag on every event and the
	// propagation rules carry it to every derived alert, so any
	// untagged alert is an anomaly worth surfacing (never counted as
	// a detection failure).
	Untagged int    `json:"untagged,omitempty"`
	Detail   string `json:"detail,omitempty"`
}

// Run is one battery execution: the summary the history list serves
// and, with Results, the detail of a single run.
type Run struct {
	ID         string           `json:"run_id"`
	StartedAt  time.Time        `json:"started_at"`
	FinishedAt *time.Time       `json:"finished_at,omitempty"`
	Status     Status           `json:"status"`
	Total      int              `json:"total"`
	Detected   int              `json:"detected"`
	Missing    int              `json:"missing"`
	CatalogErr int              `json:"catalog_errors"`
	Errors     int              `json:"errors"`
	DurationMS int64            `json:"duration_ms"`
	PassRate   float64          `json:"pass_rate"`
	Results    []ScenarioResult `json:"results,omitempty"`
}

// summary recomputes the aggregate counters from the results so far.
func (r *Run) summary() {
	detected, missing, catalog, errors := 0, 0, 0, 0
	for _, res := range r.Results {
		switch res.Status {
		case StatusDetected:
			detected++
		case StatusMissing:
			missing++
		case StatusCatalog:
			catalog++
		case StatusError:
			errors++
		}
	}
	r.Detected, r.Missing, r.CatalogErr, r.Errors = detected, missing, catalog, errors
	if len(r.Results) > 0 {
		r.PassRate = float64(detected) / float64(len(r.Results))
	} else {
		r.PassRate = 0
	}
}

// RunSink persists run history. The SQLite store implements it; nil
// means the history lives in memory only (last memoryRuns runs).
type RunSink interface {
	// SaveScenarioRun stores a completed run (whole document).
	SaveScenarioRun(r *Run) error
	// LoadScenarioRuns returns up to limit completed runs, newest
	// first, without their per-scenario results.
	LoadScenarioRuns(limit int) ([]Run, error)
	// LoadScenarioRun returns one completed run with results, or
	// nil when the id is unknown.
	LoadScenarioRun(id string) (*Run, error)
}

// Deps are the engine-provided hooks.
type Deps struct {
	// Rules hands over the live (hot-reload aware) rule set. The
	// battery validates exactly the detections this engine runs.
	Rules func() *rules.Engine
	// Sink optionally persists completed runs.
	Sink RunSink
	// Logf receives one line per run start and completion.
	Logf func(format string, args ...any)
}

// Service is the SIM-4 engine-side surface the API hub calls into.
// Construct it with New; the nil *Service is valid and disarmed —
// every method answers with ErrNotArmed so the handlers can render a
// 501 without nil-guards at every call site.
type Service struct {
	dir    string
	seqDir string
	deps   Deps

	mu      sync.Mutex
	current *Run   // in-flight run, nil when idle
	recent  []*Run // completed-run history when deps.Sink == nil, newest first
}

// New arms the service with the scenario library at dir and the
// kill-chain sequences at seqDir (empty disables chain scenarios —
// they would replay rule-only).
func New(dir, seqDir string, deps Deps) *Service {
	return &Service{dir: dir, seqDir: seqDir, deps: deps}
}

// Dir returns the configured library directory.
func (s *Service) Dir() string {
	if s == nil {
		return ""
	}
	return s.dir
}

// CurrentRunID returns the id of the in-flight run, or "" when idle.
// The 409 answer carries it so the caller can poll the right run.
func (s *Service) CurrentRunID() string {
	if s == nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil {
		return ""
	}
	return s.current.ID
}

func (s *Service) logf(format string, args ...any) {
	if s.deps.Logf != nil {
		s.deps.Logf(format, args...)
	}
}

// Library loads the scenario library fresh and returns it sorted by
// id. A load error surfaces to the caller verbatim: an edited,
// malformed scenario file must be visible in the console, not buried
// in a log.
func (s *Service) Library() ([]ScenarioView, error) {
	if s == nil {
		return nil, ErrNotArmed
	}
	list, err := s.load()
	if err != nil {
		return nil, err
	}
	out := make([]ScenarioView, 0, len(list))
	for _, sc := range list {
		expected := make([]ExpectedView, 0, len(sc.Expected))
		for _, e := range sc.Expected {
			expected = append(expected, ExpectedView{Rule: e.RuleID, Min: e.MinOrDefault()})
		}
		out = append(out, ScenarioView{
			ID:          sc.ID,
			Name:        sc.Name,
			Description: sc.Description,
			Attack:      sc.Attack,
			Host:        sc.Host,
			Events:      len(sc.Events),
			Expected:    expected,
			Origin:      sc.Origin(),
		})
	}
	return out, nil
}

// load reloads the library directory. Empty is an error here: an
// armed service without scenarios cannot validate anything and the
// operator should hear about it at the first run (the API surface
// turns it into a 500 naming the directory).
func (s *Service) load() ([]*scenario.Scenario, error) {
	list, err := scenario.LoadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("cargando escenarios de %s: %w", s.dir, err)
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("no hay escenarios en %s", s.dir)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	return list, nil
}

// StartOptions is the parsed POST /api/scenarios/run body. All fields
// are optional.
type StartOptions struct {
	// Only restricts the battery to these scenario ids (empty = all).
	Only []string `json:"only"`
	// TimeoutMS is the per-scenario wait before an expectation is
	// declared missing (clamped to 1s..30s; default 10s).
	TimeoutMS int `json:"timeout_ms"`
}

// Start launches one battery run in the background and returns the
// run record as it stands at launch. It fails fast (before the
// goroutine exists) when the library cannot load or a run is already
// in flight, so the API can answer 500/409 without a dangling run.
func (s *Service) Start(opts StartOptions) (*Run, error) {
	if s == nil {
		return nil, ErrNotArmed
	}
	re := s.deps.Rules
	if re == nil {
		return nil, fmt.Errorf("scenrun: sin juego de reglas configurado")
	}
	if re() == nil {
		return nil, fmt.Errorf("scenrun: el motor no tiene reglas cargadas")
	}
	list, err := s.load()
	if err != nil {
		return nil, err
	}
	if len(opts.Only) > 0 {
		want := make(map[string]bool, len(opts.Only))
		for _, id := range opts.Only {
			want[id] = true
		}
		filtered := make([]*scenario.Scenario, 0, len(want))
		seen := make(map[string]bool, len(want))
		for _, sc := range list {
			if want[sc.ID] {
				filtered = append(filtered, sc)
				seen[sc.ID] = true
			}
		}
		var unknown []string
		for id := range want {
			if !seen[id] {
				unknown = append(unknown, id)
			}
		}
		if len(unknown) > 0 {
			sort.Strings(unknown)
			return nil, fmt.Errorf("%w: %v", ErrUnknownScenario, unknown)
		}
		list = filtered
	}

	timeout := defaultTimeout
	if opts.TimeoutMS > 0 {
		timeout = time.Duration(opts.TimeoutMS) * time.Millisecond
		if timeout > maxTimeout {
			timeout = maxTimeout
		}
		if timeout < time.Second {
			timeout = time.Second
		}
	}

	run := &Run{
		ID:        newRunID(),
		StartedAt: time.Now().UTC(),
		Status:    StatusRunning,
		Total:     len(list),
	}

	s.mu.Lock()
	if s.current != nil {
		s.mu.Unlock()
		return nil, ErrRunning
	}
	s.current = run
	// the caller gets a copy taken before the run starts: the goroutine
	// below keeps writing the record (progress, summary) while the API
	// is still encoding its answer
	launched := *run
	s.mu.Unlock()

	go s.execute(run, list, timeout)
	s.logf("[SCENRUN] run %s started: %d escenario(s) contra las reglas vivas del motor", launched.ID, launched.Total)
	return &launched, nil
}

// execute replays the selected scenarios one by one, recording each
// result as it completes so the detail view shows progress while the
// run is still in flight.
func (s *Service) execute(run *Run, list []*scenario.Scenario, timeout time.Duration) {
	re := s.deps.Rules()
	// The catalog the expectations are validated against is the one
	// THIS run will actually use: the live rule set plus the
	// sequences compiled from the configured directory (the runner
	// rebuilds it per scenario, so a reloaded sequence file is picked
	// up by the next run).
	cat := catalog(re, s.seqDir)
	runner := &scenario.Runner{Rules: re, SeqDir: s.seqDir}

	for _, sc := range list {
		res := s.runOne(runner, cat, sc)
		s.mu.Lock()
		run.Results = append(run.Results, res)
		run.summary()
		s.mu.Unlock()
	}

	finished := time.Now().UTC()
	s.mu.Lock()
	run.FinishedAt = &finished
	run.Status = StatusCompleted
	run.DurationMS = finished.Sub(run.StartedAt).Milliseconds()
	snapshot := *run
	if s.current == run {
		s.current = nil
	}
	if s.deps.Sink == nil {
		s.recent = append([]*Run{&snapshot}, s.recent...)
		if len(s.recent) > memoryRuns {
			s.recent = s.recent[:memoryRuns]
		}
	}
	s.mu.Unlock()

	if s.deps.Sink != nil {
		if err := s.deps.Sink.SaveScenarioRun(&snapshot); err != nil {
			s.logf("[SCENRUN] run %s: guardar el historial FALLO: %v", run.ID, err)
		}
	}
	s.logf("[SCENRUN] run %s completed: %d/%d detectado(s), %d sin detectar, %d de catalogo, %d error(es) en %s",
		run.ID, snapshot.Detected, snapshot.Total, snapshot.Missing, snapshot.CatalogErr, snapshot.Errors,
		time.Duration(snapshot.DurationMS)*time.Millisecond)
}

// runOne replays one scenario and maps the outcome to its wire shape.
func (s *Service) runOne(runner *scenario.Runner, cat *scenario.Catalog, sc *scenario.Scenario) ScenarioResult {
	res := ScenarioResult{
		ScenarioID: sc.ID,
		Name:       sc.Name,
		Attack:     sc.Attack,
		Host:       sc.Host,
		EventsSent: len(sc.Events),
	}
	if missing := cat.MissingExpectations(sc); len(missing) > 0 {
		res.Status = StatusCatalog
		res.Detail = fmt.Sprintf("la(s) expectativa(s) %v no existen en el motor de laboratorio", missing)
		return res
	}
	start := time.Now()
	out, err := runner.Run(sc)
	res.DurationMS = time.Since(start).Milliseconds()
	if err != nil {
		res.Status = StatusError
		res.Detail = err.Error()
		return res
	}
	untagged := 0
	for _, a := range out.Alerts {
		tagged := false
		for _, t := range a.Tags {
			if t == alert.SimulationTag {
				tagged = true
				break
			}
		}
		if !tagged {
			untagged++
		}
	}
	res.Untagged = untagged
	if missing := out.Missing(); len(missing) > 0 {
		res.Status = StatusMissing
		for _, e := range missing {
			res.Missing = append(res.Missing, MissingExpectation{
				Rule:     e.RuleID,
				Expected: e.MinOrDefault(),
				Fired:    out.Fired[e.RuleID],
			})
		}
		return res
	}
	res.Status = StatusDetected
	return res
}

// catalog builds the expectation catalog from the live rule set and
// the configured sequences directory. A broken sequences directory is
// a run-wide error condition, but the catalog keeps going with the
// rules only: the per-scenario replays surface the load error loudly
// (StatusError) instead of hiding it behind an empty catalog.
func catalog(re *rules.Engine, seqDir string) *scenario.Catalog {
	ruleIDs := make([]string, 0, re.Count())
	for _, r := range re.Snapshot() {
		ruleIDs = append(ruleIDs, r.ID)
	}
	var seqIDs []string
	if seqDir != "" {
		if m, err := correlate.LoadDir(seqDir, nil); err == nil {
			for _, info := range m.Snapshot() {
				seqIDs = append(seqIDs, info.ID)
			}
		}
	}
	return scenario.NewCatalog(ruleIDs, seqIDs)
}

// History returns up to limit runs, newest first, without
// per-scenario results. The in-flight run (if any) leads the list.
func (s *Service) History(limit int) ([]Run, error) {
	if s == nil {
		return nil, ErrNotArmed
	}
	if limit < 1 {
		limit = 20
	}
	s.mu.Lock()
	var out []Run
	if s.current != nil {
		out = append(out, summaryOf(s.current))
	}
	recent := s.recent
	s.mu.Unlock()
	for _, r := range recent {
		if len(out) >= limit {
			break
		}
		out = append(out, summaryOf(r))
	}
	if s.deps.Sink != nil && len(out) < limit {
		stored, err := s.deps.Sink.LoadScenarioRuns(limit - len(out))
		if err != nil {
			return nil, err
		}
		out = append(out, stored...)
	}
	return out, nil
}

// RunDetail returns one run with its per-scenario results. The
// in-flight run reflects live progress.
func (s *Service) RunDetail(id string) (*Run, error) {
	if s == nil {
		return nil, ErrNotArmed
	}
	s.mu.Lock()
	if s.current != nil && s.current.ID == id {
		cp := *s.current
		results := make([]ScenarioResult, len(s.current.Results))
		copy(results, s.current.Results)
		cp.Results = results
		s.mu.Unlock()
		return &cp, nil
	}
	for _, r := range s.recent {
		if r.ID == id {
			cp := *r
			s.mu.Unlock()
			return &cp, nil
		}
	}
	sink := s.deps.Sink
	s.mu.Unlock()

	if sink != nil {
		return sink.LoadScenarioRun(id)
	}
	return nil, nil
}

// summaryOf copies a run without its results (the list payloads stay
// small; the detail endpoint serves results).
func summaryOf(r *Run) Run {
	cp := *r
	cp.Results = nil
	return cp
}

// newRunID mints a run identifier. crypto/rand with a run- prefix:
// the id is the history key the console will link to, so it must be
// unguessable in shape and collision-free in practice.
func newRunID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// The battery cannot mint an id only when the OS entropy
		// source is broken; fall back to a timestamp-derived id
		// rather than refusing to run.
		return fmt.Sprintf("run-%d", time.Now().UnixNano())
	}
	return "run-" + hex.EncodeToString(b[:])
}
