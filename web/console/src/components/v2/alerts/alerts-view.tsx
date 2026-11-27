'use client'

// v2 · Alertas: the triage queue of the command center. One lens of
// severity, state, assignment and search over the live ring (or the
// engine's history), shown three ways: the list with the open alert
// beside it (grouped by host if asked, with the last hour on a timeline
// and bulk actions), a board by state, or one alert at a time in focus
// mode. On a tablet the open alert slides in as a drawer; on a phone the
// queue is a list of cards that swipe to acknowledge or close.
//
// The lens lives in the URL with the same keys as the classic queue (sev,
// q, estado, historial, alert), plus the v2 view (vista) and grouping
// (agrupar), so a link opens the same queue. The assignment lens stays out
// of the URL on purpose, as in the classic queue: it is volatile.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { useAlertHistory } from '@/hooks/use-alert-history'
import { alertKey } from '@/lib/engine-client'
import { matchesAssignee, type AlertScope } from '@/lib/alert-search'
import { currentSearch, readAlertLens, readOperatorState, replaceOperatorState, writeAlertLens } from '@/lib/url-state'
import type { SfAlert, SfAlertStatus } from '@/lib/console-types'
import {
  DEFAULT_LENS, bulkChanges, isFiltering, queueAlerts, queueViewFromParam, setSearchParam, severityChips,
  type QueueLens, type QueueView,
} from '@/lib/v2/alerts-model'
import { Empty } from '../home/parts'
import { useMedia } from '../use-media'
import { QueueToolbar } from './queue-toolbar'
import { QueueTable } from './queue-table'
import { QueueList } from './queue-list'
import { Timeline } from './timeline'
import { BulkBar, type Notice } from './bulk-bar'
import { SavedSearches } from './saved-searches'
import { Board } from './board'
import { FocusMode } from './focus'
import { AlertDetail } from './alert-detail'
import { Toast, type ToastState } from './toast'
import { undoWrite, useStatusWriter } from './writes'

const VIEWS: readonly QueueView[] = ['lista', 'tablero', 'foco']

