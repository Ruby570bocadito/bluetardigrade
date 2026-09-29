# security-framework console

Early browser console for the framework: live telemetry feed, KPI
dashboard, severity triage, the YAML rule pack and an AI analyst that
explains each alert the way a senior SOC analyst would.

Two pieces:

| Piece               | Stack                              | Port |
|---------------------|------------------------------------|------|
| `console/`          | Next.js 16, Tailwind 4, Motion     | 3000 |
| `console-service/`  | Bun, socket.io                     | 3003 |

The hub (`console-service/`) contains no simulator: it forwards only
what the real Go engine delivers (API on :7778, SSE stream) and labels
the header with the actual event source (`sf-sensor (Sysmon real)` for
host telemetry, `sf-devsensor (demo)` while the scripted scenario is
replaying). If the engine is unreachable the console says so and shows
no data.

## Quickstart

Requirements: [bun](https://bun.sh).

```bash
# terminal 1 - realtime hub (socket.io on :3003)
cd console-service && bun install && bun run dev

# terminal 2 - console (Next.js on :3000)
cd console && bun install && bun run dev
```

Open http://localhost:3000.

## Configuration

- `NEXT_PUBLIC_CONSOLE_URL` (console): point the UI at a remote hub,
  e.g. `NEXT_PUBLIC_CONSOLE_URL=http://lab-host:3003 bun run dev`.
  On localhost it defaults to `http://localhost:3003`; behind a reverse
  proxy it falls back to the same origin.
- `PORT` (console-service): overrides the 3003 default.
- `CONSOLE_HOST` (console-service): bind address of the hub. It listens
  on `127.0.0.1` by default because the feed carries local security
  telemetry; set it to `0.0.0.0` only to serve a console that runs on
  another machine, together with `CONSOLE_CORS_ORIGIN`.
- `CONSOLE_CORS_ORIGIN` (console-service): comma-separated list of
  extra origins allowed to open a socket to the hub (the local console
  origins on port 3000 are always allowed).
- The analyst triage calls the LLM SDK declared in
  `console-service/package.json`; without credentials the rest of the
  console keeps working and the analyst panel reports the error.

The interface copy is in Spanish by design: the primary audience of the
project documentation is Spanish speaking.
