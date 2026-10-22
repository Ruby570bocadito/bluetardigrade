'use client'

// AD-5 — «Directorio activo»: read-only view over the engine's AD
// surface (-ad). The connector strip shows the sync state the engine
// publishes; the posture panel renders the frozen analysis (score,
// findings donut, trend, findings detail); the explorer pages through
// the snapshot objects. An unarmed engine answers 501 and the page
// renders the honest «no armado» state with the engine's own hint —
// never a fabricated directory. Engine prose (finding titles,
// descriptions, remediations) travels verbatim: it is data, not chrome.

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowClockwise,
  ChartLineUp,
  ChartPie,
  Desktop,
  FolderOpen,
  Key,
  MagnifyingGlass,
  PlugsConnected,
  TreeStructure,
  UserCircle,
  UsersThree,
  Warning,
} from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useFleet } from './fleet-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, SkeletonRows } from './ui-bits'
import { ConsoleTablist } from './ui-tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeadRow, TableHeader, TableRow } from '@/components/ui/table'
import { ChartCard } from '@/components/charts/chart-frame'
import { DonutChart } from '@/components/charts/donut'
import { Meter } from '@/components/charts/bars'
import { LineChart, type LineSlot } from '@/components/charts/line-chart'
import { SEV_COLOR, SEV_ICON } from '@/components/charts/severity'
import { formatDateTime } from '@/lib/console-types'
import { buildDonut } from '@/lib/donut'
import {
  adKind,
  adPageSize,
  AD_DEFAULT_PAGE_SIZE,
  AD_PAGE_SIZES,
  AD_KINDS,
  coverageFrom,
  fetchADObjects,
  fetchADPosture,
  fetchADPostureHistory,
  fetchADStatus,
  findingById,
  PRIVILEGED_FINDING_ID,
  scoreTone,
  severityEntries,
  uacFlagLabels,
  type ADFinding,
  type ADKind,
  type ADObject,
  type ADObjectsPage,
  type ADPosture,
  type ADPosturePoint,
  type ADStatus,
} from '@/lib/directory'

const KIND_TABS: { kind: ADKind; icon: React.ElementType }[] = [
  { kind: 'user', icon: UserCircle },
  { kind: 'group', icon: UsersThree },
  { kind: 'computer', icon: Desktop },
  { kind: 'ou', icon: FolderOpen },
]

const TONE_COLOR: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'var(--status-good)',
  warn: 'var(--status-warning)',
  bad: 'var(--status-critical)',
}

function unixToText(sec: number, neverKnown: string): string {
  if (!sec) return neverKnown
  try {
    return new Date(sec * 1000).toLocaleString('es-ES', { hour12: false })
  } catch {
    return String(sec)
  }
}