export function AlertsView() {
  const { alerts, status, lifecycleUpdates } = useEngine()
  const { dict } = useI18n()
  const me = useConsoleUser()
  const t = dict.v2.alertsView
  const phone = useMedia('(max-width: 640px)')
  const narrow = useMedia('(max-width: 1180px)')
  const write = useStatusWriter()

  const [lens, setLensState] = useState<QueueLens>(DEFAULT_LENS)
  const [scope, setScopeState] = useState<AlertScope>('live')
  const [view, setViewState] = useState<QueueView>('lista')
  const [grouped, setGrouped] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState>(null)
  const [ready, setReady] = useState(false)

  // The URL is the source on mount and on back/forward (read after mount:
  // the server render knows no query string)...
  useEffect(() => {
    const apply = () => {
      const search = currentSearch()
      const op = readOperatorState(search)
      const al = readAlertLens(search)
      const params = new URLSearchParams(search)
      setLensState((prev) => ({ ...prev, sev: op.sev, q: op.q, state: al.state }))
      setScopeState(al.scope)
      setSelectedKey(al.alert)
      setViewState(queueViewFromParam(params.get('vista')))
      setGrouped(params.get('agrupar') === 'equipo')
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  // ...and every change writes it back (typing settles first)
  useEffect(() => {
    if (!ready) return undefined
    const id = window.setTimeout(() => {
      replaceOperatorState((search) => {
        const lensed = writeAlertLens(search, lens.sev, lens.q, lens.state, scope, selectedKey)
        return setSearchParam(setSearchParam(lensed, 'vista', view === 'lista' ? null : view), 'agrupar', grouped ? 'equipo' : null)
      })
    }, 200)
    return () => window.clearTimeout(id)
  }, [ready, lens.sev, lens.q, lens.state, scope, selectedKey, view, grouped])

  // A new lens describes another queue: the open alert closes with it.
  const setLens = (patch: Partial<QueueLens>) => {
    setLensState((prev) => ({ ...prev, ...patch }))
    setSelectedKey(null)
  }
  const setScope = (next: AlertScope) => {
    setScopeState(next)
    setSelectedKey(null)
  }
  const setView = (next: QueueView) => {
    setViewState(next)
    setPicked(new Set())
  }

  const history = useAlertHistory(ready && scope === 'history', { severity: lens.sev, state: lens.state, q: lens.q }, status, lifecycleUpdates)
  const historyMode = scope === 'history'
  const visible = useMemo(
    () => (historyMode ? history.items.filter((a) => matchesAssignee(a, lens.assignee, me.name)) : queueAlerts(alerts, lens, me.name)),
    [historyMode, history.items, alerts, lens, me.name],
  )
  const chips = useMemo(() => (historyMode ? null : severityChips(alerts, lens, me.name)), [historyMode, alerts, lens, me.name])
  const pickedAlerts = useMemo(() => visible.filter((a) => picked.has(alertKey(a))), [visible, picked])

  // The open alert follows the live data (a triage decision lands in the
  // panel as soon as the stream delivers it); gone from the data, it closes.
  const selected = useMemo(() => {
    if (selectedKey === null) return null
    return visible.find((a) => alertKey(a) === selectedKey) ?? (historyMode ? null : alerts.find((a) => alertKey(a) === selectedKey) ?? null)
  }, [selectedKey, visible, alerts, historyMode])
  const linkedMissing = ready && selectedKey !== null && selected === null && status === 'live' && !historyMode && alerts.length > 0
  const drawer = view === 'tablero' || narrow
  const detailOpen = view !== 'foco' && selected !== null

  const notify = useCallback((n: Notice) => setToast({ id: Date.now(), ...n }), [])
  const closeToast = useCallback(() => setToast(null), [])
  const closeDetail = useCallback(() => setSelectedKey(null), [])

  // One alert to another state (board, focus mode, swipe), with its undo.
  const move = useCallback(
    async (alert: SfAlert, to: SfAlertStatus) => {
      const changes = bulkChanges([alert], to)
      if (changes.length === 0) return
      const result = await write(changes, to)
      notify({
        message: result.ok ? t.toast.done[to](1) : t.toast.failed(1, result.firstError),
        undo: result.done.length ? () => undoWrite(write, result.done) : undefined,
      })
    },
    [write, notify, t],
  )

  // Screen readers hear about genuinely new alerts, once per arrival.
  const [announcement, setAnnouncement] = useState('')
  const knownTop = useRef<string | null>(null)
  useEffect(() => {
    const top = alerts[0]
    if (!top) return
    const key = alertKey(top)
    if (knownTop.current !== null && knownTop.current !== key) {
      setAnnouncement(dict.alerts.arrival(dict.v2.sev[top.severity], top.rule_name, top.host))
    }
    knownTop.current = key
  }, [alerts, dict])

  // Escape closes the open alert (focus mode has its own keys).
  useEffect(() => {
    if (!detailOpen) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) setSelectedKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailOpen])

  const togglePick = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleAll = () => {
    const keys = visible.map(alertKey)
    setPicked((prev) => (keys.length > 0 && keys.every((k) => prev.has(k)) ? new Set() : new Set(keys)))
  }

  let body: React.ReactNode
  if (status === 'down' && !historyMode) {
    body = <Empty title={dict.alerts.offlineTitle}>{dict.alerts.offlineHintFull}</Empty>
  } else if (historyMode && history.error) {
    body = <Empty title={dict.alerts.offlineTitle}>{dict.alerts.historyErrors[history.error]}</Empty>
  } else if (historyMode && history.loading && visible.length === 0) {
    body = <Empty title={t.historyLoading} />
  } else if (visible.length === 0) {
    if (!historyMode && alerts.length === 0) body = <Empty title={dict.alerts.emptyTitle}>{dict.alerts.emptyHintFull}</Empty>
    else if (lens.assignee === 'mine' && !lens.q && lens.sev === 'all') body = <Empty title={dict.alerts.emptyMineTitle}>{dict.alerts.emptyMineHint}</Empty>
    else if (lens.assignee === 'unassigned' && !lens.q && lens.sev === 'all') body = <Empty title={dict.alerts.emptyUnassignedTitle}>{dict.alerts.emptyUnassignedHint}</Empty>
    else
      body = (
        <Empty title={dict.alerts.noResultsTitle}>
          {dict.alerts.noResultsHintLens}{' '}
          <button type="button" className="v2-link" onClick={() => setLens(DEFAULT_LENS)}>
            {dict.alerts.clearFilters}
          </button>
        </Empty>
      )
  } else if (view === 'foco') {
    body = <FocusMode alerts={visible} selectedKey={selectedKey} onSelect={setSelectedKey} onMove={(a, to) => void move(a, to)} onExit={() => setView('lista')} />
  } else if (view === 'tablero') {
    body = <Board alerts={visible} selectedKey={selected ? alertKey(selected) : null} onSelect={setSelectedKey} onMove={(a, to) => void move(a, to)} />
  } else if (phone) {
    body = <QueueList alerts={visible} onSelect={setSelectedKey} onSwipe={(a, to) => void move(a, to)} />
  } else {
    body = (
      <QueueTable
        alerts={visible}
        selectedKey={selected ? alertKey(selected) : null}
        onSelect={setSelectedKey}
        picked={picked}
        onPick={togglePick}
        onPickAll={toggleAll}
        grouped={grouped}
      />
    )
  }

  const total = historyMode ? visible.length : alerts.length
  return (
    <div className="v2-triage" data-view={view} data-drawer={drawer} data-detail={detailOpen ? 'open' : 'closed'}>
      <section className="v2-panel v2-queue" aria-labelledby="v2-queue-title">
        <div className="v2-panel-head">
          <div>
            <h2 id="v2-queue-title">{t.queueTitle}</h2>
            <p>{historyMode ? dict.alerts.showingPage(visible.length) : t.showing(visible.length, total)}</p>
          </div>
          <div className="v2-actions">
            {isFiltering(lens) && (
              <button type="button" className="v2-btn" onClick={() => setLens(DEFAULT_LENS)}>
                {dict.alerts.clearFilters}
              </button>
            )}
            <div className="v2-seg" role="group" aria-label={t.viewAria}>
              {VIEWS.map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                  {t.views[v]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <QueueToolbar
          lens={lens}
          onLens={setLens}
          chips={chips}
          scope={scope}
          onScope={setScope}
          saved={
            <SavedSearches
              lens={lens}
              scope={scope}
              onApply={(next, nextScope) => {
                setLens(next)
                setScope(nextScope)
              }}
              onNotice={(message) => notify({ message })}
            />
          }
        />
        {view === 'lista' && !phone && (
          <label className="v2-check">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
            {t.group}
          </label>
        )}
        {view !== 'foco' && !historyMode && visible.length > 0 && <Timeline alerts={visible} selectedKey={selected ? alertKey(selected) : null} onSelect={setSelectedKey} />}
        {linkedMissing && (
          <p className="v2-note">
            {t.linkedMissing}{' '}
            <button type="button" className="v2-link" onClick={() => setScopeState('history')}>
              {t.linkedSearch}
            </button>
          </p>
        )}
        {body}
        {historyMode && history.page && (
          <nav className="v2-pager" aria-label={dict.alerts.pagesAria}>
            <button type="button" className="v2-btn" disabled={!history.canPrevious || history.loading} onClick={history.previous}>
              {dict.alerts.previous}
            </button>
            <span className="v2-dim">{dict.alerts.page(history.pageNumber)}</span>
            <button type="button" className="v2-btn" disabled={!history.page.has_more || history.loading} onClick={history.next}>
              {history.page.scan_limited ? dict.alerts.keepSearching : dict.alerts.next}
            </button>
          </nav>
        )}
        {view === 'lista' && pickedAlerts.length > 0 && <BulkBar alerts={pickedAlerts} onClear={() => setPicked(new Set())} onNotice={notify} />}
      </section>
      {view !== 'foco' && (
        <>
          {drawer && <div className="v2-scrim" aria-hidden="true" onClick={closeDetail} />}
          <aside className="v2-panel v2-detail" aria-label={dict.alerts.detailAria} inert={drawer && !detailOpen ? true : undefined}>
            {selected ? (
              <AlertDetail key={alertKey(selected)} alert={selected} onClose={closeDetail} autoFocus={drawer} />
            ) : (
              <Empty title={t.pickTitle}>{t.pickHint}</Empty>
            )}
          </aside>
        </>
      )}
      <Toast toast={toast} onClose={closeToast} />
      <div className="v2-sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
}
