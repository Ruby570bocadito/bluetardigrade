'use client'

// bluetardigrade v2 · Alertas: the triage queue of the command center,
// with the same providers and live data as Inicio and the classic console.
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { V2Shell } from '@/components/v2/shell'
import { AlertsView } from '@/components/v2/alerts/alerts-view'

function Alerts() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.alertsView.pageTitle
  }, [dict])
  return (
    <V2Shell current="alertas" title={dict.v2.alertsView.title}>
      <AlertsView />
    </V2Shell>
  )
}

export default function AlertsPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <Alerts />
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
