'use client'

// Directorio · Hallazgos: every finding of the last analysis, critical
// first, each opening on the engine's own description and remediation
// and the objects it names. The engine's prose travels verbatim; the
// count is the real total even when the list of objects is cut.
import { useI18n } from '@/components/console/i18n-provider'
import type { ADFinding } from '@/lib/directory'
import type { Severity } from '@/lib/console-types'
import { bySeverity } from '@/lib/v2/directory-model'
import { Empty, SEV_COLOR } from '../home/parts'

export function Findings({ findings }: { findings: ADFinding[] }) {
  const { dict } = useI18n()
  const t = dict.v2.directoryView
  const d = dict.directory
  if (findings.length === 0) return <Empty title={d.findings.emptyTitle}>{d.findings.emptyHint}</Empty>
  return (
    <div className="v2-set-stack">
      <div className="v2-set-head">
        <h2>{d.findings.title}</h2>
        <p className="v2-small v2-dim">{d.findings.headHint}</p>
      </div>
      <ul className="v2-dir-findings" aria-label={t.findingsAria}>
        {bySeverity(findings).map((f, i) => {
          const color = SEV_COLOR[f.severity as Severity] ?? 'var(--v2-text-3)'
          return (
            <li key={f.id} style={{ ['--i' as string]: i }}>
              <details>
                <summary>
                  <span className="v2-dir-sevchip" style={{ ['--c' as string]: color }}>
                    {d.sevLabels[f.severity as keyof typeof d.sevLabels] ?? f.severity}
                  </span>
                  <span className="v2-dir-ftitle">{f.title}</span>
                  <b className="v2-mono">{t.affected(f.count)}</b>
                </summary>
                <div className="v2-dir-fbody">
                  {f.description && <p>{f.description}</p>}
                  {f.remediation && (
                    <p>
                      <strong>{d.remediationLabel}</strong>
                      {f.remediation}
                    </p>
                  )}
                  {f.objects.length > 0 && (
                    <div className="v2-rep-tablewrap">
                      <table className="v2-rep-table v2-dir-objtable">
                        <caption className="v2-sr-only">{d.affectedCaption}</caption>
                        <thead>
                          <tr>
                            <th>{d.affectedCols.object}</th>
                            <th>{d.affectedCols.dn}</th>
                            <th>{d.affectedCols.detail}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.objects.map((o) => (
                            <tr key={o.dn}>
                              <td>{o.name || '—'}</td>
                              <td className="v2-mono v2-dir-dn" title={o.dn}>
                                {o.dn}
                              </td>
                              <td>{o.detail || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {f.objects_truncated && <p className="v2-small v2-dim">{d.truncatedList}</p>}
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
