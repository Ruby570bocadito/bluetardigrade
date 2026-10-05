Engine: report catalog (REP-1 part A) and noise report (§2.4).

`GET /api/reports` lists the report kinds the engine can compute today
(executive summary, incident bundle, fleet coverage, SOC activity) and
`GET /api/reports/{kind}` generates one on demand as JSON or CSV, with
a `window` preset (24h/7d/30d or any duration within kind bounds).
Reports aggregate records the engine already holds — with the SQLite
store they read the full retention window, without it the in-memory
rings and the report says so (`source: ring` plus `oldest_record`), and
a 10000-record scan cap is flagged as `truncated`. CSV answers keep the
export endpoints' spreadsheet formula escaping. The noise report
(`GET /api/noise?window=24h`, PLAN-DETALLADO §2.4) ranks the processes,
DNS domains and rules that most generate events or alerts, fleet-wide
or per host, so operators know what to tune; rule rows carry the share
of their alerts whose current status is closed/acknowledged, named
exactly that until a triage decision field exists. Reports only read:
they never change alert lifecycle and never touch a host.

Enrollment: identity names are now unique by construction. The
enrollment registry re-rolls the 6-hex suffix (bounded) while the
derived identity name already exists, inside the same lock that appends
the record — a birthday collision across re-enrollments used to save
without error and then brick the engine at the next restart, because
`Open()` refuses files with duplicate identity names (SEC-A-1, found by
Seguridad A).

Tests: internal/report unit coverage for every builder and the window
bounds, internal/api handler tests for the new routes, and
scripts/dev-tests/e2e_reports_noise.sh driving a real lab engine end to
end (33 checks: catalog, wire-seeded aggregates, CSV, triage overlay,
incident bundle, contract guards). TestScenarioEndpointsRoundTrip no
longer flakes when the battery wins the second-launch race.
