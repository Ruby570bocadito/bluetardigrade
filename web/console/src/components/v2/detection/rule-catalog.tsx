'use client'

// Detección · Reglas: the loaded pack, busiest first. Each row opens in
// place to show its conditions; the full rule has its own page. The
// search reaches the conditions too (a value, a field, a technique).
import { useState } from 'react'
import { CaretRight, LinkSimple, MagnifyingGlass, SpeakerSlash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { Severity } from '@/lib/console-types'
import { ATTACK_TACTICS, type TacticSlug } from '@/lib/soc-metrics'
import type { RuleFilter, RuleRow } from '@/lib/v2/detection-model'
import { Empty } from '../home/parts'
import { Spark } from '../hosts/parts'
import { Conditions, SevPill } from './parts'

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export function RuleCatalog({
  rows,
  all,
  filter,
  onFilter,
  onOpen,
}: {
  rows: RuleRow[]
  all: RuleRow[]
  filter: RuleFilter
  onFilter: (patch: Partial<RuleFilter>) => void
  onOpen: (id: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const [expanded, setExpanded] = useState<string | null>(null)
  const present = new Set(all.map((r) => r.rule.severity))
  const tactics = new Set(all.map((r) => r.tactic))

  return (
    <>
      <div className="v2-det-filters">
        <label className="v2-search">
          <MagnifyingGlass aria-hidden="true" />
          <input value={filter.q} onChange={(e) => onFilter({ q: e.target.value })} placeholder={t.search} aria-label={t.search} />
        </label>
        <div className="v2-chips" role="group" aria-label={t.sevAria}>
          <button type="button" className="v2-chip-btn" aria-pressed={filter.sev === 'all'} onClick={() => onFilter({ sev: 'all' })}>
            {t.sevAll}
          </button>
          {SEVS.filter((s) => present.has(s) || filter.sev === s).map((s) => (
            <button key={s} type="button" className="v2-chip-btn" aria-pressed={filter.sev === s} onClick={() => onFilter({ sev: filter.sev === s ? 'all' : s })}>
              <i className="v2-dot" style={{ ['--c' as string]: `var(--v2-sev-${s})` }} aria-hidden="true" />
              {dict.v2.sev[s]}
            </button>
          ))}
        </div>
        <label className="v2-select">
          <span className="v2-sr-only">{t.tacticAria}</span>
          <select value={filter.tactic} onChange={(e) => onFilter({ tactic: e.target.value as TacticSlug | 'all' | 'none' })}>
            <option value="all">{t.tacticAll}</option>
            {ATTACK_TACTICS.filter((x) => tactics.has(x.slug) || filter.tactic === x.slug).map((x) => (
              <option key={x.slug} value={x.slug}>
                {dict.rules.tactics[x.slug]}
              </option>
            ))}
            {tactics.has(null) && <option value="none">{t.tacticNone}</option>}
          </select>
        </label>
      </div>

      {all.length === 0 ? (
        <Empty title={t.noRulesLoaded}>{t.filesNote}</Empty>
      ) : rows.length === 0 ? (
        <Empty title={t.noRules} />
      ) : (
        <div className="v2-rules">
          <div className="v2-rules-head" aria-hidden="true">
            <span>{t.cols.sev}</span>
            <span>{t.cols.rule}</span>
            <span>{t.cols.technique}</span>
            <span>{t.cols.type}</span>
            <span>{t.cols.alerts}</span>
          </div>
          <ul aria-label={t.tabs.reglas}>
          {rows.map((r) => {
            const open = expanded === r.rule.id
            return (
              <li key={r.rule.id} className="v2-rule" data-open={open}>
                <button type="button" className="v2-rule-row" aria-expanded={open} onClick={() => setExpanded(open ? null : r.rule.id)}>
                  <span className="v2-rule-sev">
                    <CaretRight className="v2-rule-caret" aria-hidden="true" />
                    <SevPill sev={r.rule.severity} />
                  </span>
                  <span className="v2-rule-name">
                    <strong>{r.rule.name}</strong>
                    <span className="v2-mono v2-dim">{r.rule.id}</span>
                  </span>
                  <span className="v2-mono v2-rule-tech">{r.rule.mitre || <span className="v2-dim">—</span>}</span>
                  <span className="v2-mono v2-dim v2-rule-type">{r.rule.event_type}</span>
                  <span className="v2-rule-alerts">
                    <b className="v2-mono" data-zero={r.alerts24h === 0}>
                      {r.alerts24h}
                      <span className="v2-sr-only"> {t.cols.alerts}</span>
                    </b>
                    <Spark values={r.week} label={t.weekAria(r.rule.name)} />
                  </span>
                </button>
                {open && (
                  <div className="v2-rule-more">
                    {r.rule.description && <p>{r.rule.description}</p>}
                    <h3 className="v2-eyebrow">{t.conditions}</h3>
                    <Conditions rule={r.rule} />
                    <div className="v2-rule-foot">
                      {r.chains.length > 0 && (
                        <span className="v2-tag">
                          <LinkSimple aria-hidden="true" />
                          {t.chainsOf(r.chains.length)}
                        </span>
                      )}
                      {r.suppressions.length > 0 && (
                        <span className="v2-tag">
                          <SpeakerSlash aria-hidden="true" />
                          {t.suppressedOn(r.suppressions.length)}
                        </span>
                      )}
                      <button type="button" className="v2-btn" onClick={() => onOpen(r.rule.id)}>
                        {t.openRule}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
          </ul>
        </div>
      )}
    </>
  )
}
