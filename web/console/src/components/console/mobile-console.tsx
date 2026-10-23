'use client'

// The phone view (app/movil, F3): the console as an installable app for
// whoever is on call. Three tabs and nothing that needs a wide screen —
// the open alerts at or above a severity (acknowledge or close them
// from the card), the open incidents and the machines that went quiet —
// and a link that opens the same record in the full console. Data and
// writes are the full console's own: the engine stream, the incidents
// and fleet providers, and the lifecycle route (the engine proxy signs
// each decision with the session's account and refuses it for viewers).

import { useMemo, useState } from 'react'
import { ArrowSquareOut, Bell, CheckCircle, Desktop, FolderOpen, SquaresFour, X } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useFleet } from './fleet-provider'
import { useIncidents } from './incidents-provider'
import { useI18n } from './i18n-provider'
import { useConsoleUser } from './user-session'
import { BrandMark } from './brand-mark'
import { SEVERITY_STYLE, type SfAlert, type SfAlertStatus } from '@/lib/console-types'
import { postAlertStatus } from '@/lib/lifecycle'
import { formatAgo } from '@/lib/soc-metrics'
import { fullConsoleHref, hostsByAttention, mobileCounts, mobileQueue, openIncidents, MOBILE_MAX_ITEMS, type MobileFloor } from '@/lib/mobile'

type Tab = 'alerts' | 'incidents' | 'hosts'

const tapBtn =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export function MobileConsole() {
  const { dict } = useI18n()
  const t = dict.mobile
  const { status, alerts } = useEngine()
  const { incidents } = useIncidents()
  const { fleet } = useFleet()
  const [tab, setTab] = useState<Tab>('alerts')
  const [floor, setFloor] = useState<MobileFloor>('high')

  const counts = useMemo(() => mobileCounts(alerts), [alerts])
  const openInc = useMemo(() => openIncidents(incidents), [incidents])
  const live = status === 'live'

  const tabs: { id: Tab; icon: React.ElementType; badge: number; tone: string }[] = [
    { id: 'alerts', icon: Bell, badge: counts.critical, tone: 'bg-red-500/90 text-white' },
    { id: 'incidents', icon: FolderOpen, badge: openInc.length, tone: 'bg-amber-400/90 text-zinc-950' },
    { id: 'hosts', icon: Desktop, badge: fleet?.silent ?? 0, tone: 'bg-red-500/90 text-white' },
  ]

  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-950 text-zinc-100">
      <header className="sidebar-shell theme-island-dark sticky top-0 z-20 border-b border-white/[0.06] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <BrandMark size={32} live={live} className="shrink-0" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{t.subtitle}</p>
            <h1 className="truncate text-base font-semibold text-zinc-50">{t.title}</h1>
          </div>
          <span className="chip shrink-0 px-2 py-1 text-[11px] text-zinc-300">
            <span aria-hidden className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {live ? t.live : t.offline}
          </span>
          <a href="/" aria-label={t.fullConsole} title={t.fullConsole} className="chip shrink-0 p-2 text-zinc-300 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <SquaresFour size={18} aria-hidden />
          </a>
        </div>
      </header>

      <main id="console-main" className="flex-1 px-3 pb-28 pt-3">
        {tab === 'alerts' && <AlertsTab floor={floor} setFloor={setFloor} counts={counts} />}
        {tab === 'incidents' && <IncidentsTab />}
        {tab === 'hosts' && <HostsTab />}
        <p className="mt-6 px-2 text-center text-[11px] leading-relaxed text-zinc-500">{t.installHint}</p>
      </main>

      <nav aria-label={t.tabsAria} className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.08] bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <ul className="mx-auto grid max-w-xl grid-cols-3">
          {tabs.map(({ id, icon: Icon, badge, tone }) => {
            const current = tab === id
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={current ? 'page' : undefined}
                  className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${current ? 'text-primary' : 'text-zinc-400'}`}
                >
                  <span className="relative">
                    <Icon size={22} weight={current ? 'fill' : 'regular'} aria-hidden />
                    {badge > 0 && <span className={`absolute -right-3 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[18px] tabular-nums ${tone}`}>{badge > 99 ? '99+' : badge}</span>}
                  </span>
                  {t.tabs[id]}
                  {current && <span aria-hidden className="absolute inset-x-8 top-0 h-0.5 rounded-b-full bg-primary" />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

function AlertsTab({ floor, setFloor, counts }: { floor: MobileFloor; setFloor: (f: MobileFloor) => void; counts: Record<MobileFloor, number> }) {
  const { dict } = useI18n()
  const t = dict.mobile
  const me = useConsoleUser()
  const { alerts } = useEngine()
  const queue = useMemo(() => mobileQueue(alerts, floor), [alerts, floor])
  const floors: MobileFloor[] = ['critical', 'high', 'all']
  return (
    <section aria-label={t.tabs.alerts}>
      <div role="group" aria-label={t.floorsAria} className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {floors.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFloor(f)}
            aria-pressed={floor === f}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${floor === f ? 'border-primary/50 bg-primary-tint/20 text-zinc-50' : 'border-zinc-800 text-zinc-400'}`}
          >
            {t.floors[f]} <span className="tabular-nums text-zinc-500">{counts[f]}</span>
          </button>
        ))}
      </div>
      {!me.can_triage && <p className="mb-3 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400">{t.readOnly}</p>}
      {queue.length === 0 ? (
        <p className="panel px-4 py-8 text-center text-sm text-zinc-400">{t.noAlerts}</p>
      ) : (
        <ul className="space-y-2.5">
          {queue.map((a) => (
            <AlertCard key={a.id} alert={a} canTriage={me.can_triage} />
          ))}
        </ul>
      )}
      {queue.length >= MOBILE_MAX_ITEMS && <p className="mt-3 text-center text-[11px] text-zinc-500">{t.more(MOBILE_MAX_ITEMS)}</p>}
    </section>
  )
}

