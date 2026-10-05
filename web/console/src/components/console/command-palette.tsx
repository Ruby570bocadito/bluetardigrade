'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ArrowClockwise, ArrowElbowDownLeft, Keyboard, MagnifyingGlass, Monitor, RocketLaunch, X } from '@phosphor-icons/react'
import { ConsoleDialog } from './console-dialog'
import { findConsoleCommands, type ConsoleCommand } from '@/lib/console-commands'

export function CommandPalette({ open, refreshing, onClose, onExecute }: {
  open: boolean
  refreshing: boolean
  onClose: () => void
  onExecute: (command: ConsoleCommand) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const results = findConsoleCommands(query)
  const selected = results[Math.min(active, results.length - 1)]
  const disabled = (command: ConsoleCommand) => command.kind === 'refresh' && refreshing

  useEffect(() => {
    if (open && selected) document.getElementById(`${id}-${selected.id}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, id, selected])

  const execute = (command: ConsoleCommand) => {
    if (disabled(command)) return
    onExecute(command)
  }

  return (
    <ConsoleDialog open={open} onClose={onClose} titleId={`${id}-title`} descriptionId={`${id}-hint`} initialFocus={inputRef}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <h2 id={`${id}-title`} className="text-sm font-medium">Comandos de la consola</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar comandos" className="rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <MagnifyingGlass size={20} aria-hidden className="shrink-0 text-primary" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Buscar comandos"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-results`}
          aria-activedescendant={selected ? `${id}-${selected.id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0) }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (results.length) setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (selected) execute(selected)
            }
          }}
          placeholder="Buscar una vista o acción…"
          className="h-9 min-w-0 flex-1 bg-transparent text-base text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </div>
      <div role="status" className="sr-only" aria-live="polite">{results.length} comandos disponibles</div>
      <ul id={`${id}-results`} role="listbox" aria-label="Comandos disponibles" className="max-h-[min(50dvh,400px)] overflow-y-auto p-2">
        {results.map((command, index) => (
          <li
            id={`${id}-${command.id}`}
            key={command.id}
            role="option"
            aria-selected={selected?.id === command.id}
            aria-disabled={disabled(command) || undefined}
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => execute(command)}
            className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ${disabled(command) ? 'cursor-wait opacity-50' : selected?.id === command.id ? 'bg-primary-tint/15 ring-1 ring-inset ring-primary/30' : 'hover:bg-white/[0.04]'}`}
          >
            {command.kind === 'refresh' ? <ArrowClockwise size={18} aria-hidden className={refreshing ? 'animate-spin motion-reduce:animate-none' : 'text-zinc-400'} /> : command.kind === 'help' ? <Keyboard size={18} aria-hidden className="text-zinc-400" /> : command.kind === 'noc' ? <Monitor size={18} aria-hidden className="text-zinc-400" /> : command.kind === 'onboarding' ? <RocketLaunch size={18} aria-hidden className="text-zinc-400" /> : <ArrowElbowDownLeft size={18} aria-hidden className="text-zinc-400" />}
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-zinc-100">{command.label}</span>
              <span className="block text-xs text-zinc-400">{disabled(command) ? 'Actualización en curso' : command.description}</span>
            </span>
            {command.shortcut && <kbd aria-hidden className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">{command.shortcut}</kbd>}
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="px-5 pb-5 text-sm text-zinc-400">Sin comandos para esta búsqueda. Prueba con «alertas», «reglas» o «actualizar».</p>}
      <p id={`${id}-hint`} className="border-t border-white/[0.06] px-4 py-3 text-xs text-zinc-400">↑ ↓ elegir · Enter ejecutar · Esc cerrar</p>
    </ConsoleDialog>
  )
}
