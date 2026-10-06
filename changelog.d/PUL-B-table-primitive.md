## Table primitive (POL-7 Fase B1)

`ui/table.tsx` — the shared surface for the six semantic tables of the
console, extracted verbatim from the markup the views already ship
(suppressions, live-feed, alerts, user-session, intel, rules): surface
+ sr-only caption, sticky header option (pin on thead, zinc band on the
row, the live-feed/alerts pattern), uppercase data head vs `compact`
density, `aria-sort` passthrough for ordering, hairline-divided body,
interactive hover and a `selected` row that takes the accent tint from
`--primary*`. No DATA color is baked in — cell accents ride on
`className`, exactly like `Badge`.

- Zero view changes: the phase-B migration (the coordinated window with
  IMP-B) consumes it mechanically; the primitive is validated by a new
  DOM-guard contract check (caption, sticky, aria-sort, compact,
  selection tint, empty row, zero hue literals).
- Full battery green on the fresh build: 371 tests, tsc, build, theme
  checker both themes, CSP, DOM guard, browser 21/21, axe 18/18,
  motion (positive control included).
