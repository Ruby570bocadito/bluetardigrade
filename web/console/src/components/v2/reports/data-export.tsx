'use client'

// Informes · Exportar datos: the raw data as the engine serves it — the
// alerts and the events as JSON Lines or CSV with the filters its export
// reads (since, severity, host), the response log the console has read
// and every report as JSON or CSV. The browser downloads the engine's
// own bytes; nothing is rewritten on the way.
import { useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { Severity, SfRespondAudit } from '@/lib/console-types'
import { REPORT_WINDOWS, type ReportWindowPreset } from '@/lib/reports'
import { exportHref, type ExportFilter } from '@/lib/v2/reports-model'
import { download } from '../respond/parts'
import { ReportActions } from './parts'

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

function Filters({ kind, f, onF, hosts }: { kind: 'alerts' | 'events'; f: ExportFilter; onF: (f: ExportFilter) => void; hosts: string[] }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  return (
    <div className="v2-x-filters">
      <div className="v2-field">
        <span>{t.xSince}</span>
        <div className="v2-seg" role="group" aria-label={t.xSince}>
          {(['', ...REPORT_WINDOWS] as ('' | ReportWindowPreset)[]).map((w) => (
            <button key={w || 'all'} type="button" aria-pressed={f.since === w} onClick={() => onF({ ...f, since: w })}>
              {w ? t.windows[w] : t.xAll}
            </button>
          ))}
        </div>
      </div>
      {kind === 'alerts' && (
        <div className="v2-field">
          <span>{t.xSeverity}</span>
          <div className="v2-chips" role="group" aria-label={t.xSeverity}>
            {SEVS.map((s) => (
              <button
                key={s}
                type="button"
                className="v2-chip-btn"
                aria-pressed={f.severity.includes(s)}
                onClick={() => onF({ ...f, severity: f.severity.includes(s) ? f.severity.filter((x) => x !== s) : [...f.severity, s] })}
              >
                <i style={{ ['--c' as string]: `var(--v2-sev-${s})` }} aria-hidden="true" />
                {dict.v2.sev[s]}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="v2-field">
        <span>{t.xHost}</span>
        <select className="v2-input" value={f.host} onChange={(e) => onF({ ...f, host: e.target.value })}>
          <option value="">{t.xHostAll}</option>
          {hosts.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
      <div className="v2-field">
        <span>{t.xFormat}</span>
        <div className="v2-seg" role="group" aria-label={t.xFormat}>
          {(['jsonl', 'csv'] as const).map((fmt) => (
            <button key={fmt} type="button" aria-pressed={f.format === fmt} onClick={() => onF({ ...f, format: fmt })}>
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DataExport({ hosts, audit, isAdmin }: { hosts: string[]; audit: SfRespondAudit | null | undefined; isAdmin: boolean }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  const [alertsF, setAlertsF] = useState<ExportFilter>({ format: 'jsonl', since: '7d', severity: [], host: '' })
  const [eventsF, setEventsF] = useState<ExportFilter>({ format: 'jsonl', since: '24h', severity: [], host: '' })
  const [win, setWin] = useState<ReportWindowPreset>('7d')

  return (
    <div className="v2-x">
      <div>
        <h2>{t.xTitle}</h2>
        <p className="v2-small v2-dim">{t.xHint}</p>
        <p className="v2-small v2-dim">{t.xStoreNote}</p>
      </div>
      <div className="v2-x-grid">
        {(
          [
            ['alerts', t.xAlerts, alertsF, setAlertsF],
            ['events', t.xEvents, eventsF, setEventsF],
          ] as const
        ).map(([kind, title, f, setF]) => (
          <section key={kind} className="v2-rep-block" aria-labelledby={`v2-x-${kind}`}>
            <h3 id={`v2-x-${kind}`}>{title}</h3>
            <Filters kind={kind} f={f} onF={setF} hosts={hosts} />
            <a className="v2-btn v2-btn-primary v2-x-go" href={exportHref(kind, f)} download>
              <DownloadSimple aria-hidden="true" />
              {t.download} · {f.format.toUpperCase()}
            </a>
          </section>
        ))}

        <section className="v2-rep-block" aria-labelledby="v2-x-audit">
          <h3 id="v2-x-audit">{t.xAudit}</h3>
          {!isAdmin || audit === undefined ? (
            <p className="v2-small v2-dim">{t.xAuditHidden}</p>
          ) : !audit || audit.records.length === 0 ? (
            <p className="v2-small v2-dim">{t.xAuditNone}</p>
          ) : (
            <>
              <p className="v2-small v2-dim">{t.xAuditHint(audit.records.length)}</p>
              <button
                type="button"
                className="v2-btn v2-x-go"
                onClick={() => download('respond-audit.jsonl', 'application/x-ndjson;charset=utf-8', audit.records.map((r) => JSON.stringify(r)).join('\n') + '\n')}
              >
                <DownloadSimple aria-hidden="true" />
                {t.download} · JSONL
              </button>
            </>
          )}
        </section>

        <section className="v2-rep-block" aria-labelledby="v2-x-reports">
          <h3 id="v2-x-reports">{t.xReports}</h3>
          <div className="v2-seg" role="group" aria-label={dict.v2.reportsView.windowAria}>
            {REPORT_WINDOWS.map((w) => (
              <button key={w} type="button" aria-pressed={w === win} onClick={() => setWin(w)}>
                {t.windows[w]}
              </button>
            ))}
          </div>
          <ul className="v2-x-reports">
            {(['executive', 'soc', 'fleet'] as const).map((kind) => (
              <li key={kind}>
                <span>{t.kinds[kind].title}</span>
                <ReportActions query={{ kind, window: win }} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
