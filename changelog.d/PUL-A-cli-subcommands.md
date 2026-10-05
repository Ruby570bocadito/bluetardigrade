```markdown
### Documentation accuracy (Pulimiento A, round 3)

- `docs/OPERATIONS.md` Engine CLI reference table listed only 5 of
  the 9 subcommands the engine actually exposes. Added the 4
  missing ones with their real flag surface and cross-links to the
  feature sections that already documented them in prose:
  `engine doctor` (diagnostics; links to `DOCTOR.md`),
  `engine report` (human alert report; links to
  `SOC-INTEGRACIONES-E-INFORMES.md`),
  `engine ingest-identity` (per-sensor credential generation; links
  to the «Per-sensor ingest identities» section), and
  `engine operator-credential` (active-response operator credential
  generation; links to the «Active response» section). An operator
  reading the CLI reference no longer has to read the Go source to
  discover these commands exist.
- `docs/ARCHITECTURE.md` feature inventory, Telemetry row: was
  stale. It said "Rust ETW sensor (Kernel-Process)" but the Rust
  sensor has collected from four providers since the network and
  registry providers landed (commit `0a4a8aa` "sensor: TCP
  connections and registry writes from kernel ETW providers" and
  later refinements). Now lists all four: Kernel-Process (process
  create/start/end), Kernel-Network (TCP connects), Kernel-Registry
  (SetValueKey) and DNS-Client (query answers), plus image hashes
  in the enrichment list.
```
