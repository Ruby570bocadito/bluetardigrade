'use client'

// v2 · Respuesta: what the team does about an alert. The engine's one
// action — terminating a process on its own host, SIGKILL, audited before
// the signal — with its status, the alerts it can be used on, the log of
// every attempt and why some were denied; and the cases: their hosts by
// state, one case as a war room, the response plans and the numbers.
// View, open alert, open case, log filter and search live in the URL
// (vista, alerta, caso, filtro, q).
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useIncidents } from '@/components/console/incidents-provider'
import { useConsoleUser } from '@/components/console/user-session'
import type { SfRespondRecord } from '@/lib/console-types'
import { alertKey } from '@/lib/engine-client'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import { actionableAlerts, AUDIT_FILTERS, auditCounts, RESPOND_TABS, respondTabFromParam, type AuditFilter, type RespondTab } from '@/lib/v2/respond-model'
import { Empty } from '../home/parts'
import { useNow } from '../use-now'
import { ActList } from './act-list'
import { ActionLog } from './action-log'
import { AlertResponse } from './alert-response'
import { Containment } from './containment'
import { Denials } from './denials'
import { Metrics } from './metrics'
import { Plans } from './plans'
import { Readiness } from './readiness'
import { WarRoom } from './war-room'

const NO_RECORDS: SfRespondRecord[] = []

export function RespondView() {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const { alerts, events, rules, respondState, respondAudit, auditLimit, setAuditLimit, lastSyncAt, refresh } = useEngine()
  const { incidents, available } = useIncidents()
  const me = useConsoleUser()
  const now = useNow(1000)

  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<RespondTab>('estado')
  const [alertParam, setAlertParam] = useState<string | null>(null)
  const [caseId, setCaseId] = useState<string | null>(null)
  const [filter, setFilter] = useState<AuditFilter>('todas')
  const [q, setQ] = useState('')

  useEffect(() => {
    const apply = () => {
      const p = new URLSearchParams(currentSearch())
      setTab(respondTabFromParam(p.get('vista')))
      setAlertParam(p.get('alerta'))
      setCaseId(p.get('caso'))
      const f = p.get('filtro') as AuditFilter | null
      setFilter(f && AUDIT_FILTERS.includes(f) ? f : 'todas')
      setQ(p.get('q') ?? '')
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return undefined
    const id = window.setTimeout(() => {
      replaceOperatorState((search) => {
        let s = setSearchParam(search, 'vista', tab === 'estado' ? null : tab)
        s = setSearchParam(s, 'alerta', alertParam)
        s = setSearchParam(s, 'caso', tab === 'sala' || tab === 'planes' ? caseId : null)
        s = setSearchParam(s, 'filtro', tab === 'registro' && filter !== 'todas' ? filter : null)
        return setSearchParam(s, 'q', tab === 'registro' && q ? q : null)
      })
    }, 200)
    return () => window.clearTimeout(id)
  }, [ready, tab, alertParam, caseId, filter, q])

  const records = respondAudit?.records ?? NO_RECORDS
  const isAdmin = !me.pending && me.role === 'admin'
  const armed = !!respondState?.armed
  const synced = lastSyncAt !== null
  const counts = auditCounts(records)
  const actionable = useMemo(() => actionableAlerts(alerts, events, records), [alerts, events, records])

  const go = (next: RespondTab) => {
    setTab(next)
    setAlertParam(null)
    window.scrollTo({ top: 0 })
  }
  const openAlert = (key: string) => {
    setAlertParam(key)
    window.scrollTo({ top: 0 })
  }
  const openCase = (id: string, where: RespondTab = 'sala') => {
    setCaseId(id)
    go(where)
  }

  if (alertParam) {
    const alert = alerts.find((a) => alertKey(a) === alertParam)
    return (
      <div className="v2-resp">
        <section className="v2-panel">
          <AlertResponse
            alert={alert}
            event={alert ? events.find((e) => e.id === alert.event_id) : undefined}
            records={records}
            armed={armed}
            now={now}
            onBack={() => setAlertParam(null)}
            onActed={refresh}
          />
        </section>
      </div>
    )
  }

  const auditView = (render: () => ReactElement) =>
    !isAdmin || respondAudit === undefined ? <Empty title={t.auditHidden} /> : respondAudit === null ? <Empty title={t.disarmedTitle}>{t.disarmedHint}</Empty> : render()

  return (
    <div className="v2-resp">
      <div className="v2-resp-summary" role="status">
        <span className="v2-armed" data-armed={synced ? armed : undefined}>
          <i aria-hidden="true" />
          {!synced ? t.checking : armed ? t.armed : t.disarmed}
        </span>
        {armed && respondState && <span className="v2-mono v2-small">{t.summaryArmed(respondState.operators_count)}</span>}
        {isAdmin && respondAudit && <span className="v2-small v2-dim">{t.summaryAudit(counts.ejecutadas, counts.denegadas)}</span>}
      </div>

      <div className="v2-tabs v2-det-tabs" role="tablist" aria-label={t.tabsAria}>
        {RESPOND_TABS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={v === tab} onClick={() => go(v)}>
            {t.tabs[v]}
          </button>
        ))}
      </div>

      <section className="v2-panel v2-det-panel" aria-label={t.tabs[tab]}>
        {tab === 'estado' ? (
          <Readiness state={respondState} synced={synced} records={records} canReadAudit={isAdmin && !!respondAudit} isAdmin={isAdmin} now={now} />
        ) : tab === 'actuar' ? (
          <ActList items={actionable} now={now} onOpen={openAlert} />
        ) : tab === 'registro' ? (
          auditView(() => (
            <ActionLog
              audit={respondAudit!}
              auditLimit={auditLimit}
              onMore={() => setAuditLimit(500)}
              rules={rules}
              alerts={alerts}
              filter={filter}
              onFilter={setFilter}
              q={q}
              onQ={setQ}
              now={now}
              onOpenAlert={openAlert}
            />
          ))
        ) : tab === 'denegaciones' ? (
          auditView(() => <Denials records={records} now={now} />)
        ) : tab === 'contencion' ? (
          <Containment incidents={incidents} available={available} records={records} now={now} onWarRoom={(id) => openCase(id)} />
        ) : tab === 'sala' ? (
          <WarRoom incidents={incidents} available={available} caseId={caseId} onCase={setCaseId} alerts={alerts} records={records} now={now} />
        ) : tab === 'planes' ? (
          <Plans incidents={incidents} available={available} caseId={caseId} onCase={setCaseId} />
        ) : (
          <Metrics records={records} alerts={alerts} incidents={incidents} rules={rules} now={now} />
        )}
      </section>
    </div>
  )
}
