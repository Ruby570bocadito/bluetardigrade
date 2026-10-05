package store

// Scenario-run history (TODO SIM-4, engine side): one row per
// completed detection-validation battery, kept so the pass-rate trend
// outlives an engine restart. The whole per-scenario results array is
// one JSON document per row — the runs are few (operator-triggered)
// and are always read whole, so a document column is the honest shape
// (same discipline as fleet_hosts: opaque JSON, the owning package
// decides its meaning).

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
)

// scenarioRunsKept caps the history table: beyond this many runs the
// oldest rows are deleted after each save. The battery is a lab tool
// with manual triggers; 200 runs is years of honest use and keeps the
// trend graph bounded.
const scenarioRunsKept = 200

const scenarioRunsSchema = `
CREATE TABLE IF NOT EXISTS scenario_runs (
        run_id         TEXT PRIMARY KEY,
        started_at     INTEGER NOT NULL,
        finished_at    INTEGER,
        total          INTEGER NOT NULL DEFAULT 0,
        detected       INTEGER NOT NULL DEFAULT 0,
        missing        INTEGER NOT NULL DEFAULT 0,
        catalog_errors INTEGER NOT NULL DEFAULT 0,
        errors         INTEGER NOT NULL DEFAULT 0,
        duration_ms    INTEGER NOT NULL DEFAULT 0,
        pass_rate      REAL NOT NULL DEFAULT 0,
        results        TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS scenario_runs_started_idx ON scenario_runs(started_at);
`

func (s *Store) migrateScenarioRuns() error {
	if _, err := s.db.Exec(scenarioRunsSchema); err != nil {
		return fmt.Errorf("store: scenario runs schema: %w", err)
	}
	return nil
}

// SaveScenarioRun upserts one completed run and prunes the history
// beyond scenarioRunsKept. Implements scenrun.RunSink.
func (s *Store) SaveScenarioRun(r *scenrun.Run) error {
	results, err := json.Marshal(r.Results)
	if err != nil {
		return fmt.Errorf("store: scenario run %s results: %w", r.ID, err)
	}
	var finishedAt any
	if r.FinishedAt != nil {
		finishedAt = r.FinishedAt.UnixNano()
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: scenario run begin: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO scenario_runs
                (run_id, started_at, finished_at, total, detected, missing, catalog_errors, errors, duration_ms, pass_rate, results)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                        finished_at = excluded.finished_at, total = excluded.total,
                        detected = excluded.detected, missing = excluded.missing,
                        catalog_errors = excluded.catalog_errors, errors = excluded.errors,
                        duration_ms = excluded.duration_ms, pass_rate = excluded.pass_rate,
                        results = excluded.results`,
		r.ID, r.StartedAt.UnixNano(), finishedAt,
		r.Total, r.Detected, r.Missing, r.CatalogErr, r.Errors,
		r.DurationMS, r.PassRate, string(results)); err != nil {
		tx.Rollback()
		return fmt.Errorf("store: scenario run upsert: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM scenario_runs WHERE run_id IN (
                SELECT run_id FROM scenario_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?)`,
		scenarioRunsKept); err != nil {
		tx.Rollback()
		return fmt.Errorf("store: scenario run prune: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: scenario run commit: %w", err)
	}
	return nil
}

// LoadScenarioRuns returns up to limit completed runs, newest first,
// without their per-scenario results (the history list payload).
func (s *Store) LoadScenarioRuns(limit int) ([]scenrun.Run, error) {
	if limit < 1 {
		limit = 20
	}
	rows, err := s.db.Query(`SELECT run_id, started_at, finished_at, total, detected, missing,
                catalog_errors, errors, duration_ms, pass_rate
                FROM scenario_runs ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("store: scenario runs query: %w", err)
	}
	defer rows.Close()
	var out []scenrun.Run
	for rows.Next() {
		r, err := scanRunSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: scenario runs rows: %w", err)
	}
	return out, nil
}

// LoadScenarioRun returns one completed run with its results, or nil
// when the id is unknown. Implements scenrun.RunSink.
func (s *Store) LoadScenarioRun(id string) (*scenrun.Run, error) {
	var resultsJSON string
	row := s.db.QueryRow(`SELECT run_id, started_at, finished_at, total, detected, missing,
                catalog_errors, errors, duration_ms, pass_rate, results
                FROM scenario_runs WHERE run_id = ?`, id)
	r := &scenrun.Run{}
	var startedAt, finishedAt sql.NullInt64
	if err := row.Scan(&r.ID, &startedAt, &finishedAt, &r.Total, &r.Detected, &r.Missing,
		&r.CatalogErr, &r.Errors, &r.DurationMS, &r.PassRate, &resultsJSON); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("store: scenario run %s: %w", id, err)
	}
	run, err := finishRun(r, startedAt, finishedAt, &resultsJSON)
	if err != nil {
		return nil, err
	}
	return run, nil
}

// scanner abstracts *sql.Rows / *sql.Row for the shared column list.
type scanner interface {
	Scan(dest ...any) error
}

func scanRunSummary(sc scanner) (*scenrun.Run, error) {
	r := &scenrun.Run{}
	var startedAt, finishedAt sql.NullInt64
	if err := sc.Scan(&r.ID, &startedAt, &finishedAt, &r.Total, &r.Detected, &r.Missing,
		&r.CatalogErr, &r.Errors, &r.DurationMS, &r.PassRate); err != nil {
		return nil, fmt.Errorf("store: scenario run row: %w", err)
	}
	return finishRun(r, startedAt, finishedAt, nil)
}

// finishRun converts the row's timestamps back to the wire shape and,
// when asked, decodes the results document.
func finishRun(r *scenrun.Run, startedAt, finishedAt sql.NullInt64, resultsJSON *string) (*scenrun.Run, error) {
	r.StartedAt = time.Unix(0, startedAt.Int64).UTC()
	if finishedAt.Valid {
		t := time.Unix(0, finishedAt.Int64).UTC()
		r.FinishedAt = &t
	}
	r.Status = scenrun.StatusCompleted
	if resultsJSON != nil {
		var results []scenrun.ScenarioResult
		if err := json.Unmarshal([]byte(*resultsJSON), &results); err != nil {
			return nil, fmt.Errorf("store: scenario run %s results: %w", r.ID, err)
		}
		r.Results = results
	}
	return r, nil
}
