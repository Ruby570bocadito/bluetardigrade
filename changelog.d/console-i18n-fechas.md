# Dates and numbers follow the console language in the swept views

formatTime/formatDateTime have taken the console language since
IDEA-10, with Spanish as the default — and several already-bilingual
views never passed it, so an English console still read Spanish
timestamps. The language now travels in alerts (list, selection aria,
detail, triage and assignment panels), directory (connector sync rows,
posture subtitle), intel (feed and history), fleet (host index, host
page timeline, sensor card) and the incident playbook (evidence and
chronology). Swept along: eleven toLocaleString('es-ES') literals in
the directory view (explorer range, connector counters, coverage,
posture) now format numbers through the exported localeOf, so an
English console stops printing Spanish thousands separators.
baseline-card stays as-is: it never went through IDEA-10 (every
string is Spanish) and needs its own sweep, noted in the estado.
