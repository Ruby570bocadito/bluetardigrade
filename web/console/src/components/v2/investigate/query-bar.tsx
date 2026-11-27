'use client'

// The query of Investigar as tokens (boceto 2): what is typed becomes a
// chip on Enter, a chip toggles between include and exclude, and the
// suggestions come from the values the events really carry, with how
// often they appear. Searches can be saved by name in this browser.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { BookmarkSimple, MagnifyingGlass, X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfEvent } from '@/lib/console-types'
import {
  addToken,
  FIELD_KEYS,
  formatQuery,
  formatToken,
  parseQuery,
  readSavedQueries,
  suggest,
  upsertSavedQuery,
  writeSavedQueries,
  type QueryToken,
  type SavedQuery,
} from '@/lib/v2/investigate-model'

type Option = { id: string; kind: 'field' | 'value'; label: string; detail?: string; apply: () => void }

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function QueryBar({
  tokens,
  onTokens,
  events,
  onNotice,
}: {
  tokens: QueryToken[]
  onTokens: (tokens: QueryToken[]) => void
  events: SfEvent[]
  onNotice: (message: string) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // a suggestion picked with the arrows wins over the typed text on Enter
  const [navigated, setNavigated] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState<SavedQuery[]>([])

  useEffect(() => {
    const s = storage()
    if (s) setSaved(readSavedQueries(s))
  }, [])

  const commit = (text: string) => {
    let next = [...tokens]
    for (const tok of parseQuery(text)) next = addToken(next, tok)
    onTokens(next)
    setDraft('')
    setActive(0)
  }

  const options = useMemo<Option[]>(() => {
    if (!open) return []
    const { fields, values } = suggest(events, draft, lang)
    const negate = draft.startsWith('-')
    const out: Option[] = []
    for (const f of fields) {
      const key = FIELD_KEYS[lang][f]
      out.push({
        id: `f-${f}`,
        kind: 'field',
        label: `${key}:`,
        detail: t.fields[f],
        apply: () => {
          setDraft(`${negate ? '-' : ''}${key}:`)
          setActive(0)
          input.current?.focus()
        },
      })
    }
    for (const v of values) {
      out.push({
        id: `v-${v.field}-${v.value}`,
        kind: 'value',
        label: v.value,
        detail: `${t.fields[v.field]} · ${v.count}`,
        apply: () => commit(formatToken({ field: v.field, value: v.value, negate }, lang)),
      })
    }
    return out
    // commit closes over tokens; recomputed with them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, events, draft, lang, tokens, t])

  const remove = (i: number) => onTokens(tokens.filter((_, j) => j !== i))
  const toggle = (i: number) => onTokens(tokens.map((x, j) => (j === i ? { ...x, negate: !x.negate } : x)))

  const persist = (items: SavedQuery[]) => {
    setSaved(items)
    const s = storage()
    if (s) writeSavedQueries(s, items)
  }

  const saveCurrent = () => {
    const clean = name.trim()
    if (!clean || tokens.length === 0) return
    const rid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
    persist(upsertSavedQuery(saved, clean, formatQuery(tokens, lang), rid))
    setNaming(false)
    setName('')
    onNotice(t.savedDone(clean))
  }

  const listId = `${id}-list`
  const showList = open && options.length > 0

  return (
    <div className="v2-query">
      <div
        className="v2-query-box"
        onClick={(e) => {
          if (e.target === e.currentTarget) input.current?.focus()
        }}
      >
        <MagnifyingGlass aria-hidden="true" className="v2-query-icon" />
        <ul className="v2-tokens" aria-label={t.queryLabel}>
          {tokens.map((tok, i) => {
            const label = formatToken(tok, lang)
            return (
              <li key={`${label}-${i}`} className="v2-token" data-negate={tok.negate}>
                <button type="button" className="v2-token-main" onClick={() => toggle(i)} aria-label={t.negateToken(label)} title={t.negateToken(label)}>
                  {tok.negate && <span className="v2-token-not">{t.not}</span>}
                  <span className="v2-token-field">{tok.field ? t.fields[tok.field] : t.text}</span>
                  <span className="v2-token-value">{tok.value}</span>
                </button>
                <button type="button" className="v2-token-x" onClick={() => remove(i)} aria-label={t.removeToken(label)}>
                  <X aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
        <input
          ref={input}
          id={`${id}-input`}
          className="v2-query-input"
          value={draft}
          placeholder={tokens.length ? '' : t.queryPlaceholder}
          aria-label={t.queryLabel}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
            setActive(0)
            setNavigated(false)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && showList) {
              e.preventDefault()
              setNavigated(true)
              setActive((a) => (a + 1) % options.length)
            } else if (e.key === 'ArrowUp' && showList) {
              e.preventDefault()
              setNavigated(true)
              setActive((a) => (a - 1 + options.length) % options.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const typed = draft.trim()
              // typed text is added as it is, unless a suggestion was picked
              // with the arrows or only a field name is there so far
              if (showList && (navigated || !typed || typed.endsWith(':'))) options[active]?.apply()
              else if (typed) commit(typed)
              setNavigated(false)
            } else if (e.key === 'Escape') {
              setOpen(false)
            } else if (e.key === 'Backspace' && !draft && tokens.length) {
              remove(tokens.length - 1)
            }
          }}
        />
        {tokens.length > 0 && (
          <button type="button" className="v2-icon-btn" onClick={() => onTokens([])} aria-label={t.clearQuery} title={t.clearQuery}>
            <X aria-hidden="true" />
          </button>
        )}
        {showList && (
          <ul className="v2-suggest" id={listId} role="listbox" aria-label={t.queryLabel}>
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                data-kind={o.kind}
                onMouseDown={(e) => {
                  e.preventDefault()
                  o.apply()
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="v2-suggest-label">{o.label}</span>
                {o.detail && <span className="v2-suggest-detail">{o.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="v2-query-side">
        {naming ? (
          <form
            className="v2-query-name"
            onSubmit={(e) => {
              e.preventDefault()
              saveCurrent()
            }}
          >
            <input className="v2-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.saveName} aria-label={t.saveName} maxLength={80} autoFocus />
            <button type="submit" className="v2-btn v2-btn-primary" disabled={!name.trim()}>
              {t.saveConfirm}
            </button>
            <button type="button" className="v2-icon-btn" onClick={() => setNaming(false)} aria-label={t.close}>
              <X aria-hidden="true" />
            </button>
          </form>
        ) : (
          <>
            <button type="button" className="v2-btn" disabled={tokens.length === 0} onClick={() => setNaming(true)}>
              {t.save}
            </button>
            <div className="v2-popover-anchor">
              <button type="button" className="v2-btn" aria-expanded={savedOpen} onClick={() => setSavedOpen((o) => !o)}>
                <BookmarkSimple aria-hidden="true" />
                {t.saved}
                {saved.length > 0 && <b className="v2-mono">{saved.length}</b>}
              </button>
              {savedOpen && (
                <div className="v2-popover" role="dialog" aria-label={t.savedTitle}>
                  <strong>{t.savedTitle}</strong>
                  {saved.length === 0 ? (
                    <p className="v2-dim v2-small">{t.savedNone}</p>
                  ) : (
                    <ul className="v2-saved-list">
                      {saved.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            className="v2-saved-main"
                            onClick={() => {
                              onTokens(parseQuery(s.q))
                              setSavedOpen(false)
                            }}
                          >
                            <span>{s.name}</span>
                            <span className="v2-mono v2-dim v2-small">{s.q}</span>
                          </button>
                          <button type="button" className="v2-icon-btn" aria-label={t.deleteSaved(s.name)} onClick={() => persist(saved.filter((x) => x.id !== s.id))}>
                            <X aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <p className="v2-query-hint v2-dim v2-small">{t.queryHint}</p>
    </div>
  )
}
