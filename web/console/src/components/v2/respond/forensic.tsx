'use client'

// Respuesta · forensic snapshot: what the engine froze on that host when
// it raised the alert (the minutes before, independent of the event ring
// or the store). Read on demand; copied or exported as the engine's JSON.
import { useState } from 'react'
import { Copy, DownloadSimple } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlert } from '@/lib/console-types'
import { formatDuration } from '@/lib/fleet'
import { buildForensicExport, forensicEventLine, type ForensicResult } from '@/lib/forensic'
import { goDurationSeconds } from '@/lib/v2/respond-model'
import { download } from './parts'

export type ForensicSlot = 'idle' | 'loading' | ForensicResult

export function ForensicPanel({ alert, slot, onLoad }: { alert: SfAlert; slot: ForensicSlot; onLoad: () => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.respondView
  const [copied, setCopied] = useState(false)

  let body
  if (slot === 'idle')
    body = (
      <button type="button" className="v2-btn" onClick={onLoad}>
        {t.forLoad}
      </button>
    )
  else if (slot === 'loading') body = <p className="v2-small v2-dim">{t.forLoading}</p>
  else if (slot.kind === 'disabled') body = <p className="v2-small v2-dim">{t.forDisabled}</p>
  else if (slot.kind === 'missing') body = <p className="v2-small v2-dim">{t.forMissing}</p>
  else if (slot.kind === 'error')
    body = (
      <>
        <p className="v2-small v2-warn">{t.forError}</p>
        <button type="button" className="v2-btn" onClick={onLoad}>
          {t.forLoad}
        </button>
      </>
    )
  else {
    const { bundle } = slot
    const at = Date.parse(alert.timestamp)
    const timeline = [...bundle.timeline].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const counts = Object.entries(t.forCounts)
      .map(([key, label]) => ({ key, label, n: (bundle.summary as Record<string, unknown>)[key] as number }))
      .filter((c) => c.n > 0)
    const file = buildForensicExport(bundle, 'json')
    // the engine writes the window as a Go duration plus an English note
    const seconds = goDurationSeconds(bundle.window)
    const windowText = seconds === null ? bundle.window.split(' ')[0] : formatDuration(seconds)
    body = (
      <>
        <div className="v2-for-head">
          <p className="v2-small">{t.forSummary(bundle.summary.events, windowText)}</p>
          <div className="v2-for-actions">
            <button
              type="button"
              className="v2-btn"
              onClick={() =>
                void navigator.clipboard?.writeText(file.contents).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 2000)
                })
              }
            >
              <Copy aria-hidden="true" />
              {copied ? t.forCopied : t.forCopy}
            </button>
            <button type="button" className="v2-btn" onClick={() => download(file.filename, file.mime, file.contents)}>
              <DownloadSimple aria-hidden="true" />
              {t.forExport}
            </button>
          </div>
        </div>
        {counts.length > 0 && (
          <div className="v2-tags">
            {counts.map((c) => (
              <span key={c.key} className="v2-tag">
                {c.label} <span className="v2-mono">{c.n}</span>
              </span>
            ))}
          </div>
        )}
        <ol className="v2-for-timeline">
          {timeline.map((ev) => {
            const trigger = ev.id === alert.event_id
            const before = Number.isFinite(at) ? Math.max(0, (at - Date.parse(ev.timestamp)) / 1000) : NaN
            return (
              <li key={ev.id} data-trigger={trigger}>
                <span className="v2-mono v2-for-offset">{trigger ? '0 s' : Number.isFinite(before) ? t.forBefore(formatDuration(before)) : '—'}</span>
                <span className="v2-for-line">
                  {forensicEventLine(ev, lang)}
                  {trigger && <span className="v2-tag">{t.forTrigger}</span>}
                </span>
              </li>
            )
          })}
        </ol>
        {bundle.summary.distinct_images.length > 0 && (
          <p className="v2-small v2-dim v2-for-images">
            {bundle.summary.distinct_images.map((img) => (
              <code key={img}>{img}</code>
            ))}
          </p>
        )}
      </>
    )
  }

  return (
    <section className="v2-for" aria-labelledby="v2-for-title">
      <h3 id="v2-for-title">{t.forTitle}</h3>
      <p className="v2-small v2-dim">{t.forHint}</p>
      {body}
    </section>
  )
}
