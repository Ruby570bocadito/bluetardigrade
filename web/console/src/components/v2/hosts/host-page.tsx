'use client'

// One machine in full (boceto 3): its status, system, groups, identity and
// risk, and its sections — summary with the events and alerts on one time
// axis, its alerts, its process tree, its connections, its process
// baseline and its sensor. The tree, the timeline and the network reuse
// the lenses of Investigar; anything picked there opens in Investigar.
import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, MagnifyingGlass } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { alertKey } from '@/lib/engine-client'
import { formatDateTime, type SfEvent } from '@/lib/console-types'
import type { YaraStatus } from '@/lib/fleet'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { alertsBySeverity, HOST_TABS, riskLevel, type HostRow, type HostTab } from '@/lib/v2/hosts-model'
import { formatQuery, v2InvestigateLink, type QueryToken } from '@/lib/v2/investigate-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { HostTimeline } from '../investigate/host-timeline'
import { NetworkView } from '../investigate/network-view'
import { ProcessTree } from '../investigate/process-tree'
import { BaselinePanel } from './baseline-panel'
import { StatusPill } from './parts'
import { SensorCard } from './sensor-card'

const SEVS = ['critical', 'high', 'medium', 'low', 'info'] as const

function RiskGauge({ row, rows }: { row: HostRow; rows: HostRow[] }) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const level = riskLevel(row.risk, rows)
  const max = Math.max(0.01, ...rows.map((r) => r.risk ?? 0))
  const f = row.risk === null ? 0 : Math.min(1, row.risk / max)
  const C = 2 * Math.PI * 26
  return (
    <div className="v2-gauge" data-level={level}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="v2-gauge-track" cx="32" cy="32" r="26" />
        <circle className="v2-gauge-fill" cx="32" cy="32" r="26" style={{ strokeDasharray: C, ['--off' as string]: `${C * (1 - f)}`, ['--full' as string]: `${C}` }} transform="rotate(-90 32 32)" />
      </svg>
      <span className="v2-gauge-value v2-mono">{row.risk === null ? '—' : row.risk.toFixed(row.risk < 10 ? 1 : 0)}</span>
      <span className="v2-gauge-label v2-small">
        {t.riskGauge} · {t.riskLevels[level]}
      </span>
    </div>
  )
}

