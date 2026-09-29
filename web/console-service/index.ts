// console-service: real-time telemetry hub for the security-framework web
// console. It forwards ONLY real data from the Go engine (local API on
// :7778, see internal/api) over socket.io, and serves a small HTTP
// status surface (panel at /, JSON at /health). There is no simulator
// in this service: if the engine is unreachable the console is told so
// and shows nothing, instead of inventing data.
//
// This file is only the entry point: socket.io setup, the HTTP router
// and the engine wiring live in hub.ts (createHub) so they can be
// exercised by the test suite on ephemeral ports.

import { createHub } from './hub'
import { logError, logLine } from './log'

const hub = createHub()

await hub.start()

async function shutdown(signal: string) {
  logLine(`senal ${signal} recibida; cerrando el hub`)
  try {
    await hub.stop()
  } finally {
    process.exit(0)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

// A failed analyst call or a malformed frame must never take the whole
// telemetry bus down: log and keep serving.
process.on('unhandledRejection', (reason) => {
  logError(`promesa rechazada no gestionada: ${reason instanceof Error ? reason.message : String(reason)}`)
})
process.on('uncaughtException', (err) => {
  logError(`excepcion no gestionada: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
})
