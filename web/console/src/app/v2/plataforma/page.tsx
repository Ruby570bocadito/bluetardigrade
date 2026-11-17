'use client'

// bluetardigrade v2 · Plataforma: the engine's runtime counters, read
// from the same live stats as the rest of v2.
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { FleetProvider } from '@/components/console/fleet-provider'
import { V2Shell } from '@/components/v2/shell'
import { PlatformView } from '@/components/v2/platform/platform-view'

function Platform() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.platformView.pageTitle
  }, [dict])
  return (
    <V2Shell current="plataforma" title={dict.v2.platformView.title}>
      <PlatformView />
    </V2Shell>
  )
}

export default function PlatformPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <FleetProvider>
            <Platform />
          </FleetProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
