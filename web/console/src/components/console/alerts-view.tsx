'use client'

// Alert triage queue.
//
// Full mode: semantic table (sticky header, row selection) plus a detail
// panel with everything the engine attached to the alert: rendered rule
// message, matched_on fields, ATT&CK tags, declared actions, enrichment
// and ids. Text search plus severity filter narrow the queue during an
// investigation. Compact mode (dashboard widget): short list with the
// same detail inline, controls hidden.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  ArrowCounterClockwise,
  BellRinging,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Eye,
  MagnifyingGlass,
  Sparkle,
  Tray,
  XCircle,
} from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useEngine } from './engine-provider'
import { EmptyState, LiveAnnouncer, SectionHeader, SeverityBadge, SkeletonRows } from './ui-bits'
import { ExportButtons } from './export-menu'
import { ForensicPanel } from './forensic-panel'
import { ReportPanel } from './report-panel'
import { ReportLibrary } from './report-library'
import { observationSearch } from '@/lib/source-observation'
import { SavedSearches } from './saved-searches'
import { alertSearchLens, searchForSavedLens, type SavedLens } from '@/lib/saved-searches'
import { postAlertStatus } from '@/lib/lifecycle'
import { alertKey } from '@/lib/engine-client'
import { matchesAlertState, alertStateFromParam, type AlertScope, type AlertStateFilter } from '@/lib/alert-search'
import { useAlertHistory } from '@/hooks/use-alert-history'
import {
  currentSearch,
  readOperatorState,
  replaceOperatorState,
  pushOperatorState,
  sevFromParam,
  readAlertLens,
  writeAlertLens,
  MAX_QUERY_CHARS,
  type SeverityFilter,
} from '@/lib/url-state'
import {
  formatDateTime,
  formatTime,
  SEVERITY_STYLE,
  type SfAlert,
  type SfAlertStatus,
} from '@/lib/console-types'

type Props = {
  compact?: boolean
  onAnalyze?: (alert: SfAlert) => void
}

