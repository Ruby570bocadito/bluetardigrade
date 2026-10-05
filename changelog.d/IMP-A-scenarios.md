Engine: detection validation with inert synthetic scenarios (SIM-1/SIM-2).

`scenarios/` ships a detection-validation library with one inert,
synthetic scenario per shipped rule and per kill-chain (127 total),
declaring the ATT&CK techniques and the alerts the engine must raise.
`engine scenarios list|replay` lists the library and replays it against
a laboratory engine on loopback only; every event is tagged
`simulation` and pinned to a `LAB-SIM-*` host, and the engine propagates
the tag to every alert derived from simulated evidence (rules, chains,
beacons, thresholds, intel and baseline), so a replay is never mixed
with real telemetry. CI now fails when a scenario stops detecting, when
a shipped detection loses its scenario, or when an alert raised from
simulated events goes out untagged.
