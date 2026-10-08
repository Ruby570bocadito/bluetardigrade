'use client'

import { useEffect, useRef, useState } from 'react'
import type { EngineStatus } from './use-engine-stream'
import type { SfAlertLifecycle } from '@/lib/console-types'
import { EngineHttpError, engineApiBase, mapAlert, readEngineJson } from '@/lib/engine-client'
import {
  alertSearchPath, applyAlertLifecycle, matchesAlertState,
  type AlertSearchFilters, type AlertSearchPage,
} from '@/lib/alert-search'

export function useAlertHistory(enabled: boolean, filters: AlertSearchFilters, status: EngineStatus, lifecycleUpdates: SfAlertLifecycle[]) {
  const key = alertSearchPath(filters)
  const [navigation, setNavigation] = useState({ key, cursors: [''], index: 0 })
  const nav = navigation.key === key ? navigation : { key, cursors: [''], index: 0 }
  const cursor = nav.cursors[nav.index]
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; cursor: string; page: AlertSearchPage } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const decisions = useRef(new Map<string, SfAlertLifecycle>())
  const available = enabled && status === 'live'

  useEffect(() => {
    setNavigation((previous) => previous.key === key ? previous : { key, cursors: [''], index: 0 })
  }, [key])

  useEffect(() => {
    if (status === 'down') decisions.current.clear()
    for (const entry of lifecycleUpdates) {
      const previous = decisions.current.get(entry.alert_id)
      if (previous && (Date.parse(previous.at) || 0) > (Date.parse(entry.at) || 0)) continue
      decisions.current.delete(entry.alert_id)
      decisions.current.set(entry.alert_id, entry)
    }
    while (decisions.current.size > 128) decisions.current.delete(decisions.current.keys().next().value!)
    if (lifecycleUpdates.length === 0) return
    setResult((previous) => previous ? {
      ...previous,
      page: { ...previous.page, items: previous.page.items.map((a) => {
        const entry = a.id ? decisions.current.get(a.id) : undefined
        return entry ? applyAlertLifecycle(a, entry) : a
      }) },
    } : null)
  }, [lifecycleUpdates, status])

  useEffect(() => {
    setResult(null)
    setError(null)
    if (!available) { setLoading(false); return }
    const ctrl = new AbortController()
    setLoading(true)
    // Debounce typing; abort and discard an obsolete page immediately.
    const timer = setTimeout(() => {
      void readEngineJson<AlertSearchPage>(engineApiBase(), key + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), ctrl.signal)
        .then((raw) => {
          if (ctrl.signal.aborted) return
          const items = raw.items.map((a) => {
            const mapped = mapAlert(a as unknown as Record<string, unknown>)
            const decision = mapped.id ? decisions.current.get(mapped.id) : undefined
            return decision ? applyAlertLifecycle(mapped, decision) : mapped
          })
          setResult({ key, cursor, page: { ...raw, items } })
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return
          setError(err instanceof EngineHttpError && err.status === 404
            ? 'Este motor no ofrece búsqueda paginada. Actualiza el motor o usa la vista en vivo.'
            : err instanceof EngineHttpError && err.status === 400
              ? 'La búsqueda ha caducado o sus filtros han cambiado. Actualiza para empezar de nuevo.'
              : err instanceof EngineHttpError && err.status === 504
                ? 'La consulta superó su tiempo de lectura. Reduce la búsqueda por regla, host o severidad y vuelve a intentarlo.'
              : 'No se pudo consultar el histórico. Comprueba la conexión y vuelve a intentarlo.')
        })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [available, key, cursor, revision])

  const page = available && result?.key === key && result.cursor === cursor ? result.page : null
  const items = page?.items.filter((a) => matchesAlertState(a, filters.state)) ?? []
  function refresh() {
    setNavigation({ key, cursors: [''], index: 0 })
    setResult(null)
    setRevision((n) => n + 1)
  }
  function next() {
    if (!page?.has_more || loading) return
    const cursors = nav.cursors.slice(0, nav.index + 1)
    cursors[nav.index] = page.page_cursor
    cursors.push(page.next_cursor)
    setNavigation({ key, cursors, index: nav.index + 1 })
  }
  function previous() {
    if (nav.index > 0 && !loading) setNavigation({ ...nav, index: nav.index - 1 })
  }
  return { items, page, loading, error, pageNumber: nav.index + 1, canPrevious: nav.index > 0, next, previous, refresh }
}
