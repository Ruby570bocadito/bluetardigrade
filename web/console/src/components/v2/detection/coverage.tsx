'use client'

// Detección · Cobertura ATT&CK: one line per tactic in kill-chain order,
// one square per technique the loaded rules detect (stronger with more
// rules), an amber dot where alerts in memory carry that technique, and
// the empty tactics left visible as gaps. A square lists its rules.
import { useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { RuleMeta, SfAlert } from '@/lib/console-types'
import type { TacticSlug } from '@/lib/soc-metrics'
import type { RuleRow } from '@/lib/v2/detection-model'
import { attackMatrix, parentTechniques } from '@/lib/v2/home-model'
import { SevPill } from './parts'

export function Coverage({ rows, rules, alerts, onOpen }: { rows: RuleRow[]; rules: RuleMeta[]; alerts: SfAlert[]; onOpen: (id: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const matrix = useMemo(() => attackMatrix(rules, alerts), [rules, alerts])
  const maxRules = Math.max(1, ...matrix.columns.flatMap((c) => c.cells.map((x) => x.rules)))
  const [picked, setPicked] = useState<{ slug: TacticSlug; id: string } | null>(null)
  const covered = matrix.columns.filter((c) => c.rules > 0).length

  const pickedRules = picked
    ? rows.filter((r) => r.tactic === picked.slug && parentTechniques(r.rule.tags, r.rule.mitre).includes(picked.id))
    : []

  return (
    <div className="v2-cov">
      <div className="v2-cov-head">
        <h2>{t.coverageTitle}</h2>
        <p className="v2-small v2-dim">{t.coverageHint}</p>
        <p className="v2-mono v2-small">{t.coverageCount(covered, matrix.techniques)}</p>
      </div>
      <div className="v2-cov-grid">
        <ul className="v2-cov-rows">
          {matrix.columns.map((col) => (
            <li key={col.slug} className="v2-cov-row" data-gap={col.cells.length === 0}>
              <span className="v2-cov-tactic">
                <strong>{dict.rules.tactics[col.slug]}</strong>
                <span className="v2-mono v2-dim">{col.rules}</span>
              </span>
              <span className="v2-cov-cells">
                {col.cells.length === 0 ? (
                  <span className="v2-cov-gap">{t.coverageGap}</span>
                ) : (
                  col.cells.map((cell) => {
                    const on = picked?.slug === col.slug && picked.id === cell.id
                    return (
                      <button
                        key={cell.id}
                        type="button"
                        className="v2-cov-cell"
                        aria-pressed={on}
                        aria-label={t.coverageCell(cell.id, cell.rules, cell.alerts)}
                        title={t.coverageCell(cell.id, cell.rules, cell.alerts)}
                        data-none={cell.rules === 0}
                        style={{ ['--a' as string]: cell.rules === 0 ? 0 : 0.18 + 0.62 * (cell.rules / maxRules) }}
                        onClick={() => setPicked(on ? null : { slug: col.slug, id: cell.id })}
                      >
                        <span className="v2-mono">{cell.id}</span>
                        {cell.alerts > 0 && <i aria-hidden="true" />}
                      </button>
                    )
                  })
                )}
              </span>
            </li>
          ))}
        </ul>
        <aside className="v2-cov-side" aria-live="polite">
          {!picked ? (
            <p className="v2-small v2-dim">{t.coveragePick}</p>
          ) : (
            <>
              <h3>
                {t.coverageRules(picked.id)}
                <span className="v2-dim"> · {dict.rules.tactics[picked.slug]}</span>
              </h3>
              {pickedRules.length === 0 ? (
                <p className="v2-small v2-dim">{t.coverageNoRules}</p>
              ) : (
                <ul className="v2-cov-list">
                  {pickedRules.map((r) => (
                    <li key={r.rule.id}>
                      <SevPill sev={r.rule.severity} />
                      <button type="button" className="v2-link" onClick={() => onOpen(r.rule.id)}>
                        {r.rule.name}
                      </button>
                      <span className="v2-mono v2-dim">{r.alerts24h}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
