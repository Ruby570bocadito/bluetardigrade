'use client'

// Fleet pieces of the Equipos view: the summary strip, the status pill of
// each machine, the sensor health card of the host page and the "Añadir
// equipos" dialog (enrollment by token, or the manual identity file).
// Everything is read from the engine inventory (GET /api/fleet) and the
// enrollment state (GET /api/enroll); nothing is sent to a machine.

import { useEffect, useId, useRef, useState } from 'react'
import { Broadcast, CheckCircle, Copy, Cpu, Desktop, Files, Fingerprint, HardDrives, PlugsConnected, Plus, Power, ShieldCheck, Timer, WarningCircle, WifiSlash } from '@phosphor-icons/react'
import { ConsoleDialog } from './console-dialog'
import { StatTile } from './ui-bits'
import { TABLIST_CLASS, tabButtonClass } from './ui-tabs'
import { useFleet } from './fleet-provider'
import { useI18n } from './i18n-provider'
import { EnrollmentRow, TokenEnrollment } from './enroll-parts'
import { enrolledFor } from '@/lib/enroll'
import { enrollmentPlan, fetchYaraStatus, formatDuration, isValidHostName, outdatedCount, outdatedSensor, runModeText, secondsSince, yaraSkew, type FleetHost, type FleetStatus, type YaraStatus } from '@/lib/fleet'
import { formatDateTime } from '@/lib/console-types'
import { useEngine } from './engine-provider'

const STATUS_STYLE: Record<FleetStatus, { dot: string; text: string; ring: string }> = {
  online: { dot: 'bg-emerald-500', text: 'text-emerald-300', ring: 'border-emerald-400/30 bg-emerald-400/10' },
  silent: { dot: 'bg-red-500', text: 'text-red-300', ring: 'border-red-400/40 bg-red-500/10' },
  idle: { dot: 'bg-zinc-500', text: 'text-zinc-400', ring: 'border-white/10 bg-white/[0.03]' },
}

export function FleetStatusPill({ host }: { host?: FleetHost }) {
  const { dict } = useI18n()
  if (!host) {
    return <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500" title={dict.fleet.noInventoryTitle}>{dict.fleet.noInventory}</span>
  }
  const s = STATUS_STYLE[host.status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${s.ring} ${s.text}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot} ${host.status === 'online' ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
      {dict.fleet.status[host.status]}
    </span>
  )
}

/**
 * C-5: chip for a sensor whose build does not match the engine's own
 * (both versions travel in the heartbeat and /api/stats). Renders
 * nothing when the versions match or when either side is unknown —
 * an honest signal never guesses from missing data.
 */
