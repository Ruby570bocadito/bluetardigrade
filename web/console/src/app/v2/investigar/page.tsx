'use client'

// bluetardigrade v2 · Investigar: hunting and investigation over the same
// live data as the rest of v2, plus the engine history, the SQL console
// and the AI analyst channel (opened only by the analyst mode).
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { IncidentsProvider } from '@/components/console/incidents-provider'
import { V2Shell } from '@/components/v2/shell'
import { InvestigateView } from '@/components/v2/investigate/investigate-view'

function Investigate() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.investigateView.pageTitle
  }, [dict])
  return (
    <V2Shell current="investigar" title={dict.v2.investigateView.title}>
      <InvestigateView />
    </V2Shell>
  )
}

export default function InvestigatePage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <IncidentsProvider>
            <Investigate />
          </IncidentsProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
