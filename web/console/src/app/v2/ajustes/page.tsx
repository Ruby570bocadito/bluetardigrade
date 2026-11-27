'use client'

// bluetardigrade v2 · Ajustes: the installation's settings, with the same
// live data as the rest of v2 plus the fleet and enrollment state the
// first-run steps and the ingest view read.
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { FleetProvider } from '@/components/console/fleet-provider'
import { V2Shell } from '@/components/v2/shell'
import { SettingsView } from '@/components/v2/settings/settings-view'

function Settings() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.settingsView.pageTitle
  }, [dict])
  return (
    <V2Shell current="ajustes" title={dict.v2.settingsView.title}>
      <SettingsView />
    </V2Shell>
  )
}

export default function SettingsPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <FleetProvider>
            <Settings />
          </FleetProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
