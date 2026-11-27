'use client'

// v2 · Informes: what the engine reports and what the team writes. The
// catalog of reports, the executive summary, the SOC activity, the fleet
// coverage and one incident (computed by the engine over a window that
// ends now), the analyst write-up of an alert and its library (kept in
// this browser), the raw data export and today against the week. A
// report prints as a sheet. View, window, case, alert and print mode
// live in the URL (vista, ventana, caso, alerta, imprimir).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useIncidents } from '@/components/console/incidents-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { reportWindowPreset, type ReportWindowPreset } from '@/lib/reports'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import { PRINTABLE, REPORT_TABS, reportsTabFromParam, type ReportsTab } from '@/lib/v2/reports-model'
import { Toast, type ToastState } from '../alerts/toast'
import { Catalog } from './catalog'
import { DataExport } from './data-export'
import { Executive } from './executive'
import { FleetCoverage } from './fleet-coverage'
import { IncidentReport } from './incident-report'
import { Library } from './library'
import { SocActivity } from './soc-activity'
import { Today } from './today'
import { WriteUp } from './write-up'

export function ReportsView() {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  const { alerts, events, stats, respondAudit } = useEngine()
  const { incidents, available } = useIncidents()
  const me = useConsoleUser()

  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<ReportsTab>('catalogo')
  const [win, setWin] = useState<ReportWindowPreset>('7d')
  const [caseId, setCaseId] = useState<string | null>(null)
  const [alertId, setAlertId] = useState<string | null>(null)
  const [print, setPrint] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    const apply = () => {
      const p = new URLSearchParams(currentSearch())
      setTab(reportsTabFromParam(p.get('vista')))
      setWin(reportWindowPreset(p.get('ventana')))
      setCaseId(p.get('caso'))
      setAlertId(p.get('alerta'))
      setPrint(p.get('imprimir') === '1')
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return undefined
    replaceOperatorState((search) => {
      let s = setSearchParam(search, 'vista', tab === 'catalogo' ? null : tab)
      s = setSearchParam(s, 'ventana', ['ejecutivo', 'soc', 'flota'].includes(tab) && win !== '7d' ? win : null)
      s = setSearchParam(s, 'caso', tab === 'incidente' ? caseId : null)
      s = setSearchParam(s, 'alerta', tab === 'analista' ? alertId : null)
      return setSearchParam(s, 'imprimir', print && PRINTABLE.includes(tab) ? '1' : null)
    })
  }, [ready, tab, win, caseId, alertId, print])

  const hosts = useMemo(() => [...new Set([...events.map((e) => e.host), ...alerts.map((a) => a.host)].filter(Boolean))].sort(), [events, alerts])
  const notice = useCallback((message: string) => setToast({ id: Date.now(), message }), [])
  const isAdmin = !me.pending && me.role === 'admin'
  const printing = print && PRINTABLE.includes(tab)

  const go = (next: ReportsTab) => {
    setTab(next)
    setPrint(false)
    window.scrollTo({ top: 0 })
  }
  const onPrint = (on: boolean) => {
    setPrint(on)
    window.scrollTo({ top: 0 })
  }

  const body =
    tab === 'catalogo' ? (
      <Catalog storeEnabled={stats ? !!stats.store_enabled : null} onOpen={go} />
    ) : tab === 'ejecutivo' ? (
      <Executive win={win} onWin={setWin} print={printing} onPrint={onPrint} />
    ) : tab === 'soc' ? (
      <SocActivity win={win} onWin={setWin} print={printing} onPrint={onPrint} />
    ) : tab === 'flota' ? (
      <FleetCoverage win={win} onWin={setWin} print={printing} onPrint={onPrint} />
    ) : tab === 'incidente' ? (
      <IncidentReport incidents={incidents} available={available} caseId={caseId} onCase={setCaseId} />
    ) : tab === 'analista' ? (
      <WriteUp alerts={alerts} alertId={alertId} onAlert={setAlertId} print={printing} onPrint={onPrint} />
    ) : tab === 'biblioteca' ? (
      <Library
        onOpen={(id) => {
          setAlertId(id)
          go('analista')
        }}
        onNotice={notice}
      />
    ) : tab === 'exportar' ? (
      <DataExport hosts={hosts} audit={isAdmin ? respondAudit : undefined} isAdmin={isAdmin} />
    ) : (
      <Today />
    )

  return (
    <div className="v2-reports" data-printing={printing}>
      {!printing && (
        <div className="v2-tabs v2-det-tabs" role="tablist" aria-label={t.tabsAria}>
          {REPORT_TABS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={v === tab} onClick={() => go(v)}>
              {t.tabs[v]}
            </button>
          ))}
        </div>
      )}
      {printing ? body : <section className="v2-panel v2-det-panel" aria-label={t.tabs[tab]}>{body}</section>}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
