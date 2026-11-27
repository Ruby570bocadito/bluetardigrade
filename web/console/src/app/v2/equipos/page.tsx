'use client'

// bluetardigrade v2 · Equipos: the fleet, with the same live data as the
// rest of v2 plus the engine inventory and enrollment state (polled by the
// shared fleet provider every 10 s).
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { FleetProvider } from '@/components/console/fleet-provider'
import { V2Shell } from '@/components/v2/shell'
import { HostsView } from '@/components/v2/hosts/hosts-view'

function Hosts() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.hostsView.pageTitle
  }, [dict])
  return (
    <V2Shell current="equipos" title={dict.v2.hostsView.title}>
      <HostsView />
    </V2Shell>
  )
}

export default function HostsPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <FleetProvider>
            <Hosts />
          </FleetProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
