'use client'

// v2 · Investigar: one query of tokens scopes the telemetry, and the same
// events are seen through several lenses — the stream, the process tree,
// the host timeline, rarity and the network — with the open event on the
// side to pivot from. The SQL console, the hunt notebooks and the analyst
// sit next to them. Mode, query, source, range, open event, host and
// process live in the URL (modo, q, fuente, rango, evento, equipo, pid).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowClockwise, CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import type { SfEvent } from '@/lib/console-types'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import {
  addToken,
  formatQuery,
  HISTORY_RANGES,
  historyRangeFromParam,
  hostCounts,
  MODES,
  modeFromParam,
  parseQuery,
  sourceFromParam,
  timeSpan,
  type HistoryRange,
  type InvestigateMode,
  type QueryToken,
  type Source,
} from '@/lib/v2/investigate-model'
import { Toast, type ToastState } from '../alerts/toast'
import { useMedia } from '../use-media'
import { AnalystProvider } from '@/components/console/socket-provider'
import { AssistedAnalyst } from './assisted-analyst'
import { EventDetail } from './event-detail'
import { EventStream } from './event-stream'
import { HostTimeline } from './host-timeline'
import { HuntNotebook } from './hunt-notebook'
import { NetworkView } from './network-view'
import { HistStrip } from './parts'
import { ProcessTree } from './process-tree'
import { QueryBar } from './query-bar'
import { RarityView } from './rarity-view'
import { SqlConsole } from './sql-console'
import { LIVE_MAX, useInvestigation } from './use-investigation'

const HOST_LENSES: readonly InvestigateMode[] = ['arbol', 'cronologia']
const DETAIL_LENSES: readonly InvestigateMode[] = ['flujo', 'arbol', 'cronologia', 'rarezas', 'red']
const QUERY_MODES: readonly InvestigateMode[] = ['flujo', 'arbol', 'cronologia', 'rarezas', 'red', 'analista']

