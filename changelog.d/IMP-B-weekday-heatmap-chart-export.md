# Weekday × hour alert-load heatmap (VIZ-2) and chart export kit (VIZ-6)

The operations dashboard gains "Carga de alertas por hora y día", a
weekday × hour grid of the last 7 local days drawn from a dedicated
bounded fetch (`/api/alerts?since=<window start>&limit=1000`), separate
from the shared live triage buffer. The aggregation (`lib/alert-heatmap.ts`)
never invents coverage: alerts outside the requested window and alerts
with an unusable timestamp are counted and declared in the panel footer,
a reply that hits the API limit is flagged as "there may be more than fit
here", the window is the exact local-midnight range the fetch asked for,
and the browser's IANA timezone is printed next to it. The grid renders
as a real table (its own accessible twin) with a one-hue sequential ramp,
per-cell counts and tooltips, a per-day total column, and a chart/table
toggle that swaps to a per-day six-hour-quarter summary; inicios de
sesión (AD-3) and per-host event variants stay out until their data
exists.

Every `ChartCard` panel now carries an "Exportar" menu (VIZ-6): the data
behind the chart as CSV (RFC 4180 quoting, BOM for spreadsheet tools,
built from the accessible table twin), and the chart itself as SVG
(serialized with computed presentation values inlined so var() tokens
survive without the page stylesheet) or PNG (2× rasterization on the
panel background). When the platform cannot rasterize, the menu says so
in Spanish instead of silently downloading nothing; the menu is
keyboard-operable (Escape returns focus, outside click closes) and
adapts to panels without an SVG or table by offering only what exists.