function AlertCard({ alert, canTriage }: { alert: SfAlert; canTriage: boolean }) {
  const { dict, lang } = useI18n()
  const t = dict.mobile
  const { applyTriage } = useEngine()
  const [busy, setBusy] = useState<SfAlertStatus | null>(null)
  const [error, setError] = useState('')
  const sev = SEVERITY_STYLE[alert.severity]
  const acked = alert.status === 'acknowledged'

  const decide = async (next: SfAlertStatus) => {
    setBusy(next)
    setError('')
    const ack = await postAlertStatus({ alert_id: alert.id!, status: next, by: 'consola' })
    setBusy(null)
    if (!ack.ok) {
      setError(ack.error)
      return
    }
    if (ack.entry) applyTriage(ack.entry)
  }

  return (
    <li className="panel overflow-hidden">
      <div className={`h-1 ${sev.bar}`} aria-hidden />
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`rounded-md border px-1.5 py-0.5 font-medium ${sev.text} ${sev.bg} ${sev.border}`}>{dict.alerts.sevLabels[alert.severity]}</span>
          {acked && <span className="rounded-md border border-sky-400/30 bg-sky-500/10 px-1.5 py-0.5 text-sky-300">{t.acked}</span>}
          <span className="ml-auto tabular-nums text-zinc-500">{formatAgo(Date.now() - Date.parse(alert.timestamp), lang)}</span>
        </div>
        <h2 className="mt-2 text-[15px] font-semibold leading-snug text-zinc-50">{alert.rule_name}</h2>
        <p className="mt-0.5 font-mono text-xs text-zinc-300">{alert.host}{alert.user ? ` · ${alert.user}` : ''}</p>
        {alert.summary && <p className="mt-1.5 line-clamp-2 break-words font-mono text-[11px] leading-relaxed text-zinc-500">{alert.summary}</p>}
        <div className="mt-3 flex gap-2">
          {canTriage && !acked && (
            <button type="button" disabled={busy !== null} onClick={() => void decide('acknowledged')} aria-label={t.actionAria(t.ack, alert.rule_name)} className={`${tapBtn} flex-1 border border-zinc-700 text-zinc-100`}>
              <CheckCircle size={16} aria-hidden /> {busy === 'acknowledged' ? '…' : t.ack}
            </button>
          )}
          {canTriage && (
            <button type="button" disabled={busy !== null} onClick={() => void decide('closed')} aria-label={t.actionAria(t.close, alert.rule_name)} className={`${tapBtn} flex-1 bg-primary-strong text-white hover:bg-primary-tint`}>
              <X size={16} aria-hidden /> {busy === 'closed' ? '…' : t.close}
            </button>
          )}
          <a href={fullConsoleHref('alert', alert.id!)} aria-label={t.openFull} title={t.openFull} className={`${tapBtn} border border-zinc-800 text-zinc-300`}>
            <ArrowSquareOut size={16} aria-hidden />
          </a>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
    </li>
  )
}

function IncidentsTab() {
  const { dict, lang } = useI18n()
  const t = dict.mobile
  const { incidents } = useIncidents()
  const list = useMemo(() => openIncidents(incidents), [incidents])
  if (list.length === 0) return <p className="panel px-4 py-8 text-center text-sm text-zinc-400">{t.noIncidents}</p>
  return (
    <ul className="space-y-2.5" aria-label={t.tabs.incidents}>
      {list.map((inc) => {
        const sev = SEVERITY_STYLE[inc.severity]
        return (
          <li key={inc.id}>
            <a href={fullConsoleHref('incident', inc.id)} className="panel block px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={`rounded-md border px-1.5 py-0.5 font-medium ${sev.text} ${sev.bg} ${sev.border}`}>{dict.alerts.sevLabels[inc.severity]}</span>
                <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-zinc-300">{dict.incidents.statusLabels[inc.status]}</span>
                <span className="ml-auto tabular-nums text-zinc-500">{formatAgo(Date.now() - Date.parse(inc.updated_at), lang)}</span>
              </div>
              <h2 className="mt-2 text-[15px] font-semibold leading-snug text-zinc-50">{inc.title}</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                {t.incidentMeta(inc.alert_ids.length, inc.hosts.length)}
                {inc.owner ? ` · ${inc.owner}` : ''}
              </p>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function HostsTab() {
  const { dict, lang } = useI18n()
  const t = dict.mobile
  const { fleet } = useFleet()
  const hosts = useMemo(() => hostsByAttention(fleet), [fleet])
  if (!fleet || hosts.length === 0) return <p className="panel px-4 py-8 text-center text-sm text-zinc-400">{t.noHosts}</p>
  const tone = { silent: 'text-red-300 border-red-400/30 bg-red-500/10', idle: 'text-amber-300 border-amber-400/30 bg-amber-500/10', online: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10' }
  return (
    <section aria-label={t.tabs.hosts}>
      <p className="mb-3 px-1 text-xs text-zinc-400">{t.hostsSummary(fleet.online, fleet.silent, fleet.idle)}</p>
      <ul className="panel divide-y divide-white/[0.06]">
        {hosts.map((h) => (
          <li key={h.host}>
            <a href={fullConsoleHref('host', h.host)} className="flex min-h-14 items-center gap-3 px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <Desktop size={18} aria-hidden className="shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm text-zinc-100">{h.host}</span>
                <span className="block text-[11px] text-zinc-500">{formatAgo(Date.now() - Date.parse(h.last_seen), lang)}</span>
              </span>
              <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${tone[h.status]}`}>{t.hostStatus[h.status]}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
