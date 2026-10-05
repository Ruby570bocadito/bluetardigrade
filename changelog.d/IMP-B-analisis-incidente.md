# Incident analysis in the AI analyst (multi-alert)

Incidents and multi-alert selections can now be handed to the AI analyst
as a whole. The console groups the available alerts by host and a
30-minute window, caps the set at the eight most severe alerts and sends
a bounded payload over a new `analyst:ask-incident` socket event; the
hub re-validates every field under the same rate and concurrency limits
as single-alert triage and builds a delimited, per-block truncated
prompt with the case metadata, the host+window grouping, each alert
JSON, the engine-recorded case timeline and the frozen forensic bundle
of the most severe alert (up to 40 events). Missing evidence is never
declared: without a bundle the analysis runs without one, and alerts
left out by the cap travel as an explicit omitted count. The system
prompt asks for an attack-chain narrative that cites concrete events
(type, time, host, process or destination) as proof of each step and
names undeducible facts as open questions, under the same untrusted-data
policy as single-alert analysis. Entry points: "Analizar con IA" on the
incident page and "Analizar la selección" in the alert queue's bulk
action bar.
