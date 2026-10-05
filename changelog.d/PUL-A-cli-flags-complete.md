```markdown
### Documentation accuracy (Pulimiento A, round 2)

- `docs/OPERATIONS.md` configuration reference table claimed to list
  "the full surface — there are no other knobs" but was missing six
  flags that actually exist in `cmd/engine/flags.go`: `-intel`,
  `-baseline-learn`, `-thresholds`, `-notify`, `-incidents`, and the
  TLS pair `-api-cert` / `-api-key` (the last two were not documented
  anywhere in the file, even though `internal/api/api.go` `NewTLS`
  and the `tlsutil.Reloader` have supported an encrypted API listener
  for as long as the ingest listener has). All six are now listed
  with their real defaults and cross-links to their feature sections.
- `docs/OPERATIONS.md` CLI reference table was missing five flags
  (`-notify`, `-api-cert`, `-api-key`, `-ingest-cert`, `-ingest-key`,
  `-lifecycle`, `-incidents`); both flag tables now carry the same
  set, so an operator reading either one gets the complete surface.
- `docs/OPERATIONS.md` "Local HTTP API" section now documents
  `-api-cert` / `-api-key` next to the existing `-api-token`
  paragraph, with the typical deployment line and the reverse-proxy
  caveat. An operator who wants to expose the API beyond loopback
  with encryption no longer has to read the Go source to find how.
```
