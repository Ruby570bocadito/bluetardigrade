'use client'

// Informes · Informe de analista: the analyst's own account of one alert —
// decision, findings, actions, recommendations, references — written
// beside a preview of the finished document, saved in this browser with
// a revision (another tab's newer save is never overwritten) and exported
// as Markdown or JSON. It changes nothing in the engine.
import { useEffect, useMemo, useState } from 'react'
import { DownloadSimple, FloppyDisk, Printer } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime, type SfAlert } from '@/lib/console-types'
import {
  buildReportExport,
  DECISION_LABELS,
  newReport,
  readReports,
  REPORT_UPDATED_EVENT,
  saveReport,
  type Decision,
  type ReportFields,
  type SocReport,
} from '@/lib/soc-report'
import { Empty, SEV_COLOR } from '../home/parts'
import { download } from '../respond/parts'
import { PrintView } from './print-view'

const ID = /^[0-9a-f]{16}$/
const LONG: (keyof ReportFields)[] = ['findings', 'actions', 'recommendations', 'references']

function stored(id: string): SocReport | undefined {
  try {
    return readReports(window.localStorage).find((r) => r.alert_id === id)
  } catch {
    return undefined
  }
}

export function WriteUpDocument({ report }: { report: SocReport }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const f = report.fields
  return (
    <article className="v2-wu-doc">
      <h3>{f.title || t.anEmpty}</h3>
      <p className="v2-small v2-dim">
        <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[report.alert.severity] }}>
          {dict.v2.sev[report.alert.severity]}
        </span>{' '}
        {report.alert.rule_name} · <span className="v2-mono">{report.alert.host}</span> · {formatDateTime(report.alert.timestamp, lang)}
      </p>
      <dl className="v2-wu-meta">
        <div>
          <dt>{t.anFields.analyst}</dt>
          <dd>{f.analyst || <span className="v2-dim">{t.anEmpty}</span>}</dd>
        </div>
        <div>
          <dt>{t.anFields.decision}</dt>
          <dd>
            <span className="v2-wu-decision" data-decision={f.decision}>
              {DECISION_LABELS[lang][f.decision]}
            </span>
          </dd>
        </div>
      </dl>
      {LONG.map((k) => (
        <section key={k}>
          <h4>{t.anFields[k]}</h4>
          <p className={f[k] ? undefined : 'v2-dim'}>{f[k] || t.anEmpty}</p>
        </section>
      ))}
    </article>
  )
}

