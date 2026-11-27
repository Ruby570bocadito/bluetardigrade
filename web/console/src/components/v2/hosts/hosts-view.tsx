'use client'

// v2 · Equipos: the fleet. A summary strip, then the fleet seen as an
// inventory, a risk map, the sensors' heartbeats, the groups, the
// relationships between machines and the enrollment of new ones; and one
// machine in full when it is opened. A machine that goes silent while the
// page is open is announced at the top. View, open machine, its section
// and the filters live in the URL (vista, equipo, pestana, estado, grupo, q).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { fetchYaraStatus, formatDuration, type YaraStatus } from '@/lib/fleet'
import { fetchHostGroups, type HostGroupsPayload } from '@/lib/host-groups'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import {
  filterRows,
  fleetSummary,
  HOST_VIEWS,
  hostRows,
  hostsViewFromParam,
  hostTabFromParam,
  statusFilterFromParam,
  type HostRow,
  type HostsView as View,
  type HostTab,
  type StatusFilter,
} from '@/lib/v2/hosts-model'
import { Toast, type ToastState } from '../alerts/toast'
import { Empty } from '../home/parts'
import { useNow } from '../use-now'
import { EnrollPanel } from './enroll-panel'
import { GroupsBoard } from './groups-board'
import { HostPage } from './host-page'
import { Inventory } from './inventory'
import { RelationsGraph } from './relations-graph'
import { RiskMap } from './risk-map'
import { SilentHosts } from './silent-hosts'

const STATUSES: StatusFilter[] = ['all', 'online', 'silent', 'idle', 'unknown']

