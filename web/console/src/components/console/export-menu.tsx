'use client'

// Export controls for the engine's bulk endpoints
// (/api/alerts/export, /api/events/export?format=jsonl|csv). Plain
// same-origin links through the engine proxy: the browser downloads
// exactly what the engine serves, with its own filenames.

import { DownloadSimple } from '@phosphor-icons/react'

export function ExportButtons({ kind }: { kind: 'alerts' | 'events' }) {
  const noun = kind === 'alerts' ? 'alertas' : 'eventos'
  const linkCls =
    'inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <div role="group" aria-label={`Exportar ${noun}`} className="flex items-center gap-1.5">
      <span className="hidden items-center gap-1 text-[11px] uppercase tracking-wider text-zinc-500 sm:flex">
        <DownloadSimple size={12} aria-hidden />
        Export
      </span>
      <a href={`/api/engine/api/${kind}/export?format=jsonl`} download className={linkCls} title={`Descargar ${noun} en JSON Lines`}>
        jsonl
      </a>
      <a href={`/api/engine/api/${kind}/export?format=csv`} download className={linkCls} title={`Descargar ${noun} en CSV`}>
        csv
      </a>
    </div>
  )
}
