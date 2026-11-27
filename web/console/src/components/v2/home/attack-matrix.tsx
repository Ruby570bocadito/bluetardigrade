'use client'

// The MITRE ATT&CK matrix of the console: one column per tactic, in the
// order an attack moves; one square per technique the rules detect. Grey
// squares are covered and quiet; amber ones carry alerts, brighter with
// more. A column without squares is a tactic no rule covers yet.
import { useI18n } from '@/components/console/i18n-provider'
import type { AttackMatrix as Matrix } from '@/lib/v2/home-model'
import { Panel } from './parts'

export function AttackMatrix({ matrix }: { matrix: Matrix }) {
  const { dict } = useI18n()
  const t = dict.v2.matrix
  const covered = matrix.columns.filter((c) => c.cells.length > 0).length
  const hot = matrix.columns.reduce((s, c) => s + c.cells.filter((cell) => cell.alerts > 0).length, 0)

  return (
    <Panel
      labelledBy="v2-matrix-title"
      title={t.title}
      subtitle={t.subtitle}
      className="v2-matrix-panel"
      action={
        <div className="v2-legend" aria-hidden="true">
          <span>
            <i data-kind="quiet" />
            {t.legendQuiet}
          </span>
          <span>
            <i data-kind="hot" />
            {t.legendHot}
          </span>
        </div>
      }
    >
      <p className="v2-matrix-summary">
        {t.summary(matrix.techniques, covered, hot)}
        {matrix.untagged > 0 && ` · ${t.untagged(matrix.untagged)}`}
      </p>
      <div className="v2-matrix-scroll">
        <div className="v2-matrix">
          {matrix.columns.map((column) => {
            const name = dict.rules.tactics[column.slug]
            return (
              <div key={column.slug} className="v2-matrix-col" role="group" aria-label={t.columnAria(name, column.cells.length, column.alerts)}>
                <span className="v2-matrix-head" title={name} aria-hidden="true">
                  {dict.rules.tacticsShort[column.slug]}
                </span>
                <div className="v2-matrix-cells">
                  {column.cells.length === 0 ? (
                    <span className="v2-matrix-none" title={t.uncovered}>
                      —
                    </span>
                  ) : (
                    column.cells.map((cell) => {
                      const ratio = matrix.max > 0 ? cell.alerts / matrix.max : 0
                      const label = t.cellAria(cell.id, cell.rules, cell.alerts)
                      return (
                        <span
                          key={cell.id}
                          className="v2-matrix-cell"
                          data-hot={cell.alerts > 0}
                          title={label}
                          aria-label={label}
                          role="img"
                          style={cell.alerts > 0 ? { ['--heat' as string]: `${Math.round(35 + 65 * ratio)}%` } : undefined}
                        />
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}