export function HostsView() {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const { alerts, events, stats } = useEngine()
  const { fleet, enroll, available, loaded } = useFleet()
  const now = useNow(1000)

  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('inventario')
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useState<HostTab>('resumen')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [group, setGroup] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [yara, setYara] = useState<YaraStatus | null>(null)
  const [groups, setGroups] = useState<HostGroupsPayload | null>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    const apply = () => {
      const p = new URLSearchParams(currentSearch())
      setView(hostsViewFromParam(p.get('vista')))
      setOpen(p.get('equipo'))
      setTab(hostTabFromParam(p.get('pestana')))
      setStatus(statusFilterFromParam(p.get('estado')))
      setGroup(p.has('grupo') ? (p.get('grupo') ?? '') : null)
      setQ(p.get('q') ?? '')
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return
    replaceOperatorState((search) => {
      let s = setSearchParam(search, 'vista', view === 'inventario' ? null : view)
      s = setSearchParam(s, 'equipo', open)
      s = setSearchParam(s, 'pestana', open && tab !== 'resumen' ? tab : null)
      s = setSearchParam(s, 'estado', status === 'all' ? null : status)
      s = setSearchParam(s, 'grupo', group)
      return setSearchParam(s, 'q', q || null)
    })
  }, [ready, view, open, tab, status, group, q])

  // the YARA pack and the groups change rarely: read once, the pack again every minute
  useEffect(() => {
    let alive = true
    const read = () => void fetchYaraStatus().then((r) => alive && setYara(r.ok ? r.data : null))
    read()
    const id = window.setInterval(read, 60_000)
    void fetchHostGroups().then((r) => alive && setGroups(r.ok ? r.data : null))
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const rows = useMemo(() => hostRows(fleet, stats?.hot_hosts ?? [], alerts, events), [fleet, stats, alerts, events])
  const summary = fleetSummary(rows, stats?.version)
  const filtered = useMemo(() => filterRows(rows, { q, status, group }), [rows, q, status, group])
  const labels = useMemo(() => new Map((groups?.groups ?? []).map((g) => [g.name, g.label || g.name])), [groups])
  const groupLabel = useCallback((name: string) => labels.get(name) ?? name, [labels])
  const groupNames = useMemo(() => [...new Set([...(groups?.groups ?? []).map((g) => g.name), ...rows.flatMap((r) => r.groups)])], [groups, rows])
  const notice = useCallback((message: string) => setToast({ id: Date.now(), message }), [])

  // a machine that goes silent while the page is open is announced
  const known = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!fleet) return undefined
    const current = new Map(fleet.hosts.map((h) => [h.host, h.status as string]))
    const before = known.current
    known.current = current
    if (!before) return undefined
    const fresh = fleet.hosts.find((h) => h.status === 'silent' && before.has(h.host) && before.get(h.host) !== 'silent')
    if (!fresh) return undefined
    setBanner(fresh.host)
    const id = window.setTimeout(() => setBanner(null), 15_000)
    return () => window.clearTimeout(id)
  }, [fleet])

  const openHost = (host: string) => {
    setOpen(host)
    setTab('resumen')
    window.scrollTo({ top: 0 })
  }

  const selected: HostRow | null = open
    ? (rows.find((r) => r.host.toLowerCase() === open.toLowerCase()) ?? {
        host: open, status: 'unknown', events: 0, events5m: 0, groups: [], peers: [], risk: null, openAlerts: 0, worst: null, inFleet: false,
      })
    : null
  const bannerRow = banner ? rows.find((r) => r.host === banner) : undefined
  const bannerAge = bannerRow?.sensor?.last_heartbeat && now !== null ? formatDuration((now - Date.parse(bannerRow.sensor.last_heartbeat)) / 1000) : null

  const bannerEl = banner && (
    <div className="v2-banner v2-hosts-banner" role="status">
      <span>{t.banner(banner, bannerAge ?? '')}</span>
      <button
        type="button"
        className="v2-link"
        onClick={() => {
          openHost(banner)
          setTab('sensor')
          setBanner(null)
        }}
      >
        {t.bannerOpen}
      </button>
    </div>
  )

  if (selected)
    return (
      <div className="v2-hosts">
        {bannerEl}
        <section className="v2-panel">
          <HostPage
            row={selected}
            rows={rows}
            tab={tab}
            onTab={setTab}
            onBack={() => setOpen(null)}
            engineVersion={stats?.version ?? null}
            yara={yara}
            now={now}
            groupLabel={groupLabel}
            onNotice={notice}
          />
        </section>
        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    )

  const filters = view === 'inventario' || view === 'riesgo'

  return (
    <div className="v2-hosts">
      {bannerEl}
      <div className="v2-hosts-summary" role="status">
        <b className="v2-mono">{t.summary.total(summary.total)}</b>
        <button type="button" className="v2-hsum" data-status="online" onClick={() => setStatus(status === 'online' ? 'all' : 'online')} aria-pressed={status === 'online'}>
          <i aria-hidden="true" />
          <span key={summary.online} className="v2-tick">
            {t.summary.online(summary.online)}
          </span>
        </button>
        <button type="button" className="v2-hsum" data-status="silent" onClick={() => setStatus(status === 'silent' ? 'all' : 'silent')} aria-pressed={status === 'silent'}>
          <i aria-hidden="true" />
          <span key={summary.silent} className="v2-tick">
            {t.summary.silent(summary.silent)}
          </span>
        </button>
        <button type="button" className="v2-hsum" data-status="idle" onClick={() => setStatus(status === 'idle' ? 'all' : 'idle')} aria-pressed={status === 'idle'}>
          <i aria-hidden="true" />
          <span key={summary.idle} className="v2-tick">
            {t.summary.idle(summary.idle)}
          </span>
        </button>
        {summary.atRisk > 0 && <span className="v2-hsum-note">{t.summary.atRisk(summary.atRisk)}</span>}
        {summary.outdated > 0 && <span className="v2-hsum-note">{t.summary.outdated(summary.outdated)}</span>}
        {(enroll?.pending ?? 0) > 0 && (
          <button type="button" className="v2-link" onClick={() => setView('alta')}>
            {t.summary.pending(enroll!.pending)}
          </button>
        )}
      </div>

      <div className="v2-hosts-bar">
        <div className="v2-tabs" role="tablist" aria-label={t.viewsAria}>
          {HOST_VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={v === view} onClick={() => setView(v)}>
              {t.views[v]}
            </button>
          ))}
        </div>
        {enroll?.enabled && (
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => setView('alta')}>
            <Plus aria-hidden="true" />
            {t.addMachines}
          </button>
        )}
      </div>

      <section className="v2-panel v2-hosts-panel" aria-label={t.views[view]}>
        {filters && (
          <div className="v2-hosts-filters">
            <label className="v2-search">
              <MagnifyingGlass aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />
            </label>
            <div className="v2-chips" role="group" aria-label={t.statusAria}>
              {STATUSES.filter((s) => s === 'all' || s === status || rows.some((r) => r.status === s)).map((s) => (
                <button key={s} type="button" className="v2-chip-btn" data-status={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {s === 'all' ? t.statusAll : t.status[s]}
                </button>
              ))}
            </div>
            {groupNames.length > 0 && (
              <label className="v2-select">
                <span className="v2-sr-only">{t.groupAria}</span>
                <select value={group === null ? '_all' : group === '' ? '_none' : group} onChange={(e) => setGroup(e.target.value === '_all' ? null : e.target.value === '_none' ? '' : e.target.value)}>
                  <option value="_all">{t.groupAll}</option>
                  {groupNames.map((g) => (
                    <option key={g} value={g}>
                      {groupLabel(g)}
                    </option>
                  ))}
                  <option value="_none">{t.groupNone}</option>
                </select>
              </label>
            )}
          </div>
        )}
        {loaded && !available && rows.length === 0 ? (
          <Empty title={t.noFleet}>{t.noFleetHint}</Empty>
        ) : view === 'inventario' ? (
          <Inventory rows={filtered} allRows={rows} events={events} now={now} groupLabel={groupLabel} onOpen={openHost} />
        ) : view === 'riesgo' ? (
          <RiskMap rows={filtered} groupOrder={(groups?.groups ?? []).map((g) => g.name)} groupLabel={groupLabel} onOpen={openHost} />
        ) : view === 'silenciosos' ? (
          <SilentHosts rows={rows} now={now} minGraceS={fleet?.heartbeat_grace_min_s ?? 180} onOpen={openHost} />
        ) : view === 'grupos' ? (
          <GroupsBoard payload={groups} rows={rows} onSaved={setGroups} onNotice={notice} onOpen={openHost} />
        ) : view === 'relaciones' ? (
          <RelationsGraph rows={rows} events={events} alerts={alerts} onOpen={openHost} />
        ) : (
          <EnrollPanel onNotice={notice} />
        )}
      </section>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
