- reports: the documented `7d` and `30d` window presets are accepted again by
  `/api/reports/{kind}` and `/api/noise`; the parser used to reject every day
  suffix even though the API catalog, the OpenAPI document and the error
  message itself advertised them.
- reports and noise: a host-filtered report keeps the honest `truncated` flag
  of the underlying store scan; before, filtering by host could hide a capped
  scan and silently undercount the window.
- engine: new fuzz targets cover the `ENROLL` handshake line, the enrollment
  registry (host validation, credential round-trip, identity-name uniqueness
  on re-enrollment) and the scenario library YAML loader; their seed corpora
  also run in the ordinary test suite.
