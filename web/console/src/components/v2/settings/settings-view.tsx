'use client'

// v2 · Ajustes: how this installation is set up. A map with the state of
// every area, the console accounts and your own, the engine's external
// notifications, Active Directory connector and host groups (each saved
// in the engine when it is armed for it), what reaches the engine and
// what it delivers, the console audit and the first-run steps. The view
// lives in the URL (vista).
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import { SETTINGS_TABS, settingsTabFromParam, type SettingsTab } from '@/lib/v2/settings-model'
import { Toast, type ToastState } from '../alerts/toast'
import { Accounts } from './accounts'
import { ConsoleAudit } from './audit'
import { Directory } from './directory'
import { FirstRun } from './first-run'
import { HostGroups } from './host-groups'
import { Ingest } from './ingest'
import { Integrations } from './integrations'
import { MyAccount } from './my-account'
import { NotifyChannels } from './notify-channels'
import { SettingsMap } from './settings-map'

export function SettingsView() {
  const { dict } = useI18n()
  const t = dict.v2.settingsView
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<SettingsTab>('mapa')
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    const apply = () => {
      setTab(settingsTabFromParam(new URLSearchParams(currentSearch()).get('vista')))
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return
    replaceOperatorState((search) => setSearchParam(search, 'vista', tab === 'mapa' ? null : tab))
  }, [ready, tab])

  const notice = useCallback((message: string) => setToast({ id: Date.now(), message }), [])
  const go = (next: SettingsTab) => {
    setTab(next)
    window.scrollTo({ top: 0 })
  }

  // nothing until the URL is read: the map would otherwise ask the engine
  // for every area on its way to another tab
  const body = !ready ? null : tab === 'mapa' ? (
      <SettingsMap onOpen={go} />
    ) : tab === 'cuentas' ? (
      <Accounts onNotice={notice} />
    ) : tab === 'mi-cuenta' ? (
      <MyAccount />
    ) : tab === 'avisos' ? (
      <NotifyChannels onNotice={notice} />
    ) : tab === 'directorio' ? (
      <Directory onNotice={notice} />
    ) : tab === 'grupos' ? (
      <HostGroups onNotice={notice} />
    ) : tab === 'ingesta' ? (
      <Ingest />
    ) : tab === 'integraciones' ? (
      <Integrations onOpen={go} />
    ) : tab === 'auditoria' ? (
      <ConsoleAudit />
    ) : (
      <FirstRun onOpen={go} />
    )

  return (
    <div className="v2-settings">
      <div className="v2-tabs v2-det-tabs" role="tablist" aria-label={t.tabsAria}>
        {SETTINGS_TABS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={v === tab} onClick={() => go(v)}>
            {t.tabs[v]}
          </button>
        ))}
      </div>
      <section className="v2-panel v2-det-panel" aria-label={t.tabs[tab]}>
        {body}
      </section>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
