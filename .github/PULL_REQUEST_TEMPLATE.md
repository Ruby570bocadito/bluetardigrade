<!--
Before opening: `make ci` green locally, docs updated in the same PR,
changelog fragment added. Vulnerabilities go to the private channel in
SECURITY.md, never here.
-->

**What and why**

<!-- One paragraph: the problem and the chosen fix. Link the issue. -->

**How it is tested**

<!-- New/changed tests, smokes or fixtures. If a check could not run
on your machine, say so explicitly — do not claim unexecuted checks. -->

**Docs and content**

- [ ] `docs/api/openapi.yaml` updated if the HTTP API changed
      (`python3 scripts/dev-tests/check_openapi.py` green)
- [ ] `docs/OPERATIONS.md` / `docs/ARCHITECTURE.md` updated if an
      operator-visible surface changed
- [ ] Detection content (rules/sequences/beacons/thresholds) carries
      inert evidence of firing and of benign silence
- [ ] `changelog.d/<area>-<topic>.md` fragment included

**Ground rules honored** (observe-only, read-only AD, synthetic
telemetry, no auto-downloads, personal data for security only)
