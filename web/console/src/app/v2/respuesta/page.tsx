'use client'

// bluetardigrade v2 · Respuesta: the engine's active response (its status,
// the alerts it can be used on, the log of every attempt) and the cases
// (hosts by state, a war room, the plans, the numbers), with the same live
// data as the rest of v2 plus the incidents the engine keeps.
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { IncidentsProvider } from '@/components/console/incidents-provider'
import { V2Shell } from '@/components/v2/shell'
import { RespondView } from '@/components/v2/respond/respond-view'

function Respond() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.respondView.pageTitle
  }, [dict])
  return (
    <V2Shell current="respuesta" title={dict.v2.respondView.title}>
      <RespondView />
    </V2Shell>
  )
}

export default function RespondPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <IncidentsProvider>
            <Respond />
          </IncidentsProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
