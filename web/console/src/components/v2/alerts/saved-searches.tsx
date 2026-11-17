'use client'

// Alertas · búsquedas guardadas: the queue's lens (severity, state,
// assignment, text and live or history) saved under a name in this
// browser, applied in one click, and the one in use shown on the button
// with a way back to the whole queue.
import { useEffect, useRef, useState } from 'react'
import { BookmarkSimple, Trash, X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { AlertScope } from '@/lib/alert-search'
import { DEFAULT_LENS, type QueueLens } from '@/lib/v2/alerts-model'
import {
  activeAlertSearch,
  ALERT_SEARCHES_KEY,
  parseAlertSearches,
  removeAlertSearch,
  saveAlertSearch,
  type SavedAlertSearch,
} from '@/lib/v2/saved-alert-searches'

function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function SavedSearches({
  lens,
  scope,
  onApply,
  onNotice,
}: {
  lens: QueueLens
  scope: AlertScope
  onApply: (lens: QueueLens, scope: AlertScope) => void
  onNotice: (message: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.alertsView.saved
  const [list, setList] = useState<SavedAlertSearch[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      setList(parseAlertSearches(window.localStorage.getItem(ALERT_SEARCHES_KEY)))
    } catch {
      setError(t.storageError)
    }
  }, [t.storageError])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const persist = (next: SavedAlertSearch[]) => {
    setList(next)
    try {
      window.localStorage.setItem(ALERT_SEARCHES_KEY, JSON.stringify(next))
      return true
    } catch {
      setError(t.storageError)
      return false
    }
  }

  const describe = (l: QueueLens, s: AlertScope): string[] => {
    const parts: string[] = []
    if (l.sev !== 'all') parts.push(dict.v2.sev[l.sev])
    if (l.state !== 'all') parts.push(dict.alerts.stateOptions[l.state])
    if (l.assignee !== 'all') parts.push(dict.alerts.assigneeOptions[l.assignee])
    if (l.q) parts.push(`«${l.q}»`)
    if (s === 'history') parts.push(dict.alerts.scopeHistory)
    return parts.length ? parts : [t.allFilters]
  }

  const active = activeAlertSearch(list, lens, scope)

  const save = () => {
    setError('')
    const r = saveAlertSearch(list, name, lens, scope, newId())
    if (!r.ok) return setError(r.error === 'name' ? t.errName : t.errFull)
    if (persist(r.list)) {
      setName('')
      onNotice(t.savedToast(r.saved.name))
    }
  }

  return (
    <div className="v2-saved" ref={box}>
      <div className="v2-saved-trigger">
        <button type="button" className="v2-btn" aria-expanded={open} aria-haspopup="dialog" data-active={active !== undefined} onClick={() => setOpen((v) => !v)}>
          <BookmarkSimple weight={active ? 'fill' : 'regular'} aria-hidden="true" />
          <span>{active ? active.name : t.button}</span>
        </button>
        {active && (
          <button type="button" className="v2-icon-btn" aria-label={t.clear(active.name)} title={t.clear(active.name)} onClick={() => onApply(DEFAULT_LENS, 'live')}>
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="v2-saved-menu" role="dialog" aria-label={t.menuAria}>
          {list.length === 0 ? (
            <p className="v2-small v2-dim">{t.empty}</p>
          ) : (
            <ul className="v2-saved-list">
              {list.map((s) => (
                <li key={s.id} data-active={s.id === active?.id}>
                  <button
                    type="button"
                    className="v2-saved-apply"
                    aria-label={t.apply(s.name)}
                    onClick={() => {
                      onApply(s.lens, s.scope)
                      setOpen(false)
                    }}
                  >
                    <strong>{s.name}</strong>
                    <span className="v2-saved-chips">
                      {describe(s.lens, s.scope).map((p) => (
                        <span key={p} className="v2-tag">
                          {p}
                        </span>
                      ))}
                    </span>
                  </button>
                  <button type="button" className="v2-icon-btn" aria-label={t.remove(s.name)} title={t.remove(s.name)} onClick={() => persist(removeAlertSearch(list, s.id))}>
                    <Trash aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="v2-saved-form"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <span className="v2-eyebrow">{t.saveTitle}</span>
            <span className="v2-saved-chips">
              {describe(lens, scope).map((p) => (
                <span key={p} className="v2-tag">
                  {p}
                </span>
              ))}
            </span>
            <div className="v2-saved-row">
              <input className="v2-input" value={name} maxLength={60} placeholder={t.namePlaceholder} aria-label={t.nameAria} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="v2-btn v2-btn-primary" disabled={!name.trim()}>
                {t.save}
              </button>
            </div>
            {error && <p className="v2-small v2-warn">{error}</p>}
            <p className="v2-small v2-dim">{t.local}</p>
          </form>
        </div>
      )}
    </div>
  )
}
