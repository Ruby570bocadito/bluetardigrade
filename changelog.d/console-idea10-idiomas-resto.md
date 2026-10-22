# The remaining console lane goes bilingual (IDEA-10 phase 11)

The noise report, the active response view, the live event feed and the AI
analyst panel now read from the typed ES/EN dictionaries, closing the IDEA-10
console lane: every console view is bilingual. The shared `eventDetail`
summary (live feed, operations panel, per-host page) and the date formatters
(`formatTime`, `formatDateTime`, `formatAgo`) take the console language with
ES as the default, so existing call sites and the server render keep their
output byte-identical. Rules-view coverage charts get their tactic and
severity words from the dictionary (reusing `panel.sevLabels`); the analyst's
suppression notes and incident meta (alerts/hosts/windows words) travel with
the dictionaries, while suppression reasons stay engine data. Spanish output
is byte-identical to what shipped; the English is a real translation. Console
suite: 599 tests, tsc and next build green.
