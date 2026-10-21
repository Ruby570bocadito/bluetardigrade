- **Alert assignment works from the console.** The engine proxy's closed
  write allowlist was missing the two M-1 assignment routes, so every
  assignment action of TEAM-3 («Asignármela», reasignar, quitar, «Asignar»
  en lote) answered 405 `read_only` before reaching the engine. Both routes
  (`POST /api/alerts/{id}/assign`, `POST /api/alerts/assign-batch`) now
  travel the proxy like the status route: analyst role, the engine's 8 KiB
  body cap mirrored, and the same server-side attribution (the account name
  replaces `by`; the assignee is the recipient and is never rewritten).
