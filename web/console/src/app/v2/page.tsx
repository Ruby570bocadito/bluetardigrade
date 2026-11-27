'use client'

// bluetardigrade v2 · centro de mando. The new console grows here, one
// section at a time, next to the classic one at / (which stays untouched
// until v2 is approved). Same providers, same live data.
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { FleetProvider } from '@/components/console/fleet-provider'
import { V2Shell } from '@/components/v2/shell'
import { HomeView } from '@/components/v2/home/home-view'

function Home() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.pageTitle
  }, [dict])
  return (
    <V2Shell current="inicio" title={dict.v2.topbar.title}>
      <HomeView />
    </V2Shell>
  )
}

export default function CommandCenterPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <FleetProvider>
            <Home />
          </FleetProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