export function InvestigateView() {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const { events: live, alerts } = useEngine()
  const drawer = useMedia('(max-width: 1180px)')

  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<InvestigateMode>('flujo')
  const [q, setQ] = useState('')
  const [source, setSource] = useState<Source>('vivo')
  const [range, setRange] = useState<HistoryRange>('24h')
  const [eventId, setEventId] = useState<string | null>(null)
  const [selected, setSelected] = useState<SfEvent | null>(null)
  const [host, setHost] = useState<string | null>(null)
  const [pid, setPid] = useState<number | null>(null)
  const [trail, setTrail] = useState<{ label: string; q: string }[]>([])
  const [sqlSeed, setSqlSeed] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState>(null)

  // the URL is read once and on history moves, and kept in step after
  useEffect(() => {
    const apply = () => {
      const p = new URLSearchParams(currentSearch())
      setMode(modeFromParam(p.get('modo')))
      setQ(p.get('q') ?? '')
      setSource(sourceFromParam(p.get('fuente')))
      setRange(historyRangeFromParam(p.get('rango')))
      setEventId(p.get('evento'))
      setHost(p.get('equipo'))
      const n = Number(p.get('pid'))
      setPid(p.get('pid') && Number.isInteger(n) ? n : null)
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return
    replaceOperatorState((search) => {
      let s = setSearchParam(search, 'modo', mode === 'flujo' ? null : mode)
      s = setSearchParam(s, 'q', q || null)
      s = setSearchParam(s, 'fuente', source === 'vivo' ? null : source)
      s = setSearchParam(s, 'rango', source === 'historico' && range !== '24h' ? range : null)
      s = setSearchParam(s, 'evento', eventId)
      s = setSearchParam(s, 'equipo', HOST_LENSES.includes(mode) ? host : null)
      return setSearchParam(s, 'pid', mode === 'arbol' && pid !== null ? String(pid) : null)
    })
  }, [ready, mode, q, source, range, eventId, host, pid])

  const tokens = useMemo(() => parseQuery(q), [q])
  const setTokens = useCallback((next: QueryToken[]) => setQ(formatQuery(next, lang)), [lang])
  const hostLens = HOST_LENSES.includes(mode)

  // the host lenses look at one machine: the picked one, the query's, the
  // open event's or the busiest one in memory
  const tokenHost = tokens.find((x) => x.field === 'host' && !x.negate)?.value ?? null
  const focusHost = host ?? tokenHost ?? selected?.host ?? hostCounts(live)[0]?.host ?? null
  const scope = useMemo<QueryToken[]>(
    () => (hostLens && focusHost ? [{ field: 'host', value: focusHost, negate: false }] : tokens),
    [hostLens, focusHost, tokens],
  )
  const inv = useInvestigation(scope, source, range)

  // an event named in the URL is found once it is loaded
  useEffect(() => {
    if (!eventId) {
      setSelected(null)
      return
    }
    if (selected?.id === eventId) return
    const found = inv.base.find((e) => e.id === eventId) ?? live.find((e) => e.id === eventId)
    if (found) setSelected(found)
  }, [eventId, inv.base, live, selected])

  const notice = useCallback((message: string) => setToast({ id: Date.now(), message }), [])
  const select = useCallback((ev: SfEvent) => {
    setSelected(ev)
    setEventId(ev.id)
  }, [])
  const closeDetail = useCallback(() => {
    setSelected(null)
    setEventId(null)
  }, [])

  const pivot = (token: QueryToken) => {
    const next = formatQuery(addToken(tokens, token), lang)
    if (next === q) return
    setTrail((tr) => [...(tr.length ? tr : [{ label: t.trailStart, q }]), { label: token.value, q: next }].slice(-8))
    setQ(next)
    if (token.field === 'host' && hostLens) setHost(token.value)
  }

  useEffect(() => {
    if (!selected) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) closeDetail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, closeDetail])

  const hosts = useMemo(() => {
    // the same event can be in memory and in the history read: count it once
    const unique = new Map([...live, ...inv.base].map((e) => [e.id, e]))
    const list = hostCounts([...unique.values()])
    if (focusHost && !list.some((h) => h.host === focusHost)) list.unshift({ host: focusHost, count: 0 })
    return list
  }, [live, inv.base, focusHost])

  const contextAlerts = useMemo(() => {
    if (tokens.length === 0) return alerts
    const ids = new Set(inv.events.map((e) => e.id))
    const h = tokenHost?.toLowerCase()
    return alerts.filter((a) => ids.has(a.event_id) || (!!h && a.host.toLowerCase() === h))
  }, [alerts, inv.events, tokens, tokenHost])

  const span = timeSpan(inv.events)
  const detailMode = DETAIL_LENSES.includes(mode)
  const scopeLine =
    source === 'vivo' ? t.scopeLive(inv.events.length, LIVE_MAX) : inv.loading ? t.loading : t.scopeHistory(inv.events.length, inv.base.length)

  let lens: React.ReactNode = null
  if (mode === 'flujo') lens = <EventStream inv={inv} tokens={tokens} onTokens={setTokens} live={source === 'vivo'} selectedId={eventId} onSelect={select} />
  else if (mode === 'arbol' || mode === 'cronologia') {
    const picker = (
      <label className="v2-select v2-inv-host">
        <span>{t.hostLabel}</span>
        <select
          className="v2-mono"
          value={focusHost ?? ''}
          onChange={(e) => {
            setHost(e.target.value || null)
            setPid(null)
          }}
        >
          {hosts.length === 0 && <option value="">{t.hostNone}</option>}
          {hosts.map((h) => (
            <option key={h.host} value={h.host}>
              {h.host}
              {h.count ? ` · ${h.count}` : ''}
            </option>
          ))}
        </select>
      </label>
    )
    lens = (
      <>
        {picker}
        {!focusHost ? null : mode === 'arbol' ? (
          <ProcessTree events={inv.events} alerts={alerts} host={focusHost} focusPid={pid} tokens={tokens} selectedId={eventId} onSelect={select} />
        ) : (
          <HostTimeline events={inv.events} alerts={alerts} host={focusHost} tokens={tokens} selectedId={eventId} onSelect={select} />
        )}
      </>
    )
  } else if (mode === 'rarezas')
    lens = (
      <RarityView
        events={inv.events}
        selectedId={eventId}
        onPivot={pivot}
        onSelect={(id) => {
          const ev = inv.events.find((e) => e.id === id)
          if (ev) select(ev)
        }}
        onSql={(sql) => {
          setSqlSeed(sql)
          setMode('sql')
        }}
      />
    )
  else if (mode === 'red') lens = <NetworkView events={inv.events} alerts={alerts} onPivot={pivot} />

  return (
    <div className="v2-inv">
      <div className="v2-tabs v2-inv-modes" role="tablist" aria-label={t.modesAria}>
        {MODES.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === mode} onClick={() => setMode(m)}>
            {t.modes[m]}
          </button>
        ))}
      </div>

      {QUERY_MODES.includes(mode) && (
        <div className="v2-panel v2-inv-search">
          <QueryBar tokens={tokens} onTokens={setTokens} events={source === 'vivo' ? live : inv.base} onNotice={notice} />
          <div className="v2-inv-source">
            <div className="v2-seg" role="group" aria-label={t.sourceAria}>
              {(['vivo', 'historico'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)}>
                  {t.source[s]}
                </button>
              ))}
            </div>
            {source === 'historico' && (
              <>
                <label className="v2-select v2-inv-range">
                  <span className="v2-sr-only">{t.rangeLabel}</span>
                  <select value={range} onChange={(e) => setRange(e.target.value as HistoryRange)}>
                    {HISTORY_RANGES.map((r) => (
                      <option key={r} value={r}>
                        {t.ranges[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="v2-icon-btn" onClick={inv.refresh} aria-label={t.refresh} title={t.refresh}>
                  <ArrowClockwise aria-hidden="true" />
                </button>
              </>
            )}
            <span className="v2-dim v2-small v2-inv-scope" role="status">
              {scopeLine}
            </span>
          </div>
          {inv.error && <p className="v2-error">{t.historyError(inv.error)}</p>}
          {inv.truncated && <p className="v2-dim v2-small">{t.truncated(inv.base.length)}</p>}
          {trail.length > 1 && (
            <nav className="v2-trail" aria-label={t.trailAria}>
              <ol>
                {trail.map((c, i) => (
                  <li key={`${i}-${c.q}`}>
                    {i > 0 && <CaretRight aria-hidden="true" />}
                    {i === trail.length - 1 ? (
                      <span className="v2-mono" aria-current="step">
                        {c.label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="v2-link v2-mono"
                        onClick={() => {
                          setQ(c.q)
                          setTrail((tr) => (i === 0 ? [] : tr.slice(0, i + 1)))
                        }}
                      >
                        {c.label}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {mode === 'flujo' && span && inv.events.length > 1 && <HistStrip events={inv.events} from={span.from} to={span.to} />}
        </div>
      )}

      {detailMode ? (
        <div className="v2-triage v2-investigate" data-drawer={drawer} data-detail={selected ? 'open' : 'closed'}>
          <section className="v2-panel v2-queue v2-inv-lens" aria-label={t.modes[mode]}>
            {lens}
          </section>
          {drawer && <div className="v2-scrim" aria-hidden="true" onClick={closeDetail} />}
          <aside className="v2-panel v2-detail" aria-label={t.detailAria} inert={drawer && !selected ? true : undefined}>
            {eventId && !selected ? (
              <p className="v2-dim v2-small">{t.notInData}</p>
            ) : (
              <EventDetail
                key={selected?.id ?? 'none'}
                ev={selected}
                events={inv.base}
                onPivot={pivot}
                onClose={closeDetail}
                onTree={(ev) => {
                  setHost(ev.host)
                  setPid(ev.process?.pid ?? null)
                  setMode('arbol')
                }}
                onTimeline={(ev) => {
                  setHost(ev.host)
                  setMode('cronologia')
                }}
                onNotice={notice}
                autoFocus={drawer}
                drawer={drawer}
              />
            )}
          </aside>
        </div>
      ) : (
        <section className="v2-panel v2-inv-tool" aria-label={t.modes[mode]}>
          {mode === 'sql' && <SqlConsole initial={sqlSeed} />}
          {mode === 'cuaderno' && (
            <HuntNotebook
              onNotice={notice}
              onOpenInFlow={(text) => {
                setQ(text)
                setSource('historico')
                setMode('flujo')
              }}
            />
          )}
          {/* the analyst channel opens only while its mode is on screen */}
          {mode === 'analista' && (
            <AnalystProvider>
              <AssistedAnalyst alerts={contextAlerts} />
            </AnalystProvider>
          )}
        </section>
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