/** One finding as an expandable row: severity-marked summary, engine text verbatim. */
function FindingItem({ finding }: { finding: ADFinding }) {
  const { dict } = useI18n()
  const { id, title, severity, description, remediation, count, objects, objects_truncated: truncated } = finding
  const Icon = SEV_ICON[severity as keyof typeof SEV_ICON] ?? Warning
  const color = SEV_COLOR[severity as keyof typeof SEV_COLOR] ?? 'var(--sev-info)'
  return (
    <details className="group border-b border-zinc-800/60 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-xs transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Icon size={15} weight="fill" aria-hidden style={{ color }} />
        <span className="min-w-0 flex-1 truncate text-zinc-200" title={title}>{title}</span>
        <span className="shrink-0 rounded border border-zinc-700/70 px-1.5 py-0.5 tabular-nums text-zinc-400">{count}</span>
      </summary>
      <div className="border-t border-zinc-800/40 px-4 py-3">
        {description && <p className="max-w-[90ch] text-xs leading-relaxed text-zinc-400">{description}</p>}
        {remediation && (
          <p className="mt-2 max-w-[90ch] text-xs leading-relaxed text-zinc-300">
            <span className="font-medium text-zinc-100">{dict.directory.remediationLabel}</span>{remediation}
          </p>
        )}
        {objects.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <Table className="min-w-[560px] text-xs">
              <TableCaption>{dict.directory.affectedCaption}</TableCaption>
              <TableHeader>
                <TableHeadRow className="border-b border-zinc-800/60">
                  <TableHead className="py-1.5 pr-3">{dict.directory.affectedCols.object}</TableHead>
                  <TableHead className="py-1.5 pr-3">{dict.directory.affectedCols.dn}</TableHead>
                  <TableHead className="py-1.5">{dict.directory.affectedCols.detail}</TableHead>
                </TableHeadRow>
              </TableHeader>
              <TableBody className="divide-zinc-800/40">
                {objects.map((o) => (
                  <TableRow key={o.dn}>
                    <TableCell className="py-1.5 pr-3 font-medium text-zinc-200">{o.name || '—'}</TableCell>
                    <TableCell className="max-w-[260px] truncate py-1.5 pr-3 font-mono text-[11px] text-zinc-500" title={o.dn}>{o.dn}</TableCell>
                    <TableCell className="py-1.5 text-zinc-400">{o.detail || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {truncated && (
              <p className="mt-2 text-[11px] text-zinc-600">{dict.directory.truncatedList}</p>
            )}
          </div>
        )}
      </div>
    </details>
  )
}

/** The snapshot explorer: kind tabs, free-text search, real pagination. */
function ObjectExplorer() {
  const { dict } = useI18n()
  const [kind, setKind] = useState<ADKind>('user')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(AD_DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<ADObjectsPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // commit the search 300 ms after the last keystroke
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 300)
    return () => clearTimeout(t)
  }, [queryInput])
  useEffect(() => { setPage(0) }, [kind, query, pageSize])

  useEffect(() => {
    let alive = true
    setLoading(true)
    void fetchADObjects(kind, query, pageSize, page * pageSize).then((res) => {
      if (!alive) return
      setLoading(false)
      if (res.ok) { setData(res.data); setError('') }
      else setError(res.error)
    })
    return () => { alive = false }
  }, [kind, query, pageSize, page])

  const total = data?.total ?? 0
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)

  return (
    <div className="panel overflow-hidden">
      <div className="panel-head flex-wrap gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <TreeStructure size={16} aria-hidden className="text-zinc-500" />
          {dict.directory.explorer.title}
        </span>
        <span className="text-[11px] text-zinc-600">{dict.directory.explorer.headHint}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 px-4 py-2.5">
        <ConsoleTablist
          tabs={KIND_TABS.map(({ kind: k, icon }) => ({ id: k, label: dict.directory.kinds[k], icon }))}
          value={kind}
          onSelect={setKind}
          ariaLabel={dict.directory.explorer.kindAria}
          idPrefix="ad-kind"
        />
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlass size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-zinc-600" />
          <Input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder={dict.directory.explorer.searchPlaceholder}
            aria-label={dict.directory.explorer.searchAria(dict.directory.kinds[kind])}
            className="h-8 rounded-lg pl-8 pr-3 text-xs"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500" htmlFor="ad-page-size">
          {dict.directory.explorer.pageSize}
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(adPageSize(Number(v)))}>
            <SelectTrigger id="ad-page-size" className="h-8 w-16 rounded-md px-1.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AD_PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      </div>

      {error ? (
        <div className="px-4 py-8">
          <EmptyState icon={TreeStructure} title={dict.directory.explorer.snapshotDownTitle} hint={`${error}${dict.directory.explorer.snapshotDownHintB}`} />
        </div>
      ) : loading ? (
        <SkeletonRows rows={6} className="px-4 py-2" />
      ) : !data || data.objects.length === 0 ? (
        <div className="px-4 py-8">
          <EmptyState
            icon={TreeStructure}
            title={query ? dict.directory.explorer.noMatchesTitle : dict.directory.explorer.emptyTitle}
            hint={query ? dict.directory.explorer.noMatchesHint : dict.directory.explorer.emptyHint}
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="min-w-[640px] text-xs">
              <TableCaption>{dict.directory.explorer.tableCaption}</TableCaption>
              <TableHeader>
                <TableHeadRow className="border-b border-zinc-800/60">
                  <TableHead className="px-4 py-2">{dict.directory.explorer.cols.name}</TableHead>
                  <TableHead className="px-4 py-2">{dict.directory.explorer.cols.detail}</TableHead>
                  <TableHead className="px-4 py-2">{dict.directory.explorer.cols.changed}</TableHead>
                </TableHeadRow>
              </TableHeader>
              <TableBody className="divide-zinc-800/40">
                {data.objects.map((o) => <ObjectRow key={o.dn} obj={o} />)}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/60 px-4 py-2.5 text-[11px] text-zinc-500">
            <span className="tabular-nums">{dict.directory.explorer.range(from, to, total.toLocaleString('es-ES'))}</span>
            <span className="flex gap-1.5">
              <Button type="button" variant="ghost" size="sm" className="px-2.5 text-xs text-zinc-300" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                {dict.directory.explorer.prev}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="px-2.5 text-xs text-zinc-300" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
                {dict.directory.explorer.next}
              </Button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function ObjectRow({ obj }: { obj: ADObject }) {
  const { dict } = useI18n()
  const flags = uacFlagLabels(obj.user_account_control, dict.directory.flags)
  const details: string[] = []
  if (obj.kind === 'user') {
    const upn = obj.attributes?.userPrincipalName
    if (upn) details.push(upn)
    if (obj.spn_count > 0) details.push(`${obj.spn_count} SPN`)
    details.push(`${dict.directory.pwdLabel}${unixToText(obj.pwd_last_set_unix, dict.directory.neverKnown)}`)
    details.push(`${dict.directory.lastLogon}${unixToText(obj.last_logon_unix, dict.directory.neverKnown)}`)
  } else if (obj.kind === 'group') {
    const members = obj.attributes?.member_count
    if (members !== undefined) details.push(dict.directory.members(members))
    if (obj.admin_count > 0) details.push('adminCount=1')
    const desc = obj.attributes?.description
    if (desc) details.push(desc)
  } else if (obj.kind === 'computer') {
    if (obj.os) details.push(obj.os)
    const dns = obj.attributes?.dNSHostName
    if (dns) details.push(dns)
    details.push(`${dict.directory.lastLogon}${unixToText(obj.last_logon_unix, dict.directory.neverKnown)}`)
  } else {
    const desc = obj.attributes?.description
    if (desc) details.push(desc)
    details.push(obj.dn)
  }
  return (
    <tr className="transition-colors hover:bg-white/[0.02]">
      <td className="max-w-[220px] px-4 py-2">
        <span className="block truncate font-medium text-zinc-200" title={obj.name}>{obj.name}</span>
        {flags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {flags.map((f) => (
              <span key={f} className="rounded border border-amber-400/30 bg-amber-400/10 px-1 py-px text-[10px] text-amber-200">{f}</span>
            ))}
          </span>
        )}
        {obj.kind !== 'group' && obj.kind !== 'ou' && obj.admin_count > 0 && (
          <span className="mt-1 inline-block rounded border border-zinc-600/60 px-1 py-px text-[10px] text-zinc-300">adminCount=1</span>
        )}
      </td>
      <td className="max-w-[320px] px-4 py-2 text-zinc-500">
        {details.map((d, i) => <span key={i} className="block truncate" title={d}>{d}</span>)}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-zinc-500">{unixToText(obj.when_changed_unix, dict.directory.neverKnown)}</td>
    </tr>
  )
}

function SyncRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <dt className="min-w-0 truncate text-xs text-zinc-400">{label}</dt>
      <dd className="shrink-0 text-xs font-medium tabular-nums text-zinc-200">{text}</dd>
    </div>
  )
}

