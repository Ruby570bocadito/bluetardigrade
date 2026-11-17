'use client'

// bluetardigrade v2 · Detección: the rules, their coverage and their
// tuning, with the same live data as the rest of v2 (rules, chains and
// suppressions come with the engine stream; noise, intel and the
// validation battery are read on demand).
import '@/components/v2/v2.css'
import { useEffect } from 'react'
import { I18nProvider, useI18n } from '@/components/console/i18n-provider'
import { ConsoleUserProvider } from '@/components/console/user-session'
import { EngineProvider } from '@/components/console/engine-provider'
import { V2Shell } from '@/components/v2/shell'
import { DetectionView } from '@/components/v2/detection/detection-view'

function Detection() {
  const { dict } = useI18n()
  useEffect(() => {
    document.title = dict.v2.detectionView.pageTitle
  }, [dict])
  return (
    <V2Shell current="deteccion" title={dict.v2.detectionView.title}>
      <DetectionView />
    </V2Shell>
  )
}

export default function DetectionPage() {
  return (
    <I18nProvider>
      <ConsoleUserProvider>
        <EngineProvider>
          <Detection />
        </EngineProvider>
      </ConsoleUserProvider>
    </I18nProvider>
  )
}
