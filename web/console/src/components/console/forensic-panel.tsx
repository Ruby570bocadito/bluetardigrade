'use client'

// Forensic evidence panel (alert detail): reads the bundle the engine
// froze at detection time (GET /api/alerts/{id}/forensics) and renders
// the host timeline that preceded the alert — the "what was happening
// here" answer that does not depend on the ring, on -store or on the
// alert still being live.
//
// Lazy by design: nothing is fetched until the operator expands it, so
// the queue detail stays instant for every other triage action.

import { useId, useMemo, useState } from 'react'
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
import { buildProcessTree } from '@/lib/entity-graph'
import { ProcessTree } from '@/components/charts/process-tree'
import { useI18n } from './i18n-provider'

type Props = { alertId?: string }

export function ForensicPanel({ alertId }: Props) {
  // Reset the query on identity changes, including a delayed response
  // for the previous alert. Never show one alert's evidence under another.
  return <ForensicQuery key={alertId || 'legacy'} alertId={alertId} />
}

function ForensicQuery({ alertId }: Props) {
  const words = useI18n().dict.forensic
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
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">{words.heading}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          {words.noEngineId}
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
        aria-label={words.title}
        aria-controls={`${id}-content`}
        id={`${id}-toggle`}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          <Fingerprint size={12} aria-hidden />
          {words.title}
        </span>
        <span className="flex items-center gap-2 text-[10px] text-zinc-500">
          {busy && <CircleNotch size={12} className="animate-spin" aria-hidden />}
          {words.engineWindow}
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
              {words.loading}
            </div>
          )}

          {result?.kind === 'error' && (
            <div className="space-y-2">
              <Note tone="amber">
                {words.loadError}
              </Note>
              <button type="button" onClick={load} disabled={busy}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                {words.retry}
              </button>
            </div>
          )}
          {result?.kind === 'disabled' && (
            <Note tone="zinc">
              {words.disabledA}<code className="font-mono">-forensic=false</code>{words.disabledB}
            </Note>
          )}
          {result?.kind === 'missing' && (
            <Note tone="zinc">
              {words.missing}
            </Note>
          )}

          {result?.kind === 'bundle' && <BundleView result={result} />}
        </motion.div>
      )}
    </div>
  )
}

function BundleView({ result }: { result: Extract<ForensicResult, { kind: 'bundle' }> }) {
  const { dict, lang } = useI18n()
  const words = dict.forensic
  const { bundle } = result
  const s = bundle.summary
  const chips: Array<[string, number]> = [
    [words.chips.processes, s.process_creates],
    [words.chips.network, s.network_connects],
    [words.chips.files, s.file_writes],
    [words.chips.registry, s.registry_sets],
    [words.chips.accesses, s.process_accesses],
    [words.chips.other, s.other],
  ]
  const active = chips.filter(([, n]) => n > 0)
  const images = bundle.summary.distinct_images.slice(0, 12)
  const [exportError, setExportError] = useState(false)
  // The engine freezes the whole alert in the bundle; its event_id names
  // the process that fired, highlighted in the tree.
  const trigger = (bundle.alert as { event_id?: string }).event_id
  const focusName = bundle.timeline.find((ev) => ev.id === trigger)?.process?.name
  const tree = useMemo(() => buildProcessTree(bundle.timeline, focusName), [bundle, focusName])

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
          {words.captured(formatTime(bundle.captured_at), bundle.timeline.length)}
        </span>
        <div role="group" aria-label={words.exportAria} className="flex items-center gap-1.5">
          {(['json', 'jsonl'] as const).map((format) => (
            <button key={format} type="button" onClick={() => download(format)}
              aria-label={words.downloadAria(format.toUpperCase())}
              title={words.downloadTitle}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <DownloadSimple size={11} aria-hidden />{format}
            </button>
          ))}
        </div>
      </div>
      {exportError && <p role="alert" className="mb-2 text-[11px] text-amber-300">{words.downloadError}</p>}
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
        {s.distinct_users > 1 && <span className="font-mono tabular-nums">{words.users(s.distinct_users)}</span>}
      </div>

      {images.length > 0 && (
        <p className="mb-2.5 truncate font-mono text-[10px] text-zinc-500" title={images.join('  ')}>
          {images.join('  ')}
        </p>
      )}

      {tree.length > 0 && (
        <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="mb-1.5 px-1 text-[11px] font-medium text-zinc-300">{words.tree}</p>
          <ProcessTree roots={tree} />
        </div>
      )}

      {bundle.timeline.length === 0 ? (
        <p className="py-1 text-[11px] text-zinc-500">
          {words.noEvents}
        </p>
      ) : (
        <ol className="max-h-72 overflow-y-auto" aria-label={words.timelineAria}>
          {bundle.timeline.map((ev, index) => (
            <li
              key={`${ev.id}:${index}`}
              className="grid grid-cols-[52px_1fr] gap-2 border-b border-zinc-800/60 py-1.5 last:border-b-0"
            >
              <span className="font-mono text-[10px] tabular-nums text-zinc-500" title={ev.timestamp}>
                {formatTime(ev.timestamp)}
              </span>
              <span className="min-w-0">
                <span className="font-mono text-[10px] text-zinc-500">{ev.type}</span>
                <span className="block truncate font-mono text-[11px] text-zinc-300" title={forensicEventLine(ev, lang)}>
                  {forensicEventLine(ev, lang)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {bundle.timeline.length >= 200 && (
        <p className="mt-2 text-[10px] text-zinc-500">
          {words.cap}
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