type LoadState = 'loading' | 'unarmed' | 'error' | 'ok'

export function DirectoryView() {
  const { dict } = useI18n()
  const { fleet } = useFleet()
  const [status, setStatus] = useState<ADStatus | null>(null)
  const [posture, setPosture] = useState<ADPosture | null>(null)
  const [history, setHistory] = useState<ADPosturePoint[] | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [errorText, setErrorText] = useState('')
  const [hint, setHint] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const refresh = useCallback(() => setReloadTick((t) => t + 1), [])

  useEffect(() => {
    let alive = true
    setState((s) => (s === 'ok' ? 'ok' : 'loading'))
    void (async () => {
      const [st, po] = await Promise.all([fetchADStatus(), fetchADPosture()])
      if (!alive) return
      if (!st.ok && st.status === 501) { setHint(st.error); setState('unarmed'); return }
      if (!po.ok && po.status === 501) { setHint(po.error); setState('unarmed'); return }
      if (!st.ok) { setErrorText(st.error); setState('error'); return }
      if (!po.ok) { setErrorText(po.error); setState('error'); return }
      setStatus(st.data)
      setPosture(po.data)
      setState('ok')
      if (po.data.ready) {
        const hi = await fetchADPostureHistory(100)
        if (alive && hi.ok) setHistory(hi.data.points)
        else if (alive) setHistory([])
      }
    })()
    return () => { alive = false }
  }, [reloadTick])

  const findings = posture?.ready ? posture.findings : []
  const privileged = findingById(findings, PRIVILEGED_FINDING_ID)
  const donutEntries = severityEntries(posture?.summary ?? {}, dict.directory.sevLabels)
  const donutModel = buildDonut(donutEntries, { maxNamed: 4 })
  const trendSlots: LineSlot[] = (history ?? [])
    .slice()
    .map((p) => ({ t: p.at * 1000, values: { score: p.score } }))
  const score = posture?.ready ? posture.score ?? 0 : 0

  return (
    <section aria-label={dict.views.directorio.title}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-zinc-100">{dict.views.directorio.title}</h1>
          <p className="mt-0.5 text-xs text-zinc-500">{dict.directory.hint}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={refresh} aria-busy={state === 'loading'} disabled={state === 'loading'}
          className="px-2.5 text-xs text-zinc-300 disabled:cursor-wait">
          <ArrowClockwise size={13} aria-hidden className={state === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} />
          {dict.directory.refresh}
        </Button>
      </div>

      <p className="mt-3 max-w-[80ch] text-xs leading-relaxed text-zinc-500">
        {dict.directory.prose}
      </p>

      {state === 'unarmed' && (
        <div className="panel mt-5 px-4 py-10">
          <EmptyState
            icon={PlugsConnected}
            title={dict.directory.unarmedTitle}
            hint={`${hint}${dict.directory.unarmedHintB}`}
          />
        </div>
      )}

      {state === 'error' && (
        <div className="panel mt-5 px-4 py-10">
          <EmptyState icon={PlugsConnected} title={dict.directory.errorTitle} hint={`${errorText}${dict.directory.errorHintB}`} />
        </div>
      )}

      {state === 'loading' && (
        <div className="panel mt-5 px-4 py-4">
          <SkeletonRows rows={6} />
        </div>
      )}

      {state === 'ok' && status && posture && (
        <div className="mt-5 space-y-5">
          {/* connector strip: the engine's own sync state, verbatim */}
          <div className="panel overflow-hidden">
            <div className="panel-head flex-wrap gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <PlugsConnected size={16} aria-hidden className="text-zinc-500" />
                {dict.directory.connector.title}
              </span>
              <span className={'flex items-center gap-1.5 text-[11px] ' + (status.connected ? 'text-emerald-300' : 'text-red-300')}>
                <span aria-hidden className={'inline-block h-1.5 w-1.5 rounded-full ' + (status.connected ? 'bg-emerald-400' : 'bg-red-400')} />
                {status.connected ? dict.directory.connector.connected : dict.directory.connector.disconnected}
              </span>
            </div>
            <dl className="grid gap-y-0 sm:grid-cols-2">
              <div>
                <SyncRow label={dict.directory.connector.lastAttempt} text={status.last_sync_at ? formatDateTime(status.last_sync_at) : '—'} />
                <SyncRow label={dict.directory.connector.lastSuccess} text={status.last_success_at ? formatDateTime(status.last_success_at) : dict.directory.connector.noneYet} />
              </div>
              <div>
                <SyncRow label={dict.directory.connector.next} text={status.next_sync_at ? formatDateTime(status.next_sync_at) : dict.directory.connector.stopped} />
                <SyncRow label={dict.directory.connector.attempts} text={status.syncs.toLocaleString('es-ES')} />
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-800/60 px-4 py-2.5 text-[11px] tabular-nums text-zinc-500">
              <span>{dict.directory.connector.users}{status.objects.users.toLocaleString('es-ES')}</span>
              <span>{dict.directory.connector.groups}{status.objects.groups.toLocaleString('es-ES')}</span>
              <span>{dict.directory.connector.computers}{status.objects.computers.toLocaleString('es-ES')}</span>
              <span>{dict.directory.connector.ous}{status.objects.ous.toLocaleString('es-ES')}</span>
              {status.truncated && <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-amber-200">{dict.directory.connector.truncatedBadge}</span>}
            </div>
            {status.last_error && (
              <p role="alert" className="border-t border-zinc-800/60 px-4 py-2.5 text-xs text-red-300">{dict.directory.connector.lastError}{status.last_error}</p>
            )}
            {status.warnings.length > 0 && (
              <ul className="space-y-1 border-t border-zinc-800/60 px-4 py-2.5">
                {status.warnings.map((wn, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-amber-200">
                    <Warning size={13} aria-hidden className="mt-0.5 shrink-0" />
                    {wn}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!posture.ready ? (
            <div className="panel px-4 py-10">
              <EmptyState
                icon={ChartPie}
                title={dict.directory.posturePending.title}
                hint={dict.directory.posturePending.hint}
              />
            </div>
          ) : (
            <>
              {/* coverage strip: three engine numbers, no derived fourth */}
              {(() => {
                const cov = coverageFrom(findings, status.objects, fleet?.enabled && Array.isArray(fleet.hosts) ? fleet.hosts.length : null)
                if (!cov) return null
                return (
                  <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" role="status">
                    <span className="flex items-center gap-2 text-xs text-zinc-400">
                      <Desktop size={15} aria-hidden className="text-zinc-500" />
                      {dict.directory.coverage.title}
                    </span>
                    <span className="text-xs tabular-nums text-zinc-300">{dict.directory.coverage.inDirectory}<b className="font-semibold text-zinc-100">{cov.inDirectory.toLocaleString('es-ES')}</b></span>
                    {cov.withSensor !== null && <span className="text-xs tabular-nums text-zinc-300">{dict.directory.coverage.withSensor}<b className="font-semibold text-emerald-300">{cov.withSensor.toLocaleString('es-ES')}</b></span>}
                    <span className="text-xs tabular-nums text-zinc-300">{dict.directory.coverage.withoutSensor}<b className="font-semibold text-amber-200">{cov.withoutSensor.toLocaleString('es-ES')}</b></span>
                    <span className="text-[11px] text-zinc-600">{dict.directory.coverage.detail}</span>
                  </div>
                )
              })()}

              <div className="grid gap-5 xl:grid-cols-2">
                {/* score + donut, the two overview numbers */}
                <ChartCard
                  title={dict.directory.score.title}
                  subtitle={dict.directory.score.subtitle(formatDateTime(posture.generated_at), posture.objects_checked.toLocaleString('es-ES'))}
                  icon={ChartPie}
                  label={dict.directory.score.label}
                  legend={donutEntries.map((e) => ({ key: e.key, label: e.label, color: SEV_COLOR[e.key as keyof typeof SEV_COLOR] ?? 'var(--sev-info)' }))}
                  table={{
                    caption: dict.directory.score.tableCaption,
                    columns: [dict.directory.score.colSeverity, dict.directory.score.colClasses],
                    rows: donutEntries.map((e) => [e.label, e.value]),
                  }}
                >
                  <div className="flex flex-1 flex-wrap items-center justify-around gap-4 py-2">
                    <div className="text-center">
                      <p className={'text-4xl font-semibold tabular-nums ' + (scoreTone(score) === 'ok' ? 'text-emerald-300' : scoreTone(score) === 'warn' ? 'text-amber-300' : 'text-red-300')}>{score}</p>
                      <p className="mt-1 text-[11px] text-zinc-600">{dict.directory.score.of}</p>
                      <span className="mt-2 block w-40"><Meter value={score} max={100} color={TONE_COLOR[scoreTone(score)]} /></span>
                    </div>
                    <DonutChart
                      model={donutModel}
                      colors={Object.fromEntries(donutEntries.map((e) => [e.key, SEV_COLOR[e.key as keyof typeof SEV_COLOR] ?? 'var(--sev-info)']))}
                      unit={dict.directory.score.unit}
                      ariaLabel={dict.directory.score.donutAria}
                      size={170}
                      thickness={24}
                    />
                  </div>
                  <p className="px-1 text-[11px] text-zinc-600">
                    {dict.directory.score.thresholds(posture.inactive_days, posture.krbtgt_max_age_days)}
                  </p>
                </ChartCard>

                {/* trend: one point per completed sync */}
                <ChartCard
                  title={dict.directory.trend.title}
                  subtitle={dict.directory.trend.subtitle}
                  icon={ChartLineUp}
                  label={dict.directory.trend.label}
                  table={{
                    caption: dict.directory.trend.tableCaption,
                    columns: [dict.directory.trend.colAt, dict.directory.trend.colScore],
                    rows: trendSlots.map((s) => [new Date(s.t).toLocaleString('es-ES', { hour12: false }), s.values.score ?? '']),
                  }}
                >
                  {trendSlots.length >= 2 ? (
                    <LineChart
                      series={[{ key: 'score', label: dict.directory.trend.series, color: 'var(--series-1)' }]}
                      slots={trendSlots}
                      ariaLabel={dict.directory.trend.aria}
                      valueLabel={dict.directory.trend.valueLabel}
                      formatT={(t) => new Date(t).toLocaleString('es-ES', { hour12: false })}
                    />
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-4 py-10">
                      <EmptyState icon={ChartLineUp} title={dict.directory.trend.emptyTitle} hint={dict.directory.trend.emptyHint} />
                    </div>
                  )}
                </ChartCard>
              </div>

              {/* privileged accounts: the engine's effective-paths computation */}
              {privileged && privileged.objects.length > 0 && (
                <div className="panel overflow-hidden">
                  <div className="panel-head flex-wrap gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <Key size={16} aria-hidden className="text-zinc-500" />
                      {dict.directory.privileged.title}
                    </span>
                    <span className="text-[11px] tabular-nums text-zinc-600">{dict.directory.privileged.count(privileged.count)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[560px] text-xs">
                      <TableCaption>{dict.directory.privileged.caption}</TableCaption>
                      <TableHeader>
                        <TableHeadRow className="border-b border-zinc-800/60">
                          <TableHead className="px-4 py-2">{dict.directory.privileged.colAccount}</TableHead>
                          <TableHead className="px-4 py-2">{dict.directory.privileged.colPaths}</TableHead>
                        </TableHeadRow>
                      </TableHeader>
                      <TableBody className="divide-zinc-800/40">
                        {privileged.objects.map((o) => (
                          <TableRow key={o.dn}>
                            <TableCell className="px-4 py-2 font-medium text-zinc-200">{o.name || o.dn}</TableCell>
                            <TableCell className="px-4 py-2 text-zinc-400">{o.detail || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="border-t border-zinc-800/60 px-4 py-2.5 text-[11px] text-zinc-600">
                    {dict.directory.privileged.footnote}
                  </p>
                </div>
              )}

              {/* findings: every class the engine published, engine text verbatim */}
              <div className="panel overflow-hidden">
                <div className="panel-head flex-wrap gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                    <TreeStructure size={16} aria-hidden className="text-zinc-500" />
                    {dict.directory.findings.title}
                  </span>
                  <span className="text-[11px] text-zinc-600">{dict.directory.findings.headHint}</span>
                </div>
                {posture.findings.length === 0 ? (
                  <div className="px-4 py-8">
                    <EmptyState icon={ChartPie} title={dict.directory.findings.emptyTitle} hint={dict.directory.findings.emptyHint} />
                  </div>
                ) : (
                  <div>
                    {posture.findings.map((f) => <FindingItem key={f.id} finding={f} />)}
                  </div>
                )}
              </div>
            </>
          )}

          {/* the snapshot explorer, always available once armed */}
          <ObjectExplorer />
        </div>
      )}
    </section>
  )
}
