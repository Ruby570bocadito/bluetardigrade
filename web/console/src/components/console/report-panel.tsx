'use client'

import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SfAlert } from '@/lib/console-types'
import { buildReportExport, DECISION_LABELS, deleteReport, newReport, readReports, REPORT_KEY, REPORT_UPDATED_EVENT, saveReport, type Decision, type ReportFields, type SocReport } from '@/lib/soc-report'
import { useI18n } from './i18n-provider'

export function ReportPanel({ alert, initiallyOpen = false }: { alert: SfAlert; initiallyOpen?: boolean }) {
  const { dict } = useI18n()
  if (!alert.id || !/^[a-f0-9]{16}$/.test(alert.id)) return <p className="mt-4 text-xs text-zinc-500">{dict.socReport.requiresId}</p>
  return <ReportEditor key={alert.id} alert={alert} initiallyOpen={initiallyOpen} />
}

function ReportEditor({ alert, initiallyOpen }: { alert: SfAlert; initiallyOpen: boolean }) {
  const { dict, lang } = useI18n()
  const t = dict.socReport
  const prefix = useId()
  const [report, setReport] = useState<SocReport | null>(null)
  const [open, setOpen] = useState(initiallyOpen)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    try {
      const saved = readReports(window.localStorage).find((item) => item.alert_id === alert.id)
      setReport(saved ?? newReport(alert, new Date(), lang)); setDirty(!saved)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t.readFailed)
      try { setReport(newReport(alert, new Date(), lang)); setDirty(true) } catch { /* the visible error prevents a fake editor */ }
    }
    const onStorage = (event: StorageEvent) => { if (event.key === REPORT_KEY || event.key === null) setNotice(t.storageEventNotice) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // The editor owns its detection-time snapshot. SSE lifecycle updates with
    // the same alert id must not reset human edits or rewrite frozen evidence.
    // `t` rides along only for the storage-event wording: the listener is
    // re-armed if the operator flips the language mid-session.
  }, [alert.id, t, lang])
  const failure = (problem: unknown) => setError(problem instanceof Error ? problem.message : t.storageFailed)
  const change = (key: keyof ReportFields, value: string) => {
    if (!report) return
    setReport({ ...report, fields: { ...report.fields, [key]: value } }); setDirty(true); setNotice(''); setError('')
  }
  const savedChanged = () => window.dispatchEvent(new Event(REPORT_UPDATED_EVENT))
  const save = () => {
    if (!report) return
    try { const next = saveReport(window.localStorage, report, report.revision); setReport(next); setDirty(false); setError(''); setNotice(t.savedNotice); savedChanged() } catch (problem) { failure(problem) }
  }
  const load = () => {
    try { const next = readReports(window.localStorage).find((item) => item.alert_id === alert.id); if (!next) throw new Error('No hay una versión guardada para esta alerta.'); setReport(next); setDirty(false); setError(''); setNotice(t.loadedNotice) } catch (problem) { failure(problem) }
  }
  const remove = () => {
    if (!report) return
    try { deleteReport(window.localStorage, report.alert_id, report.revision); const now = new Date().toISOString(); setReport({ ...report, revision: 0, created_at: now, updated_at: now }); setDirty(true); setError(''); setNotice(t.deletedNotice); savedChanged() } catch (problem) { failure(problem) }
  }
  const download = (format: 'md' | 'json') => {
    if (!report) return
    try {
      const file = buildReportExport(report, format, lang); const url = URL.createObjectURL(new Blob([file.contents], { type: file.mime })); const link = document.createElement('a')
      link.href = url; link.download = file.filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setError(''); setNotice(t.exportedNotice)
    } catch (problem) { failure(problem) }
  }
  const textKey = { title: t.titleLabel, analyst: t.analystLabel } as const
  const areaLabels: Record<'findings' | 'actions' | 'recommendations' | 'references', string> = {
    findings: t.findingsLabel, actions: t.actionsLabel, recommendations: t.recommendationsLabel, references: t.referencesLabel,
  }
  return (
    <section aria-label={t.aria} className="mt-5 min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-200">{t.heading}</h3>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`${prefix}-editor`}>{open ? t.hide : t.edit}</Button>
      </div>
      {open && <div id={`${prefix}-editor`} className="mt-3 min-w-0 space-y-3">
        <p className="text-xs leading-relaxed text-zinc-500">{t.prose}</p>
        {report && <>
          {(['title', 'analyst'] as const).map((key) => <div key={key}><label htmlFor={`${prefix}-${key}`} className="mb-1 block text-xs text-zinc-400">{textKey[key]}</label><Input id={`${prefix}-${key}`} value={report.fields[key]} maxLength={key === 'title' ? 200 : 120} onChange={(event) => change(key, event.target.value)} /></div>)}
          <div><label htmlFor={`${prefix}-decision`} className="mb-1 block text-xs text-zinc-400">{t.decisionLabel}</label><select id={`${prefix}-decision`} value={report.fields.decision} onChange={(event) => change('decision', event.target.value as Decision)} className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{Object.entries(DECISION_LABELS[lang]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {(Object.entries(areaLabels) as [keyof typeof areaLabels, string][]).map(([key, label]) => <div key={key}><label htmlFor={`${prefix}-${key}`} className="mb-1 block text-xs text-zinc-400">{label}</label><textarea id={`${prefix}-${key}`} value={report.fields[key]} maxLength={4000} rows={3} onChange={(event) => change(key, event.target.value)} className="w-full min-w-0 resize-y rounded-md border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>)}
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={save}>{t.save}</Button><Button variant="outline" size="sm" onClick={() => download('md')}>{t.exportMd}</Button><Button variant="outline" size="sm" onClick={() => download('json')}>{t.exportJson}</Button><Button variant="outline" size="sm" onClick={load}>{t.loadSaved}</Button><Button variant="outline" size="sm" onClick={remove} disabled={report.revision === 0}>{t.deleteLocal}</Button></div>
          <p className="font-mono text-[11px] text-zinc-500">{dirty ? t.dirty : t.saved(report.revision)}</p>
        </>}
      </div>}
      {notice && <p role="status" className="mt-2 text-xs text-zinc-400">{notice}</p>}
      {error && <p role="alert" className="mt-2 break-words text-xs text-red-300">{error}</p>}
    </section>
  )
}
