# SEG-A — fuzzing coverage for the mail, reputation-indicator and query-filter input surfaces

SEC-7 continuation: eight native Go fuzz targets now cover the remaining
untrusted-input surfaces — the EML mail decoder (MIME structure, multipart
nesting, base64/quoted-printable bodies, HTML link extraction and attachment
names), the analyst-supplied reputation indicators (the IP and hash gates
that decide what may be sent to third-party providers, with the
never-private never-routable property asserted), and the shared telemetry
query filters (severity lists, since/until time parsing and the full filter
parser driving the alert and event matchers). Every target carries a seed
corpus that also runs in the normal `go test` suite, so anything a fuzz
session finds becomes a permanent regression test. Around 1.9 million
fuzz executions over these surfaces produced no new product defect: the
mail decoder's part, depth and decoded-text bounds hold, the indicator
validators stay idempotent and case-insensitive, and the filter parser
answers 400 or a working filter for arbitrary query strings.
