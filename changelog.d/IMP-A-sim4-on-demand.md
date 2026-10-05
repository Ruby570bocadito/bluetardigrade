Engine: on-demand detection-validation battery with run history (SIM-4,
engine side).

A laboratory engine started with `-scenarios <dir>` serves the inert
scenario library over `GET /api/scenarios`, launches the battery with
`POST /api/scenarios/run` (optional `{"only":[...],"timeout_ms":N}`
body; 202 with a run id, 409 while one is in flight, 501 when
disarmed) and reports history through `GET /api/scenarios/runs` and
`GET /api/scenarios/runs/{id}`. The run replays every selected
scenario through the isolated in-process runner of internal/scenario —
the exact machinery the CI regression net uses — against the engine's
live rule set, recording detected/missing/catalog/error per scenario
with replay latency and a pass rate for the trend graph. Nothing a run
raises reaches the live engine (no ring, no store row, no webhook, no
stream), so a validation run can never be mistaken for evidence. Run
history persists to SQLite with the store (last 200 runs) or in memory
(last 50) without it. `golang.org/x/text` was bumped from v0.3.8 to
v0.39.0 (GO-2026-5970) so the module graph no longer carries a
vulnerable version.