export function HostPage({
  row,
  rows,
  tab,
  onTab,
  onBack,
  engineVersion,
  yara,
  now,
  groupLabel,
  onNotice,
}: {
  row: HostRow
  rows: HostRow[]
  tab: HostTab
  onTab: (t: HostTab) => void
  onBack: () => void
  engineVersion: string | null
  yara: YaraStatus | null
  now: number | null
  groupLabel: (name: string) => string
  onNotice: (m: string) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.hostsView
  const { events, alerts } = useEngine()
  const back = useRef<HTMLButtonElement>(null)
  const host = row.host
  const own = useMemo(() => events.filter((e) => e.host.toLowerCase() === host.toLowerCase()), [events, host])
  const ownAlerts = useMemo(() => alerts.filter((a) => a.host.toLowerCase() === host.toLowerCase()), [alerts, host])
  const bySev = alertsBySeverity(alerts, host)
  const hostToken: QueryToken = { field: 'host', value: host, negate: false }
  const investigate = (more: QueryToken[] = [], mode: 'flujo' | 'arbol' = 'flujo') => v2InvestigateLink(formatQuery([hostToken, ...more], lang), mode)
  const openEvent = (ev: SfEvent) => window.location.assign(`${investigate()}&evento=${encodeURIComponent(ev.id)}`)

  useEffect(() => back.current?.focus(), [host])

  return (
    <div className="v2-hostpage">
      <div className="v2-hostpage-top">
        <button ref={back} type="button" className="v2-btn" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          {t.back}
        </button>
        <a className="v2-btn" href={investigate()}>
          <MagnifyingGlass aria-hidden="true" />
          {t.investigate}
        </a>
      </div>

      <header className="v2-hostpage-head">
        <div className="v2-hostpage-id">
          <h2 className="v2-mono">{host}</h2>
          <StatusPill status={row.status} />
          {!row.inFleet && <p className="v2-dim v2-small">{t.notInFleet}</p>}
        </div>
        <dl className="v2-hostpage-facts">
          <div>
            <dt>{t.facts.os}</dt>
            <dd>{row.sensor?.os ?? '—'}</dd>
          </div>
          <div>
            <dt>{t.facts.groups}</dt>
            <dd>{row.groups.map(groupLabel).join(', ') || t.groupNone}</dd>
          </div>
          <div>
            <dt>{t.facts.identity}</dt>
            <dd className="v2-mono">{row.identity ?? '—'}</dd>
          </div>
          <div>
            <dt>{t.facts.lastSeen}</dt>
            <dd>{row.lastSeen ? formatDateTime(row.lastSeen, lang) : '—'}</dd>
          </div>
        </dl>
        <RiskGauge row={row} rows={rows} />
      </header>

      <div className="v2-tabs" role="tablist" aria-label={t.tabsAria}>
        {HOST_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === tab} onClick={() => onTab(k)}>
            {t.tabs[k]}
            {k === 'alertas' && row.openAlerts > 0 && <b className="v2-mono"> {row.openAlerts}</b>}
          </button>
        ))}
      </div>

      <div className="v2-hostpage-body" key={tab}>
        {tab === 'resumen' && (
          <div className="v2-hostpage-summary">
            <div className="v2-hostpage-kpis">
              <div>
                <span className="v2-dim v2-small">{t.facts.events}</span>
                <b className="v2-mono">{row.events.toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES')}</b>
              </div>
              <div>
                <span className="v2-dim v2-small">{t.facts.events5m}</span>
                <b className="v2-mono">{row.events5m}</b>
              </div>
              <div>
                <span className="v2-dim v2-small">{t.facts.firstSeen}</span>
                <b className="v2-small">{row.firstSeen ? formatDateTime(row.firstSeen, lang) : '—'}</b>
              </div>
              <div className="v2-hostpage-sev">
                <span className="v2-dim v2-small">{t.alertsBySev}</span>
                <span className="v2-sev-row">
                  {SEVS.filter((s) => bySev[s] > 0).map((s) => (
                    <span key={s} className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[s] }}>
                      {dict.alerts.sevLabels[s]} {bySev[s]}
                    </span>
                  ))}
                  {SEVS.every((s) => bySev[s] === 0) && <span className="v2-dim v2-small">—</span>}
                </span>
              </div>
            </div>
            <h3>{t.timelineTitle}</h3>
            {own.length ? <HostTimeline events={own} alerts={alerts} host={host} tokens={[]} selectedId={null} onSelect={openEvent} /> : <Empty title={t.noEvents} />}
          </div>
        )}
        {tab === 'alertas' &&
          (ownAlerts.length === 0 ? (
            <Empty title={t.noAlerts} />
          ) : (
            <ul className="v2-plain-list v2-hostpage-alerts">
              {[...ownAlerts]
                .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.timestamp.localeCompare(a.timestamp))
                .slice(0, 100)
                .map((a) => (
                  <li key={alertKey(a)} data-closed={a.status === 'closed'}>
                    <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                      {dict.alerts.sevLabels[a.severity]}
                    </span>
                    <a href={v2AlertLink(alertKey(a))}>{a.rule_name}</a>
                    <span className="v2-dim v2-small">{formatDateTime(a.timestamp, lang)}</span>
                  </li>
                ))}
            </ul>
          ))}
        {tab === 'procesos' && <ProcessTree events={own} alerts={alerts} host={host} focusPid={null} tokens={[]} selectedId={null} onSelect={openEvent} />}
        {tab === 'red' && <NetworkView events={own} alerts={alerts} onPivot={(tok) => window.location.assign(investigate([tok]))} />}
        {tab === 'linea-base' && <BaselinePanel host={host} now={now} />}
        {tab === 'sensor' && <SensorCard row={row} engineVersion={engineVersion} yara={yara} now={now} onNotice={onNotice} />}
      </div>
    </div>
  )
}
