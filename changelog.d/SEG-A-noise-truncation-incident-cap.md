- noise: `/api/noise` reports `truncated` when the ALERT scan hits the record
  cap too; before, a store-backed window with more alerts than one scan reads
  presented partial top lists as complete whenever the event scan fit.
- incidents: linking alerts that would take a case past its 1000-alert cap is
  refused whole; before, the request answered 400 while the ids that still fit
  had already been added in memory (no timeline entry, no persistence).
- scenarios: an unknown scenario id in the validation battery is classified by
  sentinel error, so the request keeps answering 400 if the error wording ever
  changes instead of degrading to a 500.
