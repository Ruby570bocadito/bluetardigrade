### Old-name remnants (Pulimiento A, round 6)

- The TODO's POL-4 scope ("SECURITY-FRAMEWORK ENGINE in the banner
  and `security-framework local API` in OpenAPI pass to
  bluetardigrade") is done, plus the same-branding paths in the
  Dockerfile:
  - The engine TUI banner (`cmd/engine/render.go`) now reads
    "BLUETARDIGRADE ENGINE" and the compact-terminal frame
    (`cmd/engine/interactive.go`) "BLUETARDIGRADE".
  - `docs/api/openapi.yaml` titles itself "bluetardigrade local
    API", its header comment says the same, and the Prometheus
    scrape hint uses `job_name: bluetardigrade` — matching
    `docs/OPERATIONS.md`, which already did.
  - Container-internal paths moved from `/opt/security-framework`
    and `/var/lib/security-framework` to `/opt/bluetardigrade` and
    `/var/lib/bluetardigrade` (COPY, state home, WORKDIR and CMD
    flags are all renamed together, so the layout stays
    self-consistent). No other file references the old paths.
- Deliberately not renamed, with reasons:
  - `SF_API_TOKEN` / `SF_INGEST_TOKEN` are environment variable
    names the engine reads in code — renaming them is a functional
    change, not branding.
  - The Splunk `source` value (`internal/siem/splunk.go`) and the
    email `Message-ID` domain / subject prefix
    (`internal/notify`) are outbound data contracts, frozen by
    tests and the dev-test SIEM receiver; changing them needs an
    owner decision plus a coordinated test update.
  - `install.ps1` / `check_installer_path.ps1` handle the legacy
    `security-framework` install dir on purpose (migration and its
    guard). README, CHANGELOG and the website carry historical
    rename notes on purpose; the `security-framework` entries in
    `sensor/Cargo.lock` are a real Rust TLS crate, not branding.
  - `web/console/package.json` / `website/package.json` package
    names belong to the console and website lanes.