export function SensorVersionChip({ host, engineVersion, className }: { host?: FleetHost; engineVersion?: string; className?: string }) {
  const { dict } = useI18n()
  if (!outdatedSensor(engineVersion, host?.sensor)) return null
  const sensorVersion = host!.sensor!.version!
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-200 ${className ?? ''}`}
      title={dict.fleet.versionChipTitle(sensorVersion, engineVersion!)}
    >
      <WarningCircle size={10} weight="fill" aria-hidden />
      sensor {sensorVersion}
    </span>
  )
}

/** Summary of the inventory with the enrollment entry point. */
export function FleetSummary({ onEnroll }: { onEnroll: () => void }) {
  const { fleet, available, loaded } = useFleet()
  const { stats } = useEngine()
  const { dict } = useI18n()
  const engineVersion = stats?.version
  const withSensor = fleet?.hosts.filter((h) => h.sensor).length ?? 0
  const outdated = fleet ? outdatedCount(fleet.hosts, engineVersion) : 0
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
      <StatTile icon={Desktop} label={dict.fleet.summary.inventoryLabel} value={fleet ? fleet.hosts.length : '—'} hint={!loaded ? dict.fleet.summary.consulting : available ? `${dict.fleet.summary.withSensor(withSensor)}${outdated ? dict.fleet.summary.outdatedSuffix(outdated) : ''}` : dict.fleet.summary.noInventoryHint} warn={outdated > 0} />
      <StatTile icon={PlugsConnected} label={dict.fleet.summary.onlineLabel} value={fleet ? fleet.online : '—'} hint={dict.fleet.summary.onlineHint} />
      <StatTile icon={WifiSlash} label={dict.fleet.summary.silentLabel} value={fleet ? fleet.silent : '—'} hint={fleet?.silent ? dict.fleet.summary.silentHint : dict.fleet.summary.silentNone} warn={(fleet?.silent ?? 0) > 0} />
      <StatTile icon={Timer} label={dict.fleet.summary.idleLabel} value={fleet ? fleet.idle : '—'} hint={dict.fleet.summary.idleHint} />
      <button
        type="button"
        onClick={onEnroll}
        className="panel flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-primary-soft transition-colors hover:border-primary/40 hover:bg-primary-tint/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={16} aria-hidden /> {dict.fleet.summary.add}
      </button>
    </div>
  )
}

/** What the view knows about the engine's YARA pack (GET /api/yara):
 * the last good status, when it was fetched, and whether the latest
 * refresh attempt failed — a failed refresh keeps the last good value
 * and says so instead of staying silent. */
export type YaraStatusState = {
  yara: YaraStatus | null
  /** the latest refresh failed: yara (if any) is the last good value */
  failed: boolean
  /** ISO time of the successful fetch behind yara (null = none yet) */
  asOf: string | null
}

/** The engine's YARA pack status (GET /api/yara), polled at the view
 * level: one request on mount plus one per minute for the whole Equipos
 * view, however many hosts the analyst opens (the pack changes when the
 * operator edits the directory, and the sensor heartbeats follow within
 * a minute). engineCall never rejects — every failure arrives as
 * ok:false and only flips `failed`. */
export function useYaraStatus(): YaraStatusState {
  const [state, setState] = useState<YaraStatusState>({ yara: null, failed: false, asOf: null })
  useEffect(() => {
    let alive = true
    const load = () =>
      fetchYaraStatus().then((res) => {
        if (!alive) return
        if (res.ok) setState({ yara: res.data, failed: false, asOf: new Date().toISOString() })
        else setState((prev) => ({ ...prev, failed: true }))
      })
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return state
}

/** Health of the sensor on one host. The YARA pack state arrives from
 * the view-level poll (props): the card never requests on its own. */
export function SensorCard({ host, yara }: { host?: FleetHost; yara: YaraStatusState }) {
  const { enroll } = useFleet()
  const { stats } = useEngine()
  const { dict, lang } = useI18n()
  const engineVersion = stats?.version
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  if (!host) {
    return (
      <section aria-label={dict.fleet.sensorCard.aria} className="panel px-5 py-4 text-xs text-zinc-500">
        {dict.fleet.sensorCard.notInInventory}
      </section>
    )
  }
  const s = host.sensor
  const beatAgo = secondsSince(s?.last_heartbeat, now)
  const silentFor = secondsSince(host.silent_since, now)
  const skew = s ? yaraSkew(s, yara.yara) : null
  const rows: { icon: React.ElementType; label: string; value: React.ReactNode }[] = [
    { icon: Cpu, label: dict.fleet.sensorCard.rowSensor, value: s ? `${s.kind ?? dict.fleet.sensorCard.kindUnknown}${s.version ? ` · ${s.version}` : ''}` : dict.fleet.sensorCard.noBeat },
    {
      icon: Files,
      label: dict.fleet.yara.rowLabel,
      value: !s || !skew
        ? '—'
        : yara.failed && !yara.yara
          // the poll never got an answer: no pack state is inferred
          ? <span className="text-amber-300">{dict.fleet.yara.queryFailed}</span>
          : <>
              {skew.kind === 'match'
                ? dict.fleet.yara.match(skew.rules)
                : skew.kind === 'stale'
                  ? <span className="text-amber-300">{dict.fleet.yara.stale(skew.rules)}</span>
                  : skew.kind === 'no-report'
                    ? dict.fleet.yara.noReport
                    : dict.fleet.yara.unavailable}
              {yara.failed && (
                <> · <span
                  className="text-amber-300"
                  title={dict.fleet.yara.refreshFailedTitle(yara.asOf ? formatDateTime(yara.asOf, lang) : '—')}
                >{dict.fleet.yara.refreshFailed}</span></>
              )}
            </>,
    },
    { icon: HardDrives, label: dict.fleet.sensorCard.rowOs, value: s?.os || '—' },
    { icon: ShieldCheck, label: dict.fleet.sensorCard.rowCapture, value: s?.capture || host.sources.join(', ') || '—' },
    { icon: Power, label: dict.fleet.sensorCard.rowMode, value: runModeText(s?.run_mode, dict.fleet.modes) },
    { icon: Broadcast, label: dict.fleet.sensorCard.rowLastBeat, value: beatAgo === null ? '—' : dict.fleet.sensorCard.beatAgo(formatDuration(beatAgo), s?.interval_s ?? 60) },
    { icon: Timer, label: dict.fleet.sensorCard.rowUptime, value: s ? formatDuration(s.uptime_s) : '—' },
    { icon: PlugsConnected, label: dict.fleet.sensorCard.rowPeers, value: host.peers.length ? host.peers.join(', ') : '—' },
    { icon: Fingerprint, label: dict.fleet.sensorCard.rowIdentity, value: host.identity || dict.fleet.sensorCard.identityFallback },
  ]
  return (
    <section aria-label={dict.fleet.sensorCard.aria} className="panel overflow-hidden">
      {host.status === 'silent' && (
        <div role="alert" className="flex items-start gap-2 border-b border-red-400/20 bg-red-500/[0.08] px-5 py-3 text-xs text-red-200">
          <WarningCircle size={16} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {dict.fleet.sensorCard.silentPrefix} {silentFor !== null ? dict.fleet.sensorCard.silentFor(formatDuration(silentFor)) : ''}{dict.fleet.sensorCard.silentRest}
          </span>
        </div>
      )}
      {outdatedSensor(engineVersion, s) && (
        <div role="status" className="flex items-start gap-2 border-b border-amber-400/20 bg-amber-400/[0.06] px-5 py-3 text-xs text-amber-200">
          <WarningCircle size={16} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {dict.fleet.sensorCard.outdatedLead}
            <b className="font-semibold">{s!.version}</b>
            {dict.fleet.sensorCard.outdatedBetween}
            <b className="font-semibold">{engineVersion}</b>
            {dict.fleet.sensorCard.outdatedAfter}
            <code className="font-mono">security-sensor.exe</code>
            {dict.fleet.sensorCard.outdatedTail}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <h3 className="text-sm font-medium text-zinc-100">{dict.fleet.sensorCard.title}</h3>
        <FleetStatusPill host={host} />
        <SensorVersionChip host={host} engineVersion={engineVersion} />
        <span className="ml-auto text-[11px] text-zinc-500">{dict.fleet.sensorCard.inInventorySince(formatDateTime(host.first_seen, lang))}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-2.5 px-5 py-4 sm:grid-cols-2">
        {rows.map((row) => (
          // one grouping div: dt/dd stay a direct grouping of the dl; the
          // icon lives inside the dt (decorative)
          <div key={row.label} className="min-w-0">
            <dt className="flex items-start gap-2 text-[11px] text-zinc-500">
              <row.icon size={14} aria-hidden className="mt-0.5 shrink-0" />
              {row.label}
            </dt>
            <dd className="truncate pl-6 text-xs text-zinc-200" title={typeof row.value === 'string' ? row.value : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-3 border-t border-white/[0.06] text-center">
        {[
          { label: dict.fleet.sensorCard.events5m, value: host.events_last_5m },
          // the sensor's counters are cumulative since it started, not the
          // backlog still pending: spooled lines may have been delivered
          // long ago (a sensor that outlived an engine stop replays them)
          { label: dict.fleet.sensorCard.spooled, hint: dict.fleet.sensorCard.countersHint, value: s ? s.spooled : '—', warn: (s?.spooled ?? 0) > 0 },
          { label: dict.fleet.sensorCard.dropped, hint: dict.fleet.sensorCard.countersHint, value: s ? s.dropped : '—', warn: (s?.dropped ?? 0) > 0 },
        ].map((cell) => (
          <div key={cell.label} className="px-3 py-3" title={cell.hint}>
            <p className={`text-lg font-semibold ${cell.warn ? 'text-amber-300' : 'text-zinc-50'}`}>{cell.value}</p>
            <p className="text-[11px] text-zinc-500">{cell.label}</p>
            {cell.hint && <p className="text-[10px] text-zinc-500">{cell.hint}</p>}
          </div>
        ))}
      </div>
      {(() => {
        const record = enrolledFor(enroll, host.host, host.identity)
        return record ? <EnrollmentRow record={record} /> : null
      })()}
    </section>
  )
}

/** The "Añadir equipos" dialog: enrollment by token, or the manual identity file. */
export function EnrollDialog({ onClose }: { onClose: () => void }) {
  const { dict } = useI18n()
  const id = useId()
  const first = useRef<HTMLButtonElement>(null)
  const [tab, setTab] = useState<'token' | 'manual'>('token')
  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first} className="sm:max-w-3xl">
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 id={`${id}-t`} className="text-sm font-semibold text-zinc-100">{dict.fleet.dialog.title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          {dict.fleet.dialog.intro1} {dict.fleet.dialog.intro2}
        </p>
        {/* same tab kit as the detection hub (POL-7); the buttons stay
            plain tab stops so the dialog initial-focus ref keeps working */}
        <div role="tablist" aria-label={dict.fleet.dialog.tabsAria} className={`${TABLIST_CLASS} mt-3`}>
          <button ref={first} type="button" role="tab" aria-selected={tab === 'token'} onClick={() => setTab('token')} className={tabButtonClass(tab === 'token')}>{dict.fleet.dialog.tabToken}</button>
          <button type="button" role="tab" aria-selected={tab === 'manual'} onClick={() => setTab('manual')} className={tabButtonClass(tab === 'manual')}>{dict.fleet.dialog.tabManual}</button>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-5 py-4" role="tabpanel" tabIndex={0}>
        {tab === 'token' ? <TokenEnrollment /> : <ManualEnrollment />}
      </div>
      <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-300 hover:text-zinc-100">{dict.fleet.dialog.close}</button>
      </div>
    </ConsoleDialog>
  )
}

/** Step-by-step manual enrollment: an identity in the identities file. */
function ManualEnrollment() {
  const { dict } = useI18n()
  const [host, setHost] = useState('')
  const [server, setServer] = useState('')
  const [tls, setTls] = useState(true)
  const [copied, setCopied] = useState<number | null>(null)
  const hostOk = isValidHostName(host.trim())
  const serverOk = /^[A-Za-z0-9.-]{1,253}$/.test(server.trim())
  const steps = hostOk && serverOk ? enrollmentPlan(host.trim(), server.trim(), tls, dict.fleet.plan) : []

  async function copy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(index)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {dict.fleet.manual.intro}
      </p>
      <div className="grid gap-3 pb-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-xs text-zinc-400">
          {dict.fleet.manual.hostLabel}
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="PC-CONTA-01" maxLength={15}
            className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
        <label className="text-xs text-zinc-400">
          {dict.fleet.manual.serverLabel}
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="192.168.1.10" maxLength={253}
            className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
          {dict.fleet.manual.tlsLabel}
        </label>
      </div>
      {host && !hostOk && <p className="pb-2 text-[11px] text-amber-300">{dict.fleet.manual.hostError}</p>}
      <div>
        {steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">{dict.fleet.manual.stepsPlaceholder}</p>
        ) : (
          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="flex items-center gap-2 text-[11px] font-medium text-zinc-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-tint/20 text-[10px] text-primary-soft">{i + 1}</span>
                  {dict.fleet.where[step.where]}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{step.text}</p>
                {step.cmd && (
                  <div className="mt-2 flex items-start gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md bg-zinc-950/60 px-2.5 py-2 font-mono text-[11px] text-zinc-200">{step.cmd}</code>
                    <button type="button" onClick={() => void copy(step.cmd!, i)} aria-label={dict.fleet.manual.copyStep(i + 1)}
                      className="shrink-0 rounded-md border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {copied === i ? <CheckCircle size={14} weight="fill" aria-hidden className="text-emerald-400" /> : <Copy size={14} aria-hidden />}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {tls && steps.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            {dict.fleet.manual.tlsNote}
          </p>
        )}
      </div>
    </div>
  )
}
