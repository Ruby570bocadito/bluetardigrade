# security-framework console

Early browser console for the framework: live telemetry feed, KPI
dashboard, severity triage, the YAML rule pack and an AI analyst that
explains each alert the way a senior SOC analyst would.

Two pieces:

| Piece               | Stack                              | Port |
|---------------------|------------------------------------|------|
| `console/`          | Next.js 16, Tailwind 4, Motion     | 3000 |
| `console-service/`  | Bun, socket.io                     | 3003 |

The service currently feeds the console from a simulated telemetry hub
(the devsensor scenarios plus the three seeded rules run in TypeScript)
so no Windows host is required. Wiring it to the real Go engine is the
next step: the engine already emits the structured JSON alerts the
console consumes.

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
- The AI triage uses the `z-ai-web-dev-sdk`; without credentials the
  rest of the console keeps working and the analyst panel reports the
  error.

The interface copy is in Spanish by design: the primary audience of the
project documentation is Spanish speaking.
