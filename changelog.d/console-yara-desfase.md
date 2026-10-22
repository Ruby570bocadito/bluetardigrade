# The sensor card shows the YARA pack skew (M-3)

The Equipos sensor card gains a «Lote YARA» row comparing what each side
actually said: the `yara_rules_sha` the sensor declares in its heartbeat
(`/api/fleet`) against the `sha16` the engine publishes (`/api/yara`).
Four literal states — synchronized (with the sensor's compiled-rule
count), behind the engine (a different sha: an old pack or a file the
sensor failed to compile, shown in the warning tone), no report from the
sensor, and no pack published by the engine — nothing is inferred. The
pure comparator (`yaraSkew`, lib/fleet) ships its own tests; the pack
status is fetched alongside the card and refreshed on a slow cadence.
Born bilingual (fleet.yara section in the typed ES/EN dictionaries).
Console suite: 603 tests, tsc and next build green.
