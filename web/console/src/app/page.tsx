'use client'

// security-framework · consola SOC en tiempo real.
// Single-route product console. Telemetry (events, alerts, rules,
// stats) comes straight from the Go engine API over SSE via
// use-engine-stream; the AI analyst rides the console-service socket.

import { EngineProvider } from '@/components/console/engine-provider'
import { AnalystProvider } from '@/components/console/socket-provider'
import { ConsoleShell } from '@/components/console/shell'

export default function ConsolePage() {
  return (
    <EngineProvider>
      <AnalystProvider>
        <ConsoleShell />
      </AnalystProvider>
    </EngineProvider>
  )
}
