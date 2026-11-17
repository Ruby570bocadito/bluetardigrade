'use client'

// bluetardigrade v2 · Informes: the engine's reports laid out and printed,
// the analysts' write-ups and the raw data export, with the same live
// data as the rest of v2 plus the engine's cases.
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { IncidentsProvider } from '@/components/console/incidents-provider'
import { V2Shell } from '@/components/v2/shell'
import { ReportsView } from '@/components/v2/reports/reports-view'

function Reports() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.reportsView.pageTitle
  }, [dict])
  return (
    <V2Shell current="informes" title={dict.v2.reportsView.title}>
      <ReportsView />
    </V2Shell>
  )
}

export default function ReportsPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <IncidentsProvider>
            <Reports />
          </IncidentsProvider>
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
