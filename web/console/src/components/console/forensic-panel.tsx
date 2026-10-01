'use client'

// Forensic evidence panel (alert detail): reads the bundle the engine
// froze at detection time (GET /api/alerts/{id}/forensics) and renders
// the host timeline that preceded the alert — the "what was happening
// here" answer that does not depend on the ring, on -store or on the
// alert still being live.
//
// Lazy by design: nothing is fetched until the operator expands it, so
// the queue detail stays instant for every other triage action.

import { useId, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  CaretDown,
  CircleNotch,
  ClockCountdown,
  DownloadSimple,
  Fingerprint,
  WarningCircle,
} from '@phosphor-icons/react'
import { readForensicBundle, forensicEventLine, buildForensicExport, type ForensicResult } from '@/lib/forensic'
import { formatTime } from '@/lib/console-types'

type Props = { alertId?: string }

export function ForensicPanel({ alertId }: Props) {
  // Reset the query on identity changes, including a delayed response
  // for the previous alert. Never show one alert's evidence under another.
  return <ForensicQuery key={alertId || 'legacy'} alertId={alertId} />
}

function ForensicQuery({ alertId }: Props) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<ForensicResult | null>(null)
  const [busy, setBusy] = useState(false)
  const reduce = useReducedMotion()
  const id = useId()

  async function load() {
    if (!alertId || busy) return
    setBusy(true)
    setResult(await readForensicBundle(alertId))
    setBusy(false)
  }

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && (result === null || result.kind === 'error')) await load()
  }

  if (!alertId) {
    // pre-r6 alert without an engine id: nothing addressable, and the
    // panel says so instead of hiding the feature silently
    return (
      <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Forense</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          Esta alerta no lleva id del motor: la captura de evidencia requiere el motor actualizado.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-5 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/60">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Línea de tiempo forense"
        aria-controls={`${id}-content`}
        id={`${id}-toggle`}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          <Fingerprint size={12} aria-hidden />
          Línea de tiempo forense
        </span>
        <span className="flex items-center gap-2 text-[10px] text-zinc-500">
          {busy && <CircleNotch size={12} className="animate-spin" aria-hidden />}
          ventana del motor
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.15 }}
            className="inline-flex"
          >
            <CaretDown size={12} aria-hidden />
          </motion.span>
        </span>
      </button>

      {open && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="border-t border-zinc-800 px-3 py-3"
          id={`${id}-content`}
          role="region"
          aria-labelledby={`${id}-toggle`}
          aria-busy={busy}
        >
          {busy && (
            <div role="status" className="flex items-center gap-2 py-2 text-xs text-zinc-500">
              <CircleNotch size={13} className="animate-spin" aria-hidden />
              consultando evidencia guardada...
            </div>
          )}

          {result?.kind === 'error' && (
            <div className="space-y-2">
              <Note tone="amber">
                No se pudo cargar evidencia válida del motor. Reintenta la consulta.
              </Note>
              <button type="button" onClick={load} disabled={busy}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                Reintentar evidencia
              </button>
            </div>
          )}
          {result?.kind === 'disabled' && (
            <Note tone="zinc">
              Captura forense desactivada en este motor: arranca sin <code className="font-mono">-forensic=false</code>.
            </Note>
          )}
          {result?.kind === 'missing' && (
            <Note tone="zinc">
              Sin bundle para esta alerta: solo las severidades high/critical congelan evidencia, y la
              retención del directorio desaloja los bundles más antiguos.
            </Note>
          )}

          {result?.kind === 'bundle' && <BundleView result={result} />}
        </motion.div>
      )}
    </div>
  )
}

function BundleView({ result }: { result: Extract<ForensicResult, { kind: 'bundle' }> }) {
  const { bundle } = result
  const s = bundle.summary
  const chips: Array<[string, number]> = [
    ['procesos', s.process_creates],
    ['red', s.network_connects],
    ['ficheros', s.file_writes],
    ['registro', s.registry_sets],
    ['accesos', s.process_accesses],
    ['otros', s.other],
  ]
  const active = chips.filter(([, n]) => n > 0)
  const images = bundle.summary.distinct_images.slice(0, 12)
  const [exportError, setExportError] = useState(false)

  function download(format: 'json' | 'jsonl') {
    let url: string | undefined
    let link: HTMLAnchorElement | undefined
    try {
      const file = buildForensicExport(bundle, format)
      url = URL.createObjectURL(new Blob([file.contents], { type: file.mime }))
      link = document.createElement('a')
      link.href = url
      link.download = file.filename
      document.body.appendChild(link)
      link.click()
      setExportError(false)
    } catch {
      setExportError(true)
    } finally {
      link?.remove()
      if (url) URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-zinc-500" title={bundle.captured_at}>
          Capturada {formatTime(bundle.captured_at)} · {bundle.timeline.length} eventos
        </span>
        <div role="group" aria-label="Exportar evidencia forense" className="flex items-center gap-1.5">
          {(['json', 'jsonl'] as const).map((format) => (
            <button key={format} type="button" onClick={() => download(format)}
              aria-label={`Descargar evidencia ${format.toUpperCase()}`}
              title="Descarga la captura guardada: alerta completa, metadatos y eventos. La captura tiene la ventana y los límites del motor."
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <DownloadSimple size={11} aria-hidden />{format}
            </button>
          ))}
        </div>
      </div>
      {exportError && <p role="alert" className="mb-2 text-[11px] text-amber-300">No se pudo iniciar la descarga. Reintenta con el botón de exportación.</p>}
      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <ClockCountdown size={11} aria-hidden />
          {bundle.window}
        </span>
        {active.map(([label, n]) => (
          <span key={label} className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono tabular-nums">
            {n} {label}
          </span>
        ))}
        {s.distinct_users > 1 && <span className="font-mono tabular-nums">{s.distinct_users} usuarios</span>}
      </div>

      {images.length > 0 && (
        <p className="mb-2.5 truncate font-mono text-[10px] text-zinc-600" title={images.join('  ')}>
          {images.join('  ')}
        </p>
      )}

      {bundle.timeline.length === 0 ? (
        <p className="py-1 text-[11px] text-zinc-500">
          El motor no observó eventos de este equipo dentro de la ventana (sensor caído o flujo recién iniciado).
        </p>
      ) : (
        <ol className="max-h-72 overflow-y-auto" aria-label="Línea de tiempo de evidencia">
          {bundle.timeline.map((ev, index) => (
            <li
              key={`${ev.id}:${index}`}
              className="grid grid-cols-[52px_1fr] gap-2 border-b border-zinc-800/60 py-1.5 last:border-b-0"
            >
              <span className="font-mono text-[10px] tabular-nums text-zinc-600" title={ev.timestamp}>
                {formatTime(ev.timestamp)}
              </span>
              <span className="min-w-0">
                <span className="font-mono text-[10px] text-zinc-500">{ev.type}</span>
                <span className="block truncate font-mono text-[11px] text-zinc-300" title={forensicEventLine(ev)}>
                  {forensicEventLine(ev)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {bundle.timeline.length >= 200 && (
        <p className="mt-2 text-[10px] text-zinc-600">
          Límite de 200 eventos: el motor conserva la cola y el evento que disparó la alerta si aún lo tenía registrado.
        </p>
      )}
    </div>
  )
}

function Note({ tone, children }: { tone: 'zinc' | 'amber'; children: React.ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
      : 'border-zinc-800 bg-zinc-900/50 text-zinc-400'
  return (
    <p role="status" className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-relaxed ${cls}`}>
      <WarningCircle size={12} aria-hidden className="mt-0.5 shrink-0" />
      {children}
    </p>
  )
}
