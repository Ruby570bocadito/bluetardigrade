# The YARA pack poll lives at the view level and names its failures

The Equipos view now fetches GET /api/yara once — the poll left the
sensor card, where every mounted card fired its own request plus its
own 60 s timer (each host switch remounts HostPage, and hosts outside
the engine's inventory polled too): walking the fleet walked the
engine's rules directory once per click. One poll per view serves every
card. A failed refresh is no longer swallowed: the row keeps the last
good value and appends «refresco fallido» (the time of that value shows
on hover), and when no answer ever arrived the row says the pack could
not be queried instead of claiming the engine publishes none — nothing
is inferred from a fetch error. Bilingual (fleet.yara in the typed
ES/EN dictionaries).
