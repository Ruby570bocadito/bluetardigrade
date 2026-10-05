# PUL-B 2026-10-05: console theme (light + dark), palette validation and
# CSS dedup. The operator console now ships a light theme next to the dark
# default: a header toggle swaps one class on <html>, persists the choice
# in localStorage, syncs open tabs and follows the OS preference when
# nothing is stored; an inline boot script in the console layout resolves
# the theme before the first paint so no reload flashes the wrong palette.
# The light palette is a full token set in globals.css (surfaces, zinc-ramp
# remap, white-alpha hairline flip, data-viz tokens) and the dark one is
# unchanged; both are validated by the new check_console_theme.py (WCAG
# pairs, severity/status/sequential rules on the viz surface, CVD
# separation via CIEDE2000 with Machado simulations), which every future
# token change should run. Solid primary buttons moved from blue-500 to
# blue-600 so the white label meets AA in both themes; the dot-grid canvas
# and entity-graph SVG no longer hardcode dark-only inks; globals.css lost
# its duplicated scrollbar and ::selection blocks (the unlayered ones
# already won the cascade).