export function AlertsView({ compact = false, onAnalyze }: Props) {
  const { alerts, status, lifecycleUpdates } = useEngine()
  const reduce = useReducedMotion()
  const [sevFilter, setSevFilterState] = useState<SeverityFilter>('all')
  const [query, setQueryState] = useState('')
  const [stateFilter, setStateFilter] = useState<AlertStateFilter>('all')
  const [scope, setScope] = useState<AlertScope>('live')
  const [lensReady, setLensReady] = useState(false)
  const history = useAlertHistory(!compact && scope === 'history' && lensReady, { severity: sevFilter, state: stateFilter, q: query }, status, lifecycleUpdates)
  const historyMode = !compact && scope === 'history'
  const displayedAlerts = historyMode ? history.items : alerts

  // Triage filters in the URL (url-state.ts, full mode only — the
  // dashboard widget keeps its own ephemeral lens): the investigation
  // context survives a refresh and a filtered queue is a shareable
  // link. Read AFTER mount (hydration-safe, like the shell view); sev
  // writes immediately, the query debounces so typing does not thrash
  // replaceState; popstate re-syncs both. The ref mirrors the latest
  // lens so every write uses the current keys from one source.
  const filterRef = useRef({ sev: 'all' as SeverityFilter, q: '', state: 'all' as AlertStateFilter, scope: 'live' as AlertScope, alert: null as string | null })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (compact) return
    const apply = (first = false) => {
      const st = readOperatorState(currentSearch())
      const lens = readAlertLens(currentSearch())
      filterRef.current = { sev: st.sev, q: st.q, ...lens }
      setStateFilter(lens.state)
      setScope(lens.scope)
      setLensReady(true)
      setSevFilterState(st.sev)
      setQueryState(st.q)
      // The URL is the selection source on mount and on back/forward;
      // the operator regains ownership with the next row click.
      setUrlAlertId(lens.alert)
      setSelectedKeyState(null)
      // A handoff link for an alert that already left the live ring
      // looks in the engine history first — initial load only: popstate
      // re-syncs exactly what the operator navigated back to.
      if (first && lens.alert && lens.scope !== 'history' && !alerts.some((a) => alertKey(a) === lens.alert)) {
        filterRef.current = { ...filterRef.current, scope: 'history' }
        setScope('history')
        replaceOperatorState((search) => writeAlertLens(search, filterRef.current.sev, filterRef.current.q, filterRef.current.state, 'history', lens.alert))
      }
    }
    apply(true)
    const onPop = () => apply()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [compact])

  const writeFilters = () => {
    replaceOperatorState((search) => writeAlertLens(search, filterRef.current.sev, filterRef.current.q, filterRef.current.state, filterRef.current.scope, filterRef.current.alert))
  }
  // Lens changes clear the linked selection by design (the alert= key
  // describes a queue the operator is about to replace); the linked
  // selection itself survives pagination on purpose — it may sit on a
  // later history page.
  const clearLinkedSelection = () => {
    setSelectedKeyState(null)
    setUrlAlertId(null)
    filterRef.current = { ...filterRef.current, alert: null }
  }
  const setSevFilter = (next: string) => {
    const sev = sevFromParam(next)
    filterRef.current = { ...filterRef.current, sev }
    setSevFilterState(sev)
    if (!compact) {
      clearLinkedSelection()
      writeFilters()
    }
  }
  const setQuery = (raw: string) => {
    const next = raw.slice(0, MAX_QUERY_CHARS)
    filterRef.current = { ...filterRef.current, q: next }
    setQueryState(next)
    if (compact) return
    clearLinkedSelection()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(writeFilters, 250)
  }
  const changeState = (next: string) => {
    const state = alertStateFromParam(next)
    filterRef.current = { ...filterRef.current, state }
    setStateFilter(state)
    if (!compact) {
      clearLinkedSelection()
      writeFilters()
    }
  }
  const changeScope = (scope: AlertScope) => {
    filterRef.current = { ...filterRef.current, scope }
    setScope(scope)
    clearLinkedSelection()
    writeFilters()
  }
  const applySaved = (lens: SavedLens) => {
    if (lens.kind !== 'alerts') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    filterRef.current = { sev: lens.severity, q: lens.q, state: lens.state, scope: lens.scope, alert: null }
    setSevFilterState(lens.severity)
    setQueryState(lens.q)
    setStateFilter(lens.state)
    setScope(lens.scope)
    clearLinkedSelection()
    pushOperatorState((search) => searchForSavedLens(search, lens))
  }
  // Row selection and the URL are the same thing: picking a row makes
  // it a shareable link, deselecting clears the key (no ghosts), and a
  // handoff link (?alert=<id>) selects its alert as soon as the alert
  // is on screen — in the live ring or on the loaded history page.
  const selectAlert = (key: string | null) => {
    setSelectedKeyState(key)
    setUrlAlertId(null)
    filterRef.current = { ...filterRef.current, alert: key }
    replaceOperatorState((search) => writeAlertLens(search, filterRef.current.sev, filterRef.current.q, filterRef.current.state, filterRef.current.scope, key))
  }
  const [openId, setOpenId] = useState<string | null>(null)
  // The detail panel follows the LIVE alert, not a click-time snapshot:
  // the lifecycle frame patches the ring immutably, so the selection is
  // stored as a key and the object is derived on every render. A triage
  // decision lands in the panel the moment the stream delivers it (the
  // buttons swap to cerrar/reabrir, the note and by/when appear) - no
  // re-selection needed. If the alert leaves the ring, the panel closes
  // instead of showing a ghost. A deep-linked alert (?alert=<id>) takes
  // over until the operator picks a row or changes a lens.
  const [userSelectedKey, setSelectedKeyState] = useState<string | null>(null)
  const [urlAlertId, setUrlAlertId] = useState<string | null>(null)
  const selectedKey = userSelectedKey ?? urlAlertId
  const selected = useMemo(
    () => (selectedKey === null ? null : (displayedAlerts.find((a) => alertKey(a) === selectedKey) ?? null)),
    [displayedAlerts, selectedKey],
  )
  const [announcement, setAnnouncement] = useState('')
  const knownTop = useRef<string | null>(null)

  // Screen readers only get told about genuinely new alerts, not about
  // re-renders: the live region updates once per arrival.
  useEffect(() => {
    const top = alerts[0]
    if (!top) return
    const key = alertKey(top)
    if (knownTop.current === null) {
      knownTop.current = key
      return
    }
    if (knownTop.current !== key) {
      knownTop.current = key
      setAnnouncement(`Nueva alerta ${top.severity}: ${top.rule_name} en ${top.host}`)
    }
  }, [alerts])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (historyMode) return displayedAlerts
    const list = alerts.filter((a) => {
      if (!matchesAlertState(a, stateFilter)) return false
      if (sevFilter !== 'all' && a.severity !== sevFilter) return false
      if (!q) return true
      // triage search: anything an analyst remembers about the alert
      const haystack = [
        a.rule_name, a.rule_id, a.summary, a.host, a.user ?? '',
        a.event_type, a.source ?? '', a.status_note ?? '', ...a.tags ?? [], ...a.matched_on, ...observationSearch(a.attributes, a.network),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    return compact ? list.slice(0, 6) : list
  }, [alerts, displayedAlerts, sevFilter, stateFilter, query, compact, historyMode])

  const filtering = sevFilter !== 'all' || stateFilter !== 'all' || query.trim() !== ''

  // O4 honesty (export-menu): with a filter active, the export tooltips
  // declare that the bulk file ignores the lens — and how much it keeps.
  const activeFilterLabel =
    filtering && !compact
      ?
        [
          sevFilter !== 'all' ? `severidad ${sevFilter}` : null,
          stateFilter !== 'all' ? `estado ${stateFilter}` : null,
          query.trim() !== '' ? `búsqueda «${query.trim()}»` : null,
        ]
          .filter(Boolean)
          .join(' + ') || undefined
      : undefined
  const hiddenByFilter = filtering && !compact && !historyMode ? alerts.length - visible.length : undefined

  const header = (
    <SectionHeader
      title={compact ? 'Alertas recientes' : 'Cola de alertas'}
      count={visible.length}
      hint={historyMode ? 'búsqueda en el motor' : !compact ? `de ${alerts.length} recibidas en vivo` : undefined}
      action={
        !compact && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlass
                size={13}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder="buscar regla, host, usuario..."
                aria-label="Buscar en alertas"
                maxLength={MAX_QUERY_CHARS}
                className="h-8 w-[220px] rounded-md border-zinc-800 bg-zinc-900 pl-7 font-mono text-xs text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
            <Select value={sevFilter} onValueChange={setSevFilter}>
              <SelectTrigger className="h-8 w-[150px] rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs" aria-label="Filtrar por severidad">
                <SelectValue placeholder="Severidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">todas</SelectItem>
                <SelectItem value="critical">critical</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="info">info</SelectItem>
              </SelectContent>
            </Select>
            <select value={stateFilter} onChange={(e) => changeState(e.target.value)} aria-label="Filtrar por estado"
              className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 font-mono text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="all">Todos los estados</option>
              <option value="open">Sin cerrar</option>
              <option value="new">Nuevas</option>
              <option value="acknowledged">Reconocidas</option>
              <option value="closed">Cerradas</option>
            </select>
            <ExportButtons kind="alerts" filterLabel={activeFilterLabel} hiddenCount={hiddenByFilter} />
          </div>
        )
      }
    />
  )

  if (compact) {
    return (
      <section aria-label="Alertas de detección">
        {header}
        {status === 'connecting' && alerts.length === 0 ? (
          <SkeletonRows rows={5} className="border-y border-zinc-800 py-6" />
        ) : status === 'down' ? (
          <EmptyState icon={Tray} title="Alertas no disponibles" hint="Recupera la conexión con el motor para ver las detecciones." />
        ) : alerts.length === 0 ? (
          <div className="border-y border-zinc-800">
            <EmptyState
              icon={Tray}
              title="Sin alertas todavía"
              hint="Las detecciones aparecen en cuanto una regla evalúa telemetría sospechosa"
            />
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/80 border-y border-zinc-800">
            {visible.map((al) => {
              const open = openId === alertKey(al)
              return (
                <li key={alertKey(al)} className="relative">
                  <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${SEVERITY_STYLE[al.severity]?.bar ?? 'bg-sky-400'} opacity-80`} />
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : alertKey(al))}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 py-2.5 pl-4 pr-3 text-left transition-colors hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={al.severity} />
                        <StatusChip status={al.status} />
                        <span className="truncate text-sm text-zinc-100">{al.rule_name}</span>
                        {al.notify && <BellRinging size={13} weight="fill" aria-label="Notifica a canales externos" className="shrink-0 text-amber-400" />}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-zinc-500">{al.summary}</span>
                    </span>
                    <span className="hidden shrink-0 font-mono text-xs tabular-nums text-zinc-500 sm:inline">
                      {formatTime(al.timestamp)}
                    </span>
                    <CaretDown size={13} aria-hidden className={`shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="border-t border-zinc-800/80 bg-zinc-900/60 px-4 py-3.5">
                      <AlertDetailBody alert={al} onAnalyze={onAnalyze} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <LiveAnnouncer message={announcement} />
      </section>
    )
  }

  return (
    <section aria-label="Alertas de detección">
      {header}
      <ReportLibrary />
      <SavedSearches kind="alerts" getLens={() => alertSearchLens(filterRef.current.sev, filterRef.current.state, filterRef.current.scope, filterRef.current.q)} onApply={applySaved} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
        <div role="group" aria-label="Origen de alertas" className="flex gap-1">
          {([['live', 'En vivo'], ['history', 'Histórico']] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={scope === id} onClick={() => changeScope(id)}
              className={'rounded-md px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' + (scope === id ? 'bg-blue-400/10 text-blue-300' : 'text-zinc-400 hover:text-zinc-100')}>
              {label}
            </button>
          ))}
        </div>
        {historyMode ? (
          <nav aria-label="Páginas del histórico" className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-zinc-400">Página {history.pageNumber}</span>
            <Button variant="outline" size="sm" onClick={history.previous} disabled={!history.canPrevious || history.loading || status !== 'live'}>Anterior</Button>
            <Button variant="outline" size="sm" onClick={history.next} disabled={!history.page?.has_more || history.loading || status !== 'live'}>{history.page?.scan_limited ? 'Seguir buscando' : 'Siguiente'}</Button>
            <Button variant="outline" size="sm" onClick={history.refresh} disabled={history.loading || status !== 'live'} aria-busy={history.loading}>Actualizar histórico</Button>
          </nav>
        ) : <span className="text-[11px] text-zinc-500">Últimas {alerts.length} recibidas por la consola; usa el histórico para buscar más atrás.</span>}
      </div>
      {historyMode && history.page && (
        <p role="status" className="mb-3 text-xs text-zinc-500">
          {history.page.source === 'sqlite' ? 'Histórico SQLite, sujeto a la retención configurada.' : 'Solo memoria: últimas 256 alertas del motor. Activa -store para conservar el histórico.'}
          {' '}25 por página, más recientes por orden de recepción. Actualiza para incluir nuevas llegadas.
          {history.page.scan_limited && ' Se alcanzó el límite de lectura de esta consulta; continúa con «Seguir buscando».'}
        </p>
      )}
      {historyMode && history.error && <p role="alert" className="mb-3 rounded-md border border-red-400/20 bg-red-400/5 px-3 py-3 text-sm text-red-300">{history.error}</p>}
      {!compact && lensReady && status === 'live' && urlAlertId && !selected && !(historyMode && history.loading) && (
        <p role="status" className="mb-3 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-xs text-zinc-400">
          La alerta enlazada (<span className="font-mono break-all">{urlAlertId.length > 24 ? urlAlertId.slice(0, 24) + '…' : urlAlertId}</span>)
          {' '}no está en esta cola: el anillo en vivo guarda solo las últimas alertas y el histórico pagina por bloques.
          Usa la búsqueda o la paginación (el enlace resuelve en cuanto la alerta aparezca en la página cargada).
        </p>
      )}

      {status === 'connecting' || (historyMode && history.loading) ? (
        <div className="panel px-4 py-6">
          <SkeletonRows rows={6} />
        </div>
      ) : status === 'down' ? (
        <div className="panel"><EmptyState icon={Tray} title="Alertas no disponibles" hint="Recupera la conexión con el motor para consultar alertas." /></div>
      ) : historyMode && history.error ? null : displayedAlerts.length === 0 && !filtering && !history.page?.scan_limited ? (
        <div className="panel">
          <EmptyState
            icon={Tray}
            title="Sin alertas todavía"
            hint="Las detecciones aparecen en cuanto una regla evalúa telemetría sospechosa. Verifica que el motor esté ingestando eventos de un sensor."
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={MagnifyingGlass}
            title="Sin resultados"
            hint={history.page?.scan_limited ? 'Continúa la búsqueda: todavía quedan registros por examinar.' : 'Ninguna alerta coincide con la búsqueda o el filtro actual'}
            action={
              <Button
                variant="outline"
                size="sm"
                className="rounded-md border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => {
                  setQuery('')
                  setSevFilter('all')
                  changeState('all')
                }}
              >
                Limpiar filtros
              </Button>
            }
          />
        </div>
      ) : (
        <div className={selected ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]' : ''}>
          <div className="panel min-w-0 overflow-hidden">
            <div className="max-h-[68vh] overflow-y-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">
                  Cola de alertas del motor: severidad, regla, equipo y hora. Selecciona una fila para ver el detalle.
                </caption>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-zinc-950">
                    <th scope="col" className="border-b border-zinc-800 py-2 pl-4 pr-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Sev</th>
                    <th scope="col" className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Alerta</th>
                    <th scope="col" className="hidden border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 lg:table-cell">Equipo / Usuario</th>
                    <th scope="col" className="hidden border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 md:table-cell">Técnica</th>
                    <th scope="col" className="border-b border-zinc-800 px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-500">Hora</th>
                    <th scope="col" className="w-8 border-b border-zinc-800 px-2 py-2"><span className="sr-only">Detalle</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {visible.map((al) => {
                    const key = alertKey(al)
                    const isSelected = selectedKey === key
                    const mitre = (al.tags ?? []).find((t) => t.startsWith('attack.t'))
                    return (
                      <tr
                        key={key}
                        aria-selected={isSelected}
                        onClick={() => selectAlert(isSelected ? null : key)}
                        className={`group cursor-pointer align-middle transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring ${
                          isSelected ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/40'
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-3 align-middle">
                          <span className="flex items-center gap-2">
                            <span aria-hidden className={`h-4 w-[3px] rounded-full ${SEVERITY_STYLE[al.severity]?.bar ?? 'bg-sky-400'}`} />
                            <SeverityBadge severity={al.severity} />
                            <StatusChip status={al.status} />
                          </span>
                        </td>
                        <td className="max-w-0 px-3 py-2.5 align-middle">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              selectAlert(isSelected ? null : key)
                            }}
                            className="block w-full max-w-full truncate text-left text-[13px] font-medium text-zinc-100 focus-visible:outline-none"
                            title={`${al.rule_name}: ${al.summary}`}
                          >
                            {al.rule_name}
                          </button>
                          <span className="block truncate font-mono text-xs text-zinc-500">{al.summary}</span>
                        </td>
                        <td className="hidden max-w-[180px] px-3 py-2.5 align-middle lg:table-cell">
                          <span className="block truncate font-mono text-xs text-zinc-300">{al.host}</span>
                          <span className="block truncate font-mono text-xs text-zinc-500">{al.user ?? 'n/d'}</span>
                        </td>
                        <td className="hidden px-3 py-2.5 align-middle md:table-cell">
                          {mitre ? (
                            <span className="inline-flex rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                              {mitre.replace('attack.', '').toUpperCase()}
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-500">n/d</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-xs tabular-nums text-zinc-400">
                          {formatTime(al.timestamp)}
                        </td>
                        <td className="px-2 py-2.5 text-right align-middle">
                          <CaretDown
                            size={13}
                            aria-hidden
                            className={`ml-auto text-zinc-500 transition-transform group-hover:text-zinc-400 ${isSelected ? 'rotate-180' : ''}`}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
              {historyMode ? `Mostrando ${visible.length} alertas de esta página; no es el total del histórico.` : `Mostrando ${visible.length} de ${alerts.length} alertas recibidas en vivo.`}
            </p>
          </div>

          {selected && (
            <motion.aside
              key={alertKey(selected)}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              aria-label="Detalle de la alerta seleccionada"
              className="panel min-w-0"
            >
              <AlertDetail alert={selected} onClose={() => selectAlert(null)} onAnalyze={onAnalyze} />
            </motion.aside>
          )}
        </div>
      )}
      <LiveAnnouncer message={announcement} />
    </section>
  )
}

/** Header + actions of the detail panel (full mode). */
function AlertDetail({
  alert,
  onClose,
  onAnalyze,
}: {
  alert: SfAlert
  onClose: () => void
  onAnalyze?: (alert: SfAlert) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <SeverityBadge severity={alert.severity} />
          <h3 className="mt-2 truncate text-sm font-medium text-zinc-100" title={alert.rule_name}>
            {alert.rule_name}
          </h3>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{formatDateTime(alert.timestamp)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalle"
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CaretDown size={14} aria-hidden className="rotate-180" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3.5">
        <AlertDetailBody alert={alert} onAnalyze={onAnalyze} />
      </div>
    </div>
  )
}

/** Every field the engine attached to the alert, shared by both modes. */
export function AlertDetailBody({ alert, onAnalyze }: { alert: SfAlert; onAnalyze?: (alert: SfAlert) => void }) {
  const attackTags = (alert.tags ?? []).filter((t) => t.startsWith('attack.'))
  const otherTags = (alert.tags ?? []).filter((t) => !t.startsWith('attack.'))
  const enrichmentEntries = Object.entries(alert.enrichment ?? {})

  return (
    <div className="min-w-0">
      {alert.message && (
        <div className="mb-4 border-l-2 border-zinc-700 pl-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Mensaje de la regla</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">{alert.message}</p>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-xs sm:grid-cols-2">
        <Detail label="Equipo" value={alert.host} mono />
        <Detail label="Usuario" value={alert.user ?? 'n/d'} mono />
        <Detail label="Fuente declarada" value={alert.source ?? 'no declarada'} mono />
        <Detail label="Tipo de evento" value={alert.event_type} mono />
        <Detail label="ID de evento" value={alert.event_id} mono />
        <Detail label="ID de regla" value={alert.rule_id} mono />
        <Detail label="Campos coincidentes" value={alert.matched_on.join(', ') || 'n/d'} mono />
      </dl>

      {(attackTags.length > 0 || otherTags.length > 0) && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Etiquetas</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {attackTags.map((t) => (
              <span key={t} className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                {t}
              </span>
            ))}
            {otherTags.map((t) => (
              <span key={t} className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                {t}
              </span>
            ))}
            {alert.notify && (
              <span className="flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                <BellRinging size={11} weight="fill" aria-hidden />
                notifica a canales externos
              </span>
            )}
          </div>
        </div>
      )}

      {alert.actions && alert.actions.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Acciones declaradas por la regla</p>
          <ul className="mt-1.5 space-y-1">
            {alert.actions.map((a) => (
              <li key={a} className="font-mono text-xs text-zinc-400">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {alert.network && <div className="mt-4 min-w-0"><p className="text-[10px] uppercase tracking-wider text-zinc-500">Flujo observado</p><p className="mt-1 break-all font-mono text-xs text-zinc-300">{alert.network.protocol ?? '?'} · {alert.network.source_ip ?? '?'}:{alert.network.source_port ?? '?'} → {alert.network.destination_ip ?? '?'}:{alert.network.destination_port ?? '?'}</p></div>}
      {Object.keys(alert.attributes ?? {}).length > 0 && <div className="mt-4 min-w-0"><p className="text-[10px] uppercase tracking-wider text-zinc-500">Observaciones declaradas por la fuente</p><p className="mt-1 text-xs text-zinc-500">Metadatos recibidos; no acreditan por sí solos autenticidad ni compromiso.</p><dl className="mt-2 divide-y divide-zinc-800 rounded-md border border-zinc-800">{Object.entries(alert.attributes ?? {}).map(([key, value]) => <div key={key} className="grid min-w-0 grid-cols-1 gap-1 p-2 sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)]"><dt className="break-all font-mono text-[10px] text-zinc-500">{key}</dt><dd className="whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-300">{value}</dd></div>)}</dl></div>}
      {enrichmentEntries.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Enriquecimiento</p>
          <dl className="mt-1.5 divide-y divide-zinc-800/80 rounded-md border border-zinc-800">
            {enrichmentEntries.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[130px_1fr] gap-3 px-2.5 py-1.5">
                <dt className="truncate font-mono text-[11px] text-zinc-500" title={k}>{k}</dt>
                <dd className="break-all font-mono text-[11px] text-zinc-300" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {onAnalyze && (
        <div className="mt-5">
          <Button size="sm" onClick={() => onAnalyze(alert)} className="gap-1.5 rounded-md">
            <Sparkle size={14} weight="fill" aria-hidden />
            Analizar con IA
          </Button>
        </div>
      )}

      <TriagePanel alert={alert} />
      <ForensicPanel alertId={alert.id} />
      <ReportPanel alert={alert} />
    </div>
  )
}

// Status chip: "new" is NOT rendered (a chip on every fresh alert would
// be noise - the absence of a chip IS the new state). The chip animates
// in on mount because it mounting IS the state change: a triage decision
// just landed through the alert_lifecycle stream (MOTION 3). Static
// under prefers-reduced-motion.
function StatusChip({ status }: { status?: SfAlertStatus }) {
  const reduce = useReducedMotion()
  const reveal = reduce ? {} : { initial: { opacity: 0, scale: 0.85 }, animate: { opacity: 1, scale: 1 } }
  if (status === 'acknowledged') {
    return (
      <motion.span
        {...reveal}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex shrink-0 origin-left items-center gap-1 rounded-md border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-300"
      >
        <Eye size={11} weight="fill" aria-hidden />
        reconocida
      </motion.span>
    )
  }
  if (status === 'closed') {
    return (
      <motion.span
        {...reveal}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex shrink-0 origin-left items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300"
      >
        <CheckCircle size={11} weight="fill" aria-hidden />
        cerrada
      </motion.span>
    )
  }
  return null
}

// Triage actions (r6): reconocer / cerrar / reabrir with an optional
// note. The POST travels console -> engine proxy -> engine API; the row
// AND this panel re-render from the same patched alert (the lifecycle
// SSE frame is the single source of truth), so only the in-flight and
// error states are tracked locally.
function TriagePanel({ alert }: { alert: SfAlert }) {
  const { applyTriage } = useEngine()
  const status: SfAlertStatus = alert.status ?? 'new'
  const [noteDraft, setNoteDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply(next: SfAlertStatus) {
    if (!alert.id || busy) return
    setBusy(true)
    setError(null)
    const ack = await postAlertStatus({ alert_id: alert.id, status: next, note: noteDraft.trim(), by: 'consola' })
    setBusy(false)
    if (!ack.ok) {
      setError(ack.error)
      return
    }
    if (ack.entry) applyTriage(ack.entry)
    setNoteDraft('')
  }

  return (
    <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Ciclo de vida</p>
        <p className="font-mono text-[10px] text-zinc-500">
          {alert.id ? `id ${alert.id}` : 'sin id del motor'}
          {alert.status_by ? ` · ${alert.status_by}` : ''}
          {alert.status_at ? ` · ${formatTime(alert.status_at)}` : ''}
        </p>
      </div>
      {alert.status_note && status !== 'new' && (
        <p className="mb-2 border-l-2 border-zinc-700 pl-2 text-xs leading-relaxed text-zinc-300">{alert.status_note}</p>
      )}
      <Input
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        maxLength={2000}
        placeholder="nota de triaje (opcional): qué se vio, qué se hizo..."
        aria-label="Nota de triaje"
        className="mb-2 h-8 rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:text-zinc-500"
      />
      {!alert.id ? (
        <p className="text-[11px] text-zinc-500">
          Este alerta no lleva id del motor (motor anterior a r6): el triaje requiere reiniciar el motor actualizado.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {status === 'new' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => apply('acknowledged')} className="gap-1.5 rounded-md">
              {busy ? <CircleNotch size={13} className="animate-spin" aria-hidden /> : <Eye size={13} aria-hidden />}
              Reconocer
            </Button>
          )}
          {status !== 'closed' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => apply('closed')} className="gap-1.5 rounded-md">
              {busy ? <CircleNotch size={13} className="animate-spin" aria-hidden /> : <XCircle size={13} aria-hidden />}
              Cerrar
            </Button>
          )}
          {status === 'closed' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => apply('new')} className="gap-1.5 rounded-md">
              {busy ? <CircleNotch size={13} className="animate-spin" aria-hidden /> : <ArrowCounterClockwise size={13} aria-hidden />}
              Reabrir
            </Button>
          )}
          {status === 'new' && <span className="text-[10px] text-zinc-600">sin decisiones registradas</span>}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-zinc-300 ${mono ? 'font-mono text-[11px]' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  )
}
