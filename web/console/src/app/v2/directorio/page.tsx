'use client'

// bluetardigrade v2 · Directorio: the Active Directory snapshot and the
// posture the engine computes on it, with the fleet to compare coverage.
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { FleetProvider } from '@/components/console/fleet-provider'
import { V2Shell } from '@/components/v2/shell'
import { DirectoryView } from '@/components/v2/directory/directory-view'

function Directory() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.directoryView.pageTitle
  }, [dict])
  return (
    <V2Shell current="directorio" title={dict.v2.directoryView.title}>
      <DirectoryView />
    </V2Shell>
  )
}

export default function DirectoryPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <FleetProvider>
            <Directory />
          </FleetProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
