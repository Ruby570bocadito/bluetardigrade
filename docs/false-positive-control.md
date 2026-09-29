# Controlling false positives and alert noise

An operator guide to the output channel: every layer that stands between
a rule hit and your SIEM, which knob to turn for each kind of noise, and
what a hostile or misconfigured feed cannot do to the pipeline. Every
behavior described here is pinned by unit tests; the auth channel is
additionally exercised end-to-end by the smoke
(`scripts/dev-tests/smoke_auth.sh`); the caps table at the end names the
constants in the code.

## The layers between a rule hit and your SIEM

```
sensor feed ──► rules ──► [1] suppressions (operator allowlist — a
                        │     suppressed hit stops here entirely)
                        ► [2] dedup (60 s TTL, always on)
                        ► [3] kill-chain correlator (compresses N hits
                              into one campaign alert; fed by every
                              non-suppressed hit, dedup-independent)
                        ► [4] outputs: console + JSON log, webhook,
                              local API/SSE, console delivery chip
```

- **Suppressions** are the operator's allowlist: when an alert is
  *correct but unwanted* (sanctioned change window, accepted-risk host),
  this is the tool. It is also the first filter the hit meets.
- **Dedup** is built in and not configurable: it collapses bursts of
  identical hits so one process gone wild costs you one alert per
  minute, not one per event.
- **The correlator** reduces volume structurally: a 5-step campaign is
  one alert, not five. It is fed by every non-suppressed hit regardless
  of dedup (chain progress is not deduped), and its completions bypass
  dedup too — they are rate-limited by their own re-arm semantics
  instead.
- **Routing** (severity, tags, `notify`) lets the receiver filter what
  it cares about instead of the engine dropping signal globally.

The order matters: a suppressed hit produces nothing downstream — no
console line, no webhook POST, no correlator progress — so the allowlist
is the strongest (and most dangerous to overuse) knob.

## Layer 1 — suppressions (operator allowlist)

`suppressions.yaml` (annotated format in `suppressions.example.yaml`)
silences a rule, a host, or a rule+host pair, optionally until an RFC
3339 instant:

```yaml
- rule_id: vss-delete
  host: LAB-WKS-01          # exact match, case-insensitive
  reason: "approved change window INC-1234 (backup migration)"
  expires: 2026-10-05T06:00:00Z
```

Semantics that matter for tuning:

- **Exact matches, no globs, no regex.** A suppression can never be
  accidentally broader than what you wrote. Host comparison is
  case-insensitive (Windows reports hostnames in arbitrary case);
  `rule_id` is the rule's `id`, not its display name.
- **A suppressed hit is treated as an accepted state**: it raises no
  alert, does not reach the webhook, and does not feed the kill-chain
  correlator (a silenced rule can never complete a campaign on that
  host). Every suppressed hit is logged as
  `[SUPPRESS] rule=<id> host=<host>` — nothing is ever silenced
  silently.
- **Hot reload every 15 s** with rules and sequences: editing the file
  is enough, no restart. A malformed file is **fatal at startup** and
  rejected (keeping the previous set, loudly) on reload — a typo cannot
  disarm a control you believe is armed.
- **Observable**: `GET /api/suppressions` lists the live set and
  `/api/stats` counts it in `suppressions_active`. Entries are edited
  in the YAML file only — the API stays read-only.

### Recipes

| Situation | Entry | Notes |
|-----------|-------|-------|
| Approved change window (backup migration, AV scan storm…) | `rule_id` + `host` + `expires` + `reason` | Always set `expires` and the ticket id in `reason`; the file is an audit artifact |
| Permanent accepted exception (jump host with unusual tooling) | `rule_id` + `host`, no `expires` | Revisit quarterly; the reason field is where you left the justification |
| Rule under construction / ruleset migration | `rule_id` only | Silences the rule estate-wide — the broadest possible entry; prefer scoping by host |
| One noisy process family, not the host | Layer 3 | A suppression is the wrong tool when the signal you want is hiding inside the noise you don't |

## Layer 2 — deduplication (always on, not configurable)

Each raised alert is remembered for 60 seconds under the key
`rule_id|host|pid` (`internal/alert`, `dedupTTL`). Practical
consequences:

- The same rule firing repeatedly for the **same process on the same
  host** yields one alert per TTL window. This is the storm-killer.
- A **new PID** or a **different host** is a new alert, on purpose:
  dedup is tuned to prefer visibility over silence — a real lateral
  movement (same technique, different machine) must not be deduped away
  by the first machine's alert.
- The dedup map is bounded: past 4096 entries expired keys are purged
  opportunistically; past the 65536 hard cap new keys stop being
  *remembered* but alerts keep *flowing*. A flood degrades to more
  alerts, never to silence.

