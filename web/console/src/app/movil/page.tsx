'use client'

// /movil: the phone view of the console (components/console/
// mobile-console.tsx) and the start page of the installable app
// (app/manifest.ts). Same providers and the same access gate as the
// full console: a phone without a session is sent to /login first.

import { EngineProvider } from '@/components/console/engine-provider'
import { IncidentsProvider } from '@/components/console/incidents-provider'
import { FleetProvider } from '@/components/console/fleet-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { I18nProvider } from '@/components/console/i18n-provider'
import { MobileConsole } from '@/components/console/mobile-console'

export default function MobilePage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <IncidentsProvider>
            <FleetProvider>
              <MobileConsole />
            </FleetProvider>
          </IncidentsProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
