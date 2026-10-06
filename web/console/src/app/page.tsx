'use client'

// bluetardigrade · consola SOC en tiempo real.
// Single-route product console. Telemetry (events, alerts, rules,
// stats) comes straight from the Go engine API over SSE via
// use-engine-stream; the AI analyst rides the console-service socket.

import { EngineProvider } from '@/components/console/engine-provider'
import { AnalystProvider } from '@/components/console/socket-provider'
import { ConsoleShell } from '@/components/console/shell'
import { IncidentsProvider } from '@/components/console/incidents-provider'
import { FleetProvider } from '@/components/console/fleet-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { I18nProvider } from '@/components/console/i18n-provider'

export default function ConsolePage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <AnalystProvider>
            <IncidentsProvider>
              <FleetProvider>
                <ConsoleShell />
              </FleetProvider>
            </IncidentsProvider>
          </AnalystProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