If you are seeing the same alert every minute for a legitimate,
long-running process, do not look for a dedup knob — that is Layer 1
(suppress) or Layer 3 (tighten the rule) territory.

## Layer 3 — write the rule tighter (avoid the suppression treadmill)

Every suppression is future audit debt. Before silencing a rule, check
whether the rule itself should be narrower:

- **Add a condition** that separates the benign case from the
  interesting one (parent image, command-line marker, target path) —
  see *Writing rules* in the README.
- **Calibrate severity** honestly: a rule that fires on admin
  maintenance is `low`/`medium` material; keep `critical` for the ones
  you would wake a colleague for.
- **Use `tags`** for receiver-side routing (e.g. `tags: [lateral,
  credential-access]`) so the SIEM can filter without the engine
  dropping signal globally.
- **`enabled: false` vs suppression**: disabling is for "this rule does
  not belong in this deployment" (it also stops feeding the correlator);
  suppression is for "this rule is right, this host/time is the
  exception". If you find yourself suppressing a rule on most of your
  fleet, the rule is wrong — disable it and fix it.
- **`notify: "true"`** (in an `alert` action) marks the alerts that
  deserve external notification; point your pager at that field instead
  of piping everything.

## Kill-chain volume and suppression interplay

Sequences (`sequences/*.yaml`) complete when every named step is
observed on the **same host** inside the `window`, then re-arm. Two
tuning facts:

- Completion is inherently rate-limited: a 3-step chain cannot produce
  more alerts than the rarest of its steps. Correlation is the first
  thing to reach for when raw rule hits are noisy but the *pattern* is
  what matters — replace three noisy rules' alerting with one sequence
  and keep the rules as silent feeders (`enabled: true`, but suppress
  their alerting estate-wide) if you only care about the campaign.
- Suppressing any contributing step on a host blocks that chain from
  completing there. That is by design (accepted state semantics) — but
  if you suppress a very chatty step, you are also turning off the
  campaign alert that depends on it. Prefer tightening the step rule.

## Receiver-side volume control

The webhook POSTs the same structured alert the console and JSON log
line carry (`internal/alert.Alert`). Filter at the receiver by:

- `severity` — engine-honest severities, no per-deployment inflation;
- `tags` — campaign/technique routing written by the ruleset author;
- `notify` — the explicit "page someone" flag from `alert` actions;
- `rule_id` — stable identifiers, safe for SIEM allowlists.

Authenticate the channel so volume is not something an attacker can
*inject* either: global `-webhook-token`/`SF_WEBHOOK_TOKEN` (engine
connector) or per-action `config.secret` (`actions.webhook`). A
reachable receiver without a token accepts forged alerts — see
*Alert webhook* in the README.

## What a hostile feed cannot do to the output channel

The engine assumes the feed may lie (misconfigured sensor, compromised
host inventing events). The caps that protect the pipeline:

| Structure | Bound | Behavior past the bound |
|-----------|-------|------------------------|
| Ingest line size | 1 MiB (`maxLineSize`) | line rejected, `dropped` counter |
| Identity fields (`host`, `user`, `id`) | 255 / 256 / 128 runes | **truncated, not dropped** — the event still flows |
| Alert dedup map | soft 4096 / hard 65536, TTL 60 s | purge, then stop remembering; alerts keep flowing |
| Correlator states | 8192 | NEW hosts stop being tracked until slots free |
| Correlator stale states | — | pruned on every successful sequence reload (removed sequences cannot hold slots) |
| Webhook queue | 512 frames, single sequential delivery worker | saturated deliveries counted as `dropped`/failed, detection unaffected |

Design rule of thumb, applied consistently: **visibility wins over
deduplication, and bounded degradation beats silence**. A flood makes
the pipeline noisier or coarser (fewer dedup keys, no new correlator
hosts), never quieter. If you monitor one thing, monitor
`/api/stats`: `webhook_failed`, `dropped`, `ingest_rejected` and the
correlator-visible counters distinguish "quiet network" from
"broken output channel".

## Verifying your tuning

```bash
# unit level: every behavior above has a test
go test -count=1 ./...

# E2E: 7 scenarios incl. suppressions, rotation, webhook auth (real binaries)
bash scripts/dev-tests/smoke_auth.sh

# contract: API surface still matches the spec
python3 scripts/dev-tests/check_openapi.py
```

Live observation: `GET /api/health` (open on purpose for probes),
`GET /api/stats` (counters incl. `suppressions_active`, webhook
delivery), `GET /api/suppressions` (the live allowlist), and
`[SUPPRESS]` lines on the engine's stderr.
