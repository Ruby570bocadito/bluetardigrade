# The NOC finishes its language sweep and the shared charts follow

The NOC wall no longer leaks Spanish: the severity strip reads the
typed dictionaries (alerts.sevLabels) instead of the shared
SEVERITY_LABEL constant, and the tactic names in the coverage matrix
and the host×tactic heatmap come from the dictionaries too — a new
tacticsShort record keeps the tiny cells tight while the full name
travels in the title and the aria. The heatmap's hardcoded strings
(«Ver alertas de», «N alertas») move to charts.heat (hostAria,
cellTitle). Because AttackMatrix and HostTacticHeatmap are shared, the
panel and the rules view get the same fix for free. SEVERITY_LABEL is
left with no consumers and is retired from soc-metrics; the dashboard
donut and the triage flow still carry their own tactic labels for a
later round (noted in the estado). Bilingual by typing (dict-en must
mirror dict-es or tsc fails).
