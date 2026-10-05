# Console: accent token family, system theme choice, NOC dark lock

The console interaction accent is now the `--primary*` token family in
`globals.css` (`primary`, `link`, `soft`, `tint`, `strong`), and the 71
raw `blue-*` utilities across 21 files migrate to it with exact
computed-color continuity in both themes; the light `blue-*` remap stays
only as a documented shim for the two raw uses left in `dashboard.tsx`
(Implementación B's open branch touches that file). The header theme
control becomes a three-way system/light/dark pick where **system**
follows `prefers-color-scheme` live, and the NOC wall keeps its dark
surfaces under the light theme by lifting the light class while mounted
and re-resolving the stored choice on exit. Header popovers announce as
non-modal dialogs, `check_console_theme.py` grows to 87 checks including
the accent family, and the console README documents a bundle baseline
(≈1.52 MB client JS, ≈98 KB CSS) to hold new client dependencies
accountable. Verification: 256/256 bun tests, tsc clean, production
build OK, 34/34 DOM regression, theme checker green in both themes.

- **PUL-B-console-theme.md**
