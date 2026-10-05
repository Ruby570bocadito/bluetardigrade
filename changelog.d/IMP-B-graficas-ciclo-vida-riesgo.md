# Two honest dashboard charts: triage lifecycle per tactic and per-host risk evolution

The operations dashboard gains two panels built only from data the
engine already delivers, with no interpolation and no invented
baseline. "Ciclo de vida por táctica" crosses the triage lifecycle of
every alert in the received window (new / acknowledged / closed, as
published by the engine's lifecycle overlay) with its ATT&CK tactic
and stacks them per tactic, heaviest first, so an operator sees where
unhandled work piles up in the kill chain; alerts without a tactic tag
land in their own "Sin táctica" column instead of being dropped. The
chart reuses the stacked-columns grammar (tooltip, legend, table twin,
keyboard navigation) and the validated categorical palette, keeping
severity colors out of a workflow state.

"Evolución del riesgo por equipo" samples the engine's hot-hosts list
(decayed per-host risk, top-5 in /api/stats) on a fixed 10 s grid for a
sliding 10-minute window and draws one line per host with a new
multi-series line chart component. The history is real observation
only: a sample that lands while the engine is down or in a backgrounded
tab is recorded as a gap and the line breaks there, a host leaving the
top-5 is recorded as "not observed" (never as a cold score), and the
categorical series cap at 4 lines pushes the remaining hosts to the
table twin with their last known score. Outages are never bridged and
the window starts when the console opens.

Also updates the feature inventory row for the console in
docs/ARCHITECTURE.md, which still said the analyst had no provider
token streaming after that change landed in the previous round
(handoff noted by Pulimiento A).
