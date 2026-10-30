'use client'

import { useEffect, useId, useState } from 'react'
import { BookmarkSimple, CaretDown, FloppyDisk, Trash } from '@phosphor-icons/react'
import {
  describeSavedLens, MAX_SEARCH_NAME, readSavedSearches, SAVED_SEARCH_KEY,
  searchName, upsertSavedSearch, writeSavedSearches, type SavedLens, type SavedSearch,
} from '@/lib/saved-searches'
import { useI18n } from './i18n-provider'

type Props = { kind: SavedLens['kind']; getLens: () => SavedLens; onApply: (lens: SavedLens) => void }
const button = 'rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

export function SavedSearches({ kind, getLens, onApply }: Props) {
  const { dict, lang } = useI18n()
  const words = dict.savedSearches
  const id = useId()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SavedSearch[]>([])
  const [name, setName] = useState('')
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function read(): SavedSearch[] {
    // Access to localStorage itself can fail in a restricted browser.
    return readSavedSearches(window.localStorage)
  }

  useEffect(() => {
    function load() {
      try { setItems(read()); setError('') }
      catch { setError(words.readError); setItems([]) }
      setReady(true)
    }
    load()
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_SEARCH_KEY || event.key === null) { load(); setMessage('') }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [words])

  function save(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    try {
      const current = read() // Include changes made in another tab.
      const lens = getLens() // Include typing that has not yet reached the URL.
      if (lens.kind !== kind) throw new Error(dict.savedSearches.wrongView)
      const bytes = window.crypto.getRandomValues(new Uint8Array(16))
      const entry = { id: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''), name: searchName(name), lens }
      const updated = upsertSavedSearch(current, entry)
      writeSavedSearches(window.localStorage, updated)
      setItems(updated)
      setName('')
      setError('')
      setMessage(updated.length === current.length ? words.updated : words.saved)
    } catch (cause) {
      setError(saveErrorText(cause))
    }
  }

  // The library validates in Spanish; Spanish shows its words as they are,
  // English maps each kind of refusal to the dictionary.
  function saveErrorText(cause: unknown): string {
    const text = cause instanceof Error ? cause.message : ''
    if (text === words.wrongView) return text
    if (!/búsqueda|nombre|filtro|registro/i.test(text)) return words.saveError
    if (lang === 'es') return text
    return /nombre/i.test(text) ? words.nameRule(MAX_SEARCH_NAME) : words.incompatible
  }

  function remove(item: SavedSearch) {
    setMessage('')
    try {
      const updated = read().filter((entry) => entry.id !== item.id)
      writeSavedSearches(window.localStorage, updated)
      setItems(updated)
      setError('')
      setMessage(words.removed)
    } catch { setError(words.removeError) }
  }

  const visible = items.filter((item) => item.lens.kind === kind)
  return (
    <div className="mb-4 min-w-0">
      <button type="button" className={`${button} inline-flex items-center gap-2`} onClick={() => setOpen((value) => !value)}
        aria-expanded={open} aria-controls={`${id}-searches`}>
        <BookmarkSimple size={14} aria-hidden /> {words.title}
        <span className="font-mono text-zinc-500">{visible.length}</span>
        <CaretDown size={12} aria-hidden className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div id={`${id}-searches`} role="region" aria-label={words.title} className="mt-2 min-w-0 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="mb-3 text-xs text-zinc-500">{words.prose}</p>
          <form onSubmit={save} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-zinc-400" htmlFor={`${id}-name`}>{words.nameLabel}
              <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_SEARCH_NAME}
                autoComplete="off" className="mt-1 block h-8 w-full min-w-[150px] rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <button type="submit" disabled={!ready || !name.trim()} className={`${button} inline-flex items-center gap-1.5`}>
              <FloppyDisk size={13} aria-hidden /> {words.save}
            </button>
          </form>
          {error && <p role="alert" className="mt-2 text-xs text-amber-300">{error}</p>}
          <p role="status" className="mt-2 text-xs text-emerald-400">{message}</p>
          {visible.length === 0 ? <p className="mt-3 text-xs text-zinc-500">{words.empty}</p> : (
            <ul aria-label={words.listAria} className="mt-3 space-y-2">
              {visible.map((item) => (
                <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-zinc-800 p-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs text-zinc-200">{item.name}</p>
                    <p className="mt-1 truncate text-[11px] text-zinc-500" title={describeSavedLens(item.lens, lang)}>{describeSavedLens(item.lens, lang)}</p>
                  </div>
                  <button type="button" className={button} aria-label={words.applyAria(item.name)} onClick={() => { onApply(item.lens); setOpen(false) }}>{words.apply}</button>
                  <button type="button" className={button} aria-label={words.removeAria(item.name)} onClick={() => remove(item)}><Trash size={14} aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
