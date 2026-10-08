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
import { EmptyState, SkeletonRows } from './ui-bits'
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

const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary-strong px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const KIND_TABS: { kind: ADKind; label: string; icon: React.ElementType }[] = [
  { kind: 'user', label: 'Usuarios', icon: UserCircle },
  { kind: 'group', label: 'Grupos', icon: UsersThree },
  { kind: 'computer', label: 'Equipos', icon: Desktop },
  { kind: 'ou', label: 'Unidades org.', icon: FolderOpen },
]

const TONE_COLOR: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'var(--status-ok)',
  warn: 'var(--status-warning)',
  bad: 'var(--status-critical)',
}

function unixToText(sec: number): string {
  if (!sec) return 'nunca / desconocido'
  try {
    return new Date(sec * 1000).toLocaleString('es-ES', { hour12: false })
  } catch {
    return String(sec)
  }
}

/** One finding as an expandable row: severity-marked summary, engine text verbatim. */
function FindingItem({ finding }: { finding: ADFinding }) {
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
            <span className="font-medium text-zinc-100">Remediación: </span>{remediation}
          </p>
        )}
        {objects.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800/60 text-[11px] uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Objeto</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">DN</th>
                  <th scope="col" className="py-1.5 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {objects.map((o) => (
                  <tr key={o.dn} className="align-top">
                    <td className="py-1.5 pr-3 font-medium text-zinc-200">{o.name || '—'}</td>
                    <td className="max-w-[260px] truncate py-1.5 pr-3 font-mono text-[11px] text-zinc-500" title={o.dn}>{o.dn}</td>
                    <td className="py-1.5 text-zinc-400">{o.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {truncated && (
              <p className="mt-2 text-[11px] text-zinc-500">La lista de objetos está truncada; el recuento de arriba es el total real.</p>
            )}
          </div>
        )}
      </div>
    </details>
  )
}

