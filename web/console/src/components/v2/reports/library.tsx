'use client'

// Informes · Biblioteca: the analyst write-ups kept in this browser,
// readable after their alerts leave the engine; searched, filtered by
// decision, opened, exported or deleted (with a second click, and only
// the version this page read — another tab's newer save is kept).
import { useEffect, useState } from 'react'
import { DownloadSimple, MagnifyingGlass, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime } from '@/lib/console-types'
import { buildReportExport, DECISION_LABELS, deleteReport, MAX_REPORTS, readReports, REPORT_KEY, REPORT_UPDATED_EVENT, type Decision, type SocReport } from '@/lib/soc-report'
import { filterLibrary } from '@/lib/v2/reports-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { download } from '../respond/parts'

export function Library({ onOpen, onNotice }: { onOpen: (alertId: string) => void; onNotice: (message: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const [items, setItems] = useState<SocReport[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [decision, setDecision] = useState<Decision | 'all'>('all')
  const [arming, setArming] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => {
      try {
        setItems(readReports(window.localStorage))
        setError('')
      } catch {
        setError(t.libReadFailed)
      }
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === REPORT_KEY || e.key === null) refresh()
    }
    refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener(REPORT_UPDATED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(REPORT_UPDATED_EVENT, refresh)
    }
  }, [t])

  useEffect(() => {
    if (!arming) return undefined
    const id = window.setTimeout(() => setArming(null), 4000)
    return () => window.clearTimeout(id)
  }, [arming])

  const shown = filterLibrary(items, q, decision)

  function remove(r: SocReport) {
    if (arming !== r.alert_id) return setArming(r.alert_id)
    setArming(null)
    try {
      deleteReport(window.localStorage, r.alert_id, r.revision)
      window.dispatchEvent(new Event(REPORT_UPDATED_EVENT))
      onNotice(t.libDeleted)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="v2-lib">
      <div className="v2-rep-head">
        <div>
          <h2>{t.libTitle}</h2>
          <p className="v2-small v2-dim">{t.libHint}</p>
        </div>
        <span className="v2-mono v2-small">{t.libCount(items.length, MAX_REPORTS)}</span>
      </div>
      <div className="v2-det-filters">
        <label className="v2-search">
          <MagnifyingGlass aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.libSearch} aria-label={t.libSearch} />
        </label>
        <div className="v2-chips" role="group" aria-label={t.anFields.decision}>
          {(['all', ...Object.keys(DECISION_LABELS[lang])] as (Decision | 'all')[]).map((d) => (
            <button key={d} type="button" className="v2-chip-btn" aria-pressed={decision === d} onClick={() => setDecision(d)}>
              {d === 'all' ? t.libAll : DECISION_LABELS[lang][d]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="v2-small v2-warn">{error}</p>}
      {items.length === 0 ? (
        <Empty title={t.libEmpty}>{t.anBrowserNote}</Empty>
      ) : shown.length === 0 ? (
        <Empty title={t.libNone} />
      ) : (
        <ul className="v2-lib-list">
          {shown.map((r) => (
            <li key={r.alert_id} className="v2-lib-row">
              <span className="v2-lib-main">
                <strong>{r.fields.title || r.alert.rule_name}</strong>
                <span className="v2-small v2-dim">
                  <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[r.alert.severity] }}>
                    {dict.v2.sev[r.alert.severity]}
                  </span>{' '}
                  {r.alert.rule_name} · <span className="v2-mono">{r.alert.host}</span>
                </span>
              </span>
              <span className="v2-wu-decision" data-decision={r.fields.decision}>
                {DECISION_LABELS[lang][r.fields.decision]}
              </span>
              <span className="v2-small">{r.fields.analyst || <span className="v2-dim">—</span>}</span>
              <span className="v2-small v2-dim">
                r{r.revision} · {formatDateTime(r.updated_at, lang)}
              </span>
              <span className="v2-lib-actions">
                <button type="button" className="v2-btn" onClick={() => onOpen(r.alert_id)}>
                  {t.libOpen}
                </button>
                {(['md', 'json'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="v2-icon-btn"
                    aria-label={`${f === 'md' ? t.anExportMd : t.anExportJson} · ${r.fields.title}`}
                    title={f === 'md' ? t.anExportMd : t.anExportJson}
                    onClick={() => {
                      const file = buildReportExport(r, f, lang)
                      download(file.filename, file.mime, file.contents)
                    }}
                  >
                    <DownloadSimple aria-hidden="true" />
                    <span className="v2-lib-fmt">{f === 'md' ? 'MD' : 'JSON'}</span>
                  </button>
                ))}
                <button type="button" className="v2-link v2-small v2-lib-del" data-armed={arming === r.alert_id} onClick={() => remove(r)}>
                  <Trash aria-hidden="true" />
                  {arming === r.alert_id ? t.libDeleteConfirm : t.libDelete}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
