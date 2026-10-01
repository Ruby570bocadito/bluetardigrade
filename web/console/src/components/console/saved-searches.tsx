'use client'

import { useEffect, useId, useState } from 'react'
import { BookmarkSimple, CaretDown, FloppyDisk, Trash } from '@phosphor-icons/react'
import {
  describeSavedLens, MAX_SEARCH_NAME, readSavedSearches, SAVED_SEARCH_KEY,
  searchName, upsertSavedSearch, writeSavedSearches, type SavedLens, type SavedSearch,
} from '@/lib/saved-searches'

type Props = { kind: SavedLens['kind']; getLens: () => SavedLens; onApply: (lens: SavedLens) => void }
const button = 'rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

export function SavedSearches({ kind, getLens, onApply }: Props) {
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
      catch { setError('No se pudieron leer las búsquedas de este navegador. Los filtros siguen disponibles.'); setItems([]) }
      setReady(true)
    }
    load()
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_SEARCH_KEY || event.key === null) { load(); setMessage('') }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function save(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    try {
      const current = read() // Include changes made in another tab.
      const lens = getLens() // Include typing that has not yet reached the URL.
      if (lens.kind !== kind) throw new Error('Los filtros no corresponden a esta vista.')
      const bytes = window.crypto.getRandomValues(new Uint8Array(16))
      const entry = { id: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''), name: searchName(name), lens }
      const updated = upsertSavedSearch(current, entry)
      writeSavedSearches(window.localStorage, updated)
      setItems(updated)
      setName('')
      setError('')
      setMessage(updated.length === current.length ? 'Búsqueda actualizada.' : 'Búsqueda guardada.')
    } catch (cause) {
      setError(cause instanceof Error && /búsqueda|nombre|filtro|vista|registro/i.test(cause.message)
        ? cause.message : 'No se pudo guardar en este navegador. Los filtros siguen disponibles.')
    }
  }

  function remove(item: SavedSearch) {
    setMessage('')
    try {
      const updated = read().filter((entry) => entry.id !== item.id)
      writeSavedSearches(window.localStorage, updated)
      setItems(updated)
      setError('')
      setMessage('Búsqueda eliminada.')
    } catch { setError('No se pudo eliminar la búsqueda. Vuelve a intentarlo.') }
  }

  const visible = items.filter((item) => item.lens.kind === kind)
  return (
    <div className="mb-4 min-w-0">
      <button type="button" className={`${button} inline-flex items-center gap-2`} onClick={() => setOpen((value) => !value)}
        aria-expanded={open} aria-controls={`${id}-searches`}>
        <BookmarkSimple size={14} aria-hidden /> Búsquedas guardadas
        <span className="font-mono text-zinc-500">{visible.length}</span>
        <CaretDown size={12} aria-hidden className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div id={`${id}-searches`} role="region" aria-label="Búsquedas guardadas" className="mt-2 min-w-0 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="mb-3 text-xs text-zinc-500">Guarda los filtros actuales en este navegador. El mismo nombre actualiza la búsqueda.</p>
          <form onSubmit={save} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-zinc-400" htmlFor={`${id}-name`}>Nombre de búsqueda
              <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_SEARCH_NAME}
                autoComplete="off" className="mt-1 block h-8 w-full min-w-[150px] rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <button type="submit" disabled={!ready || !name.trim()} className={`${button} inline-flex items-center gap-1.5`}>
              <FloppyDisk size={13} aria-hidden /> Guardar filtros actuales
            </button>
          </form>
          {error && <p role="alert" className="mt-2 text-xs text-amber-300">{error}</p>}
          <p role="status" className="mt-2 text-xs text-emerald-400">{message}</p>
          {visible.length === 0 ? <p className="mt-3 text-xs text-zinc-500">Sin búsquedas guardadas para esta vista.</p> : (
            <ul aria-label="Lista de búsquedas guardadas" className="mt-3 space-y-2">
              {visible.map((item) => (
                <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-zinc-800 p-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs text-zinc-200">{item.name}</p>
                    <p className="mt-1 truncate text-[11px] text-zinc-500" title={describeSavedLens(item.lens)}>{describeSavedLens(item.lens)}</p>
                  </div>
                  <button type="button" className={button} aria-label={`Aplicar búsqueda ${item.name}`} onClick={() => { onApply(item.lens); setOpen(false) }}>Aplicar</button>
                  <button type="button" className={button} aria-label={`Eliminar búsqueda ${item.name}`} onClick={() => remove(item)}><Trash size={14} aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