export function WriteUp({
  alerts,
  alertId,
  onAlert,
  print,
  onPrint,
}: {
  alerts: SfAlert[]
  alertId: string | null
  onAlert: (id: string) => void
  print: boolean
  onPrint: (on: boolean) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const choices = useMemo(() => alerts.filter((a) => a.id && ID.test(a.id)).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 60), [alerts])
  const id = alertId ?? choices[0]?.id ?? null
  const alert = alerts.find((a) => a.id === id)
  const [draft, setDraft] = useState<SocReport | null>(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')

  // a new alert opens its saved write-up, or a fresh one; an alert that
  // arrives after the page (the engine stream loads after the URL is
  // read) fills the write-up then, and the one being written is kept
  const hasAlert = !!alert
  useEffect(() => {
    if (!id) {
      setDraft(null)
      return
    }
    if (draft && draft.alert_id === id) return
    const saved = stored(id)
    if (saved) {
      setDraft(saved)
      setRevision(saved.revision)
    } else if (alert) {
      try {
        setDraft(newReport(alert, new Date(), lang))
        setRevision(0)
      } catch {
        setDraft(null)
      }
    } else setDraft(null)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasAlert])

  if (choices.length === 0 && !draft) return <Empty title={t.anNone}>{t.anPickHint}</Empty>
  if (!draft) return <Empty title={t.anNone}>{t.anPickHint}</Empty>

  if (print)
    return (
      <PrintView title={draft.fields.title || t.consoleKinds.analista.title} subtitle={t.consoleKinds.analista.title} onBack={() => onPrint(false)}>
        <WriteUpDocument report={draft} />
      </PrintView>
    )

  const set = (k: keyof ReportFields, v: string) => setDraft((d) => (d ? { ...d, fields: { ...d.fields, [k]: v } } : d))
  const savedCopy = revision > 0 ? stored(draft.alert_id) : undefined
  const dirty = !savedCopy || JSON.stringify(savedCopy.fields) !== JSON.stringify(draft.fields)

  function save() {
    if (!draft) return
    try {
      const saved = saveReport(window.localStorage, draft, revision)
      setDraft(saved)
      setRevision(saved.revision)
      setError('')
      window.dispatchEvent(new Event(REPORT_UPDATED_EVENT))
    } catch (cause) {
      setError(t.anError(cause instanceof Error ? cause.message : String(cause)))
    }
  }
  function exportAs(format: 'md' | 'json') {
    if (!draft) return
    try {
      const file = buildReportExport(draft, format, lang)
      download(file.filename, file.mime, file.contents)
    } catch (cause) {
      setError(t.anError(cause instanceof Error ? cause.message : String(cause)))
    }
  }

  return (
    <div className="v2-wu">
      <div className="v2-rep-head">
        <label className="v2-select v2-wu-pick">
          <span className="v2-sr-only">{t.anPick}</span>
          <select value={id ?? ''} onChange={(e) => onAlert(e.target.value)}>
            {!alert && <option value={draft.alert_id}>{`${draft.alert.rule_name} · ${draft.alert.host}`}</option>}
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {`${a.rule_name} · ${a.host} · ${formatDateTime(a.timestamp, lang)}`}
              </option>
            ))}
          </select>
        </label>
        <div className="v2-rep-actions">
          <button type="button" className="v2-btn" onClick={() => exportAs('md')}>
            <DownloadSimple aria-hidden="true" />
            {t.anExportMd}
          </button>
          <button type="button" className="v2-btn" onClick={() => exportAs('json')}>
            <DownloadSimple aria-hidden="true" />
            {t.anExportJson}
          </button>
          <button type="button" className="v2-btn" onClick={() => onPrint(true)}>
            <Printer aria-hidden="true" />
            {t.printView}
          </button>
        </div>
      </div>
      {!alert && <p className="v2-small v2-warn">{t.anFromLibrary}</p>}

      <div className="v2-wu-grid">
        <form
          className="v2-wu-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="v2-field">
            <span>{t.anFields.title}</span>
            <input className="v2-input" value={draft.fields.title} onChange={(e) => set('title', e.target.value)} maxLength={200} />
          </label>
          <div className="v2-wu-row">
            <label className="v2-field">
              <span>{t.anFields.analyst}</span>
              <input className="v2-input" value={draft.fields.analyst} onChange={(e) => set('analyst', e.target.value)} maxLength={120} />
            </label>
            <label className="v2-field">
              <span>{t.anFields.decision}</span>
              <select className="v2-input" value={draft.fields.decision} onChange={(e) => set('decision', e.target.value as Decision)}>
                {(Object.keys(DECISION_LABELS[lang]) as Decision[]).map((d) => (
                  <option key={d} value={d}>
                    {DECISION_LABELS[lang][d]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {LONG.map((k) => (
            <label key={k} className="v2-field">
              <span>{t.anFields[k]}</span>
              <textarea className="v2-input v2-textarea" value={draft.fields[k]} onChange={(e) => set(k, e.target.value)} rows={k === 'references' ? 2 : 4} maxLength={4000} />
            </label>
          ))}
          <div className="v2-wu-save">
            <button type="submit" className="v2-btn v2-btn-primary" disabled={!dirty}>
              <FloppyDisk aria-hidden="true" />
              {t.anSave}
            </button>
            <span className="v2-small v2-dim" role="status">
              {revision === 0 ? t.anNew : dirty ? t.anUnsaved : t.anSaved(revision)}
            </span>
          </div>
          {error && (
            <p className="v2-error" role="alert">
              {error}
            </p>
          )}
          <p className="v2-small v2-dim">{t.anBrowserNote}</p>
        </form>
        <section className="v2-wu-preview" aria-label={t.anPreview}>
          <span className="v2-eyebrow">{t.anPreview}</span>
          <WriteUpDocument report={draft} />
        </section>
      </div>
    </div>
  )
}