/** The snapshot explorer: kind tabs, free-text search, real pagination. */
function ObjectExplorer() {
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
          Objetos del snapshot
        </span>
        <span className="text-[11px] text-zinc-500">búsqueda de texto sobre el snapshot local · el motor nunca recibe filtros LDAP</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 px-4 py-2.5">
        <div role="group" aria-label="Tipo de objeto" className="flex rounded-lg border border-zinc-800 p-0.5">
          {KIND_TABS.map(({ kind: k, label, icon: Icon }) => (
            <button
              key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                (kind === k ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}
            >
              <Icon size={13} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlass size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Buscar por nombre, DN o OS…"
            aria-label={`Buscar objetos de tipo ${KIND_TABS.find((t) => t.kind === kind)?.label ?? kind}`}
            className="w-full rounded-lg border border-zinc-800 bg-transparent py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          Página
          <select
            value={pageSize}
            onChange={(e) => setPageSize(adPageSize(Number(e.target.value)))}
            className="rounded-md border border-zinc-800 bg-transparent px-1.5 py-1 text-xs text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {AD_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {error ? (
        <div className="px-4 py-8">
          <EmptyState icon={TreeStructure} title="El snapshot no está disponible" hint={`${error} — sin datos no se dibuja un directorio inventado.`} />
        </div>
      ) : loading ? (
        <SkeletonRows rows={6} className="px-4 py-2" />
      ) : !data || data.objects.length === 0 ? (
        <div className="px-4 py-8">
          <EmptyState
            icon={TreeStructure}
            title={query ? 'Sin coincidencias' : 'Sin objetos de este tipo'}
            hint={query ? 'Ningún objeto del snapshot contiene el texto buscado (nombre, DN o OS).' : 'El snapshot completo llega con la siguiente sincronización del conector.'}
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800/60 text-[11px] uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="px-4 py-2 font-medium">Nombre</th>
                  <th scope="col" className="px-4 py-2 font-medium">Detalle</th>
                  <th scope="col" className="px-4 py-2 font-medium">Último cambio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {data.objects.map((o) => <ObjectRow key={o.dn} obj={o} />)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/60 px-4 py-2.5 text-[11px] text-zinc-500">
            <span className="tabular-nums">{from}–{to} de {total.toLocaleString('es-ES')} objetos</span>
            <span className="flex gap-1.5">
              <button type="button" className="chip px-2.5 py-1.5 text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Anterior
              </button>
              <button type="button" className="chip px-2.5 py-1.5 text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function ObjectRow({ obj }: { obj: ADObject }) {
  const flags = uacFlagLabels(obj.user_account_control)
  const details: string[] = []
  if (obj.kind === 'user') {
    const upn = obj.attributes?.userPrincipalName
    if (upn) details.push(upn)
    if (obj.spn_count > 0) details.push(`${obj.spn_count} SPN`)
    details.push(`pwd: ${unixToText(obj.pwd_last_set_unix)}`)
    details.push(`último acceso: ${unixToText(obj.last_logon_unix)}`)
  } else if (obj.kind === 'group') {
    const members = obj.attributes?.member_count
    if (members !== undefined) details.push(`${members} miembros directos`)
    if (obj.admin_count > 0) details.push('adminCount=1')
    const desc = obj.attributes?.description
    if (desc) details.push(desc)
  } else if (obj.kind === 'computer') {
    if (obj.os) details.push(obj.os)
    const dns = obj.attributes?.dNSHostName
    if (dns) details.push(dns)
    details.push(`último acceso: ${unixToText(obj.last_logon_unix)}`)
  } else {
    const desc = obj.attributes?.description
    if (desc) details.push(desc)
    details.push(obj.dn)
  }
  return (
    <tr className="align-top transition-colors hover:bg-white/[0.02]">
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
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-zinc-500">{unixToText(obj.when_changed_unix)}</td>
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
  const donutEntries = severityEntries(posture?.summary ?? {})
  const donutModel = buildDonut(donutEntries, { maxNamed: 4 })
  const trendSlots: LineSlot[] = (history ?? [])
    .slice()
    .map((p) => ({ t: p.at * 1000, values: { score: p.score } }))
  const score = posture?.ready ? posture.score ?? 0 : 0

  return (
    <section aria-label="Directorio activo">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-zinc-100">Directorio activo</h1>
          <p className="mt-0.5 text-xs text-zinc-500">lectura de /api/ad · sin escrituras al motor</p>
        </div>
        <button type="button" onClick={refresh} aria-busy={state === 'loading'}
          className="chip px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60">
          <ArrowClockwise size={13} aria-hidden className={state === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} />
          Actualizar
        </button>
      </div>

      <p className="mt-3 max-w-[80ch] text-xs leading-relaxed text-zinc-500">
        El snapshot del directorio que el motor sincroniza por LDAPS y la postura defensiva que calcula sobre
        él — membresías privilegiadas, KRBTGT, delegaciones, criptografía Kerberos, cuentas obsoletas y
        cobertura de sensores. Nada viaja al controlador de dominio desde esta página.
      </p>

      {state === 'unarmed' && (
        <div className="panel mt-5 px-4 py-10">
          <EmptyState
            icon={PlugsConnected}
            title="El conector de Active Directory no está armado"
            hint={`${hint} — mientras el motor arranque sin -ad no hay directorio que mostrar, y esta página no lo va a inventar.`}
          />
        </div>
      )}

      {state === 'error' && (
        <div className="panel mt-5 px-4 py-10">
          <EmptyState icon={PlugsConnected} title="El directorio no está disponible" hint={`${errorText} — el detalle completo queda en el log del motor.`} />
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
                Conector
              </span>
              <span className={'flex items-center gap-1.5 text-[11px] ' + (status.connected ? 'text-emerald-300' : 'text-red-300')}>
                <span aria-hidden className={'inline-block h-1.5 w-1.5 rounded-full ' + (status.connected ? 'bg-emerald-400' : 'bg-red-400')} />
                {status.connected ? 'conectado' : 'sin conexión en el último intento'}
              </span>
            </div>
            <dl className="grid gap-y-0 sm:grid-cols-2">
              <div>
                <SyncRow label="Último intento de sincronización" text={status.last_sync_at ? formatDateTime(status.last_sync_at) : '—'} />
                <SyncRow label="Última sincronización completada" text={status.last_success_at ? formatDateTime(status.last_success_at) : 'aún ninguna'} />
              </div>
              <div>
                <SyncRow label="Próxima sincronización" text={status.next_sync_at ? formatDateTime(status.next_sync_at) : 'detenida'} />
                <SyncRow label="Intentos desde el arranque" text={status.syncs.toLocaleString('es-ES')} />
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-800/60 px-4 py-2.5 text-[11px] tabular-nums text-zinc-500">
              <span>usuarios: {status.objects.users.toLocaleString('es-ES')}</span>
              <span>grupos: {status.objects.groups.toLocaleString('es-ES')}</span>
              <span>equipos: {status.objects.computers.toLocaleString('es-ES')}</span>
              <span>UOs: {status.objects.ous.toLocaleString('es-ES')}</span>
              {status.truncated && <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-amber-200">snapshot truncado por el límite de objetos</span>}
            </div>
            {status.last_error && (
              <p role="alert" className="border-t border-zinc-800/60 px-4 py-2.5 text-xs text-red-300">Último error: {status.last_error}</p>
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
                title="Aún sin análisis de postura"
                hint="El conector está armado pero la primera sincronización no ha terminado; el análisis aparece en cuanto el motor congela su primer snapshot."
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
                      Cobertura de sensores:
                    </span>
                    <span className="text-xs tabular-nums text-zinc-300">equipos en el directorio: <b className="font-semibold text-zinc-100">{cov.inDirectory.toLocaleString('es-ES')}</b></span>
                    {cov.withSensor !== null && <span className="text-xs tabular-nums text-zinc-300">equipos que reportan al motor: <b className="font-semibold text-emerald-300">{cov.withSensor.toLocaleString('es-ES')}</b></span>}
                    <span className="text-xs tabular-nums text-zinc-300">sin telemetría del sensor: <b className="font-semibold text-amber-200">{cov.withoutSensor.toLocaleString('es-ES')}</b></span>
                    <span className="text-[11px] text-zinc-500">el detalle, equipo a equipo, está en el hallazgo «Equipos del dominio sin sensor»</span>
                  </div>
                )
              })()}

              <div className="grid gap-5 xl:grid-cols-2">
                {/* score + donut, the two overview numbers */}
                <ChartCard
                  title="Puntuación de postura"
                  subtitle={`análisis del ${formatDateTime(posture.generated_at)} · ${posture.objects_checked.toLocaleString('es-ES')} objetos revisados`}
                  icon={ChartPie}
                  label="Puntuación de postura y hallazgos por severidad"
                  legend={donutEntries.map((e) => ({ key: e.key, label: e.label, color: SEV_COLOR[e.key as keyof typeof SEV_COLOR] ?? 'var(--sev-info)' }))}
                  table={{
                    caption: 'Hallazgos por severidad',
                    columns: ['Severidad', 'Clases de hallazgo'],
                    rows: donutEntries.map((e) => [e.label, e.value]),
                  }}
                >
                  <div className="flex flex-1 flex-wrap items-center justify-around gap-4 py-2">
                    <div className="text-center">
                      <p className={'text-4xl font-semibold tabular-nums ' + (scoreTone(score) === 'ok' ? 'text-emerald-300' : scoreTone(score) === 'warn' ? 'text-amber-300' : 'text-red-300')}>{score}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">de 100</p>
                      <span className="mt-2 block w-40"><Meter value={score} max={100} color={TONE_COLOR[scoreTone(score)]} /></span>
                    </div>
                    <DonutChart
                      model={donutModel}
                      colors={Object.fromEntries(donutEntries.map((e) => [e.key, SEV_COLOR[e.key as keyof typeof SEV_COLOR] ?? 'var(--sev-info)']))}
                      unit="clases de hallazgo"
                      ariaLabel="Hallazgos de postura por severidad"
                      size={170}
                      thickness={24}
                    />
                  </div>
                  <p className="px-1 text-[11px] text-zinc-500">
                    umbrales del análisis: cuenta inactiva a partir de {posture.inactive_days} días · KRBTGT con rotación recomendada cada {posture.krbtgt_max_age_days} días
                  </p>
                </ChartCard>

                {/* trend: one point per completed sync */}
                <ChartCard
                  title="Tendencia de la puntuación"
                  subtitle="un punto por sincronización completada"
                  icon={ChartLineUp}
                  label="Tendencia de la puntuación de postura"
                  table={{
                    caption: 'Historial de puntuación',
                    columns: ['Momento', 'Puntuación'],
                    rows: trendSlots.map((s) => [new Date(s.t).toLocaleString('es-ES', { hour12: false }), s.values.score ?? '']),
                  }}
                >
                  {trendSlots.length >= 2 ? (
                    <LineChart
                      series={[{ key: 'score', label: 'Puntuación', color: 'var(--series-1)' }]}
                      slots={trendSlots}
                      ariaLabel="Puntuación de postura por sincronización"
                      valueLabel="puntuación"
                      formatT={(t) => new Date(t).toLocaleString('es-ES', { hour12: false })}
                    />
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-4 py-10">
                      <EmptyState icon={ChartLineUp} title="Todavía no hay tendencia" hint="Con una sola sincronización completada no se dibuja una línea; el histórico crece con cada sync del conector." />
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
                      Cuentas privilegiadas efectivas
                    </span>
                    <span className="text-[11px] tabular-nums text-zinc-500">{privileged.count} cuentas</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800/60 text-[11px] uppercase tracking-wide text-zinc-500">
                          <th scope="col" className="px-4 py-2 font-medium">Cuenta</th>
                          <th scope="col" className="px-4 py-2 font-medium">Caminos de privilegio</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/40">
                        {privileged.objects.map((o) => (
                          <tr key={o.dn} className="align-top transition-colors hover:bg-white/[0.02]">
                            <td className="px-4 py-2 font-medium text-zinc-200">{o.name || o.dn}</td>
                            <td className="px-4 py-2 text-zinc-400">{o.detail || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t border-zinc-800/60 px-4 py-2.5 text-[11px] text-zinc-500">
                    Los caminos (directos y anidados) los calcula el motor sobre el snapshot; la API todavía no expone
                    las aristas de membresía completas, así que el árbol de grupos se mostrará cuando exista esa ruta.
                  </p>
                </div>
              )}

              {/* findings: every class the engine published, engine text verbatim */}
              <div className="panel overflow-hidden">
                <div className="panel-head flex-wrap gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                    <TreeStructure size={16} aria-hidden className="text-zinc-500" />
                    Hallazgos
                  </span>
                  <span className="text-[11px] text-zinc-500">texto del motor, sin reescribir · el recuento es el total aunque la lista venga truncada</span>
                </div>
                {posture.findings.length === 0 ? (
                  <div className="px-4 py-8">
                    <EmptyState icon={ChartPie} title="Sin hallazgos registrados" hint="El análisis completó sin clases de hallazgo: dominio limpio según los controles implementados." />
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
