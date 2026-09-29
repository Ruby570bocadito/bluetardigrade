# security-framework console

Early browser console for the framework: live telemetry feed, KPI
dashboard, severity triage, the YAML rule pack and an AI analyst that
explains each alert the way a senior SOC analyst would.

Two pieces:

| Piece               | Stack                              | Port |
|---------------------|------------------------------------|------|
| `console/`          | Next.js 16, Tailwind 4, Motion     | 3000 |
| `console-service/`  | Bun, socket.io                     | 3003 |

The service auto-detects the real Go engine: while the engine's local
API (:7778) answers, the console shows REAL telemetry and the status
chip reads `engine real`; the moment the engine goes away it falls back
to the built-in simulator (same NDJSON contract) and the chip reads
`simulación`. No Windows host is required for the simulated mode.

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
- The AI triage needs LLM provider credentials; without them the rest
  of the console keeps working and the analyst panel reports the error.

The interface copy is in Spanish by design: the primary audience of the
project documentation is Spanish speaking.
