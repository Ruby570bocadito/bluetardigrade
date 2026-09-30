'use client'

// Export controls for the engine's bulk endpoints
// (/api/alerts/export, /api/events/export?format=jsonl|csv): plain
// same-origin links through the engine proxy — the browser downloads
// exactly what the engine serves, with its own filenames. Also hosts
// the client-side export of the audit tail (AuditExportButton): the
// audit read surface is a capped tail by design, no bulk route.

import { DownloadSimple } from '@phosphor-icons/react'
import type { SfRespondAudit } from '@/lib/console-types'

const linkCls =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ExportButtons({ kind }: { kind: 'alerts' | 'events' }) {
  const noun = kind === 'alerts' ? 'alertas' : 'eventos'
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

// Client-side export of the audit tail the console already fetched:
// one JSON Lines line per record, verbatim (same Record schema the
// engine writes append-only). The engine has no bulk export route for
// the audit by design (the read surface is the capped tail), so the
// console packages only the fetched window and says so — the full
// file lives on the engine host and is never rewritten by anyone.
// The export is the WHOLE window BY DESIGN, independent of the view
// filter: the class filter is a lens over the queue, not a data
// selector, and a filtered file would masquerade as the audit tail.
// When the parent passes an active filterLabel the tooltip states
// this explicitly (O4, cross-ref 04-B 19h45 §2.C — info, no defect).
export function AuditExportButton({
  audit,
  filterLabel,
  hiddenCount,
}: {
  audit: SfRespondAudit | null
  /** Human label of the active class filter, when one is active. */
  filterLabel?: string
  /** Records the active filter hides from the view but the export keeps. */
  hiddenCount?: number
}) {
  const records = audit?.records ?? []
  const disabled = records.length === 0

  function download(): void {
    if (records.length === 0) return
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const blob = new Blob([`${records.map((r) => JSON.stringify(r)).join('\n')}\n`], {
      type: 'application/x-ndjson',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `respond-audit-cola-${stamp}.jsonl`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={disabled}
      aria-label="Exportar la cola del audit"
      title={
        disabled
          ? 'Sin intentos en la cola: nada que exportar todavía'
          : filterLabel
            ? `Exporta la ventana completa, independiente del filtro «${filterLabel}»: los ${records.length} registros de la cola, incluidos los ${hiddenCount ?? 0} que el filtro oculta en la vista, más recientes primero, línea a línea como la escribe el motor; el archivo completo vive en el host del motor (append-only, nunca se trunca)`
            : `Descarga la cola de la ventana (${records.length} registros, más recientes primero) línea a línea como la escribe el motor; el archivo completo vive en el host del motor (append-only, nunca se trunca)`
      }
      className={`${linkCls} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <DownloadSimple size={12} aria-hidden />
      jsonl
    </button>
  )
}
