- **Every outbound client now refuses redirects.** The two stragglers from
  the sink fix (`0dddc28`) unify with the rest: the scenario replay client
  (`getJSONInto`), which sends the engine bearer token, and the `apiHealthy`
  ingest probe both answer a 3xx as a definitive failure instead of
  following it. The bearer token can no longer ride a redirect to another
  port or host, and a hostile squatter of the ingest port can no longer
  turn the health probe into a GET at a URL the engine never chose.
  Regression tests pin both: a 302 to a 200 endpoint fails loud and the
  target receives zero requests.
