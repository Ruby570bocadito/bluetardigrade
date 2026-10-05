# SEC-A round 1 — intel parser and ingest auth banner

## Fixed

- intel: normalization of threat-intel domains now strips every trailing dot (it used to strip
  only one), so degenerate list entries like `000..` can no longer load a malformed `000.`
  indicator that a hostile event domain (`x.abc..`) could reach through the suffix walk and
  forge an intel hit. Found by the new `FuzzParseLine` fuzz target.
- engine: the startup banner `ingest auth: ENABLED` no longer advertises the shared
  `-token/SF_INGEST_TOKEN` hint on deployments that authenticate only with per-sensor
  identities; the banner now names the credential sensors actually need in each mode
  (shared token, per-sensor identities, or both).
- collector: an attachment name with a blank before its active extension
  (`invoice.pdf .exe`) no longer evades the double-extension indicator; the intermediate
  name is trimmed before the document-suffix check, matching what Windows renders when it
  hides known extensions.
- tests: native Go fuzz targets (seed corpus also runs under plain `go test`) for the ingest
  NDJSON decoder, ingest identities, AUTH token matching, the threat-intel line parser and
  Windows encodings, the rule loader, threshold, beacon and suppression loaders, and the
  Sigma converter.
