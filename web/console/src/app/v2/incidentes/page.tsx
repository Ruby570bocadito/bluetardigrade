'use client'

// bluetardigrade v2 · Incidentes: the cases of the command center, with
// the same providers and live data as the rest of v2 and the classic
// console (the engine's incidents, polled by the shared provider).
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { IncidentsProvider } from '@/components/console/incidents-provider'
import { V2Shell } from '@/components/v2/shell'
import { IncidentsView } from '@/components/v2/incidents/incidents-view'

function Incidents() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.incidentsView.pageTitle
  }, [dict])
  return (
    <V2Shell current="incidentes" title={dict.v2.incidentsView.title}>
      <IncidentsView />
    </V2Shell>
  )
}

export default function IncidentsPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <IncidentsProvider>
            <Incidents />
          </IncidentsProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
