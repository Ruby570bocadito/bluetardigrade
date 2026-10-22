# The light theme earns its keep (F5)

The light theme rework: what the dark palette had already settled now
holds on white too. Three ramps that the light flip never mapped —
`yellow` (the medium severity chip text/border), `rose-300` (the denied
session label) and `amber-100` — now flip to readable-on-white steps,
so the «media» chip and the denied badge stop dissolving into the
surface. The light data-viz ink steps off the muddy olive: severity
medium becomes real gold (#ad850c), series green and pink brighten one
step (#059669, #db2777), status good follows (#16a34a) — all revalidated
by check_console_theme against the same floors as dark (3:1 data ink,
CVD dE >= 10 adjacent, light-vs-dark parity). Inline code chips get a
semantic `.code-chip` surface (dark inkwell in dark, light inkwell in
light) replacing the `bg-black/40` hardcode; the shell divider and the
active-nav highlight ride the new `--hairline`/`--inset-highlight`
tokens instead of white-alphas that vanish on white. Also fixes the
dangling `var(--status-ok)` reference in the Directorio status map (the
token never existed; it now reads `--status-good`). Console suite: 603
tests, tsc, next build, theme checker, DOM/browser/a11y/motion batteries
green; a11y scans both themes clean.
