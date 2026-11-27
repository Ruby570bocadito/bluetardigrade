'use client'

// v2 · Detección: what the engine detects and how well. The loaded rules
// (searchable down to their conditions, each with its own page), their
// ATT&CK coverage, the chains the engine correlates, a tester, the noise
// report, the suppressions, the validation battery, the indicator lists
// and the draft of a new rule written from a hunting query. Rules and
// chains are files on the engine host: read here, never edited. View,
// open rule, rule filters and the draft query live in the URL (vista,
// regla, q, sev, tactica).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { EXAMPLES } from '@/components/console/rule-tester'
import type { Severity } from '@/lib/console-types'
import { tacticSlug } from '@/lib/soc-metrics'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import {
  byActivity,
  chainRows,
  DETECTION_TABS,
  detectionTabFromParam,
  filterRuleRows,
  ruleRows,
  skeletonEvent,
  type DetectionTab,
  type RuleFilter,
  type RuleRow,
} from '@/lib/v2/detection-model'
import { Toast, type ToastState } from '../alerts/toast'
import { useNow } from '../use-now'
import { Battery } from './battery'
import { Chains } from './chains'
import { Coverage } from './coverage'
import { DraftRule } from './draft-rule'
import { Indicators } from './indicators'
import { Noise } from './noise'
import { RuleCatalog } from './rule-catalog'
import { RulePage } from './rule-page'
import { Suppressions, type SuppressionSeed } from './suppressions'
import { Tester } from './tester'

const SEVS: readonly string[] = ['critical', 'high', 'medium', 'low', 'info']
const pretty = (v: unknown) => JSON.stringify(v, null, 2)

export function DetectionView() {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const { rules, sequences, suppressions, alerts, events, refresh } = useEngine()
  const me = useConsoleUser()
  const now = useNow(1000)

  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<DetectionTab>('reglas')
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<RuleFilter>({ q: '', sev: 'all', tactic: 'all' })
  const [draftQ, setDraftQ] = useState('')
  const [testText, setTestText] = useState(() => pretty(EXAMPLES[0].event))
  const [seed, setSeed] = useState<SuppressionSeed>(null)
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    const apply = () => {
      const p = new URLSearchParams(currentSearch())
      const view = detectionTabFromParam(p.get('vista'))
      const sev = p.get('sev') ?? ''
      const tactica = p.get('tactica')
      setTab(view)
      setOpen(p.get('regla'))
      setFilter({
        q: view === 'reglas' ? (p.get('q') ?? '') : '',
        sev: SEVS.includes(sev) ? (sev as Severity) : 'all',
        tactic: tactica === 'ninguna' ? 'none' : (tacticSlug(tactica ?? '') ?? 'all'),
      })
      setDraftQ(view === 'borrador' ? (p.get('q') ?? '') : '')
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return undefined
    const id = window.setTimeout(() => {
      replaceOperatorState((search) => {
        let s = setSearchParam(search, 'vista', tab === 'reglas' ? null : tab)
        s = setSearchParam(s, 'regla', open)
        s = setSearchParam(s, 'q', tab === 'reglas' ? filter.q || null : tab === 'borrador' ? draftQ || null : null)
        s = setSearchParam(s, 'sev', tab === 'reglas' && filter.sev !== 'all' ? filter.sev : null)
        return setSearchParam(s, 'tactica', tab === 'reglas' && filter.tactic !== 'all' ? (filter.tactic === 'none' ? 'ninguna' : filter.tactic) : null)
      })
    }, 200)
    return () => window.clearTimeout(id)
  }, [ready, tab, open, filter, draftQ])

  const rows = useMemo(() => ruleRows(rules, alerts, sequences, suppressions, now ?? Date.now()), [rules, alerts, sequences, suppressions, now])
  const shown = useMemo(() => filterRuleRows(rows, filter).sort(byActivity), [rows, filter])
  const chains = useMemo(() => chainRows(sequences, rules, alerts), [sequences, rules, alerts])
  const hosts = useMemo(() => [...new Set([...events.map((e) => e.host), ...alerts.map((a) => a.host)].filter(Boolean))].sort(), [events, alerts])
  const ruleIds = useMemo(() => new Set(rules.map((r) => r.id)), [rules])
  const activeSups = suppressions.filter((s) => !s.expires || Date.parse(s.expires) > (now ?? Date.now())).length
  const notice = useCallback((message: string) => setToast({ id: Date.now(), message }), [])
  const canWrite = me.can_triage

  const go = (next: DetectionTab) => {
    setTab(next)
    setOpen(null)
    window.scrollTo({ top: 0 })
  }
  const openRule = (id: string) => {
    setOpen(id)
    window.scrollTo({ top: 0 })
  }
  const suppress = (ruleId: string, host = '', name?: string) => {
    setSeed({ id: Date.now(), ruleId, host, name })
    go('supresiones')
  }
  const testRule = (row: RuleRow) => {
    // the newest event in memory that fired the rule, or a draft written from its conditions
    const fired = alerts
      .filter((a) => a.rule_id === row.rule.id)
      .map((a) => events.find((e) => e.id === a.event_id))
      .find((e) => !!e)
    if (fired) {
      const { id: _id, timestamp: _ts, ...rest } = fired
      setTestText(pretty(rest))
    } else setTestText(pretty(skeletonEvent(row.rule)))
    go('probador')
  }

  const toastEl = <Toast toast={toast} onClose={() => setToast(null)} />

  if (open)
    return (
      <div className="v2-det">
        <section className="v2-panel">
          <RulePage
            id={open}
            row={rows.find((r) => r.rule.id === open)}
            alerts={alerts}
            now={now}
            canWrite={canWrite}
            onBack={() => setOpen(null)}
            onTest={testRule}
            onSuppress={(id) => suppress(id)}
            onChain={() => go('cadenas')}
          />
        </section>
        {toastEl}
      </div>
    )

  return (
    <div className="v2-det">
      <div className="v2-det-summary" role="status">
        <b className="v2-mono">{t.summary(rules.length, sequences.length, activeSups)}</b>
        <span className="v2-small v2-dim">{t.filesNote}</span>
      </div>

      <div className="v2-tabs v2-det-tabs" role="tablist" aria-label={t.tabsAria}>
        {DETECTION_TABS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={v === tab} onClick={() => go(v)}>
            {t.tabs[v]}
          </button>
        ))}
      </div>

      <section className="v2-panel v2-det-panel" aria-label={t.tabs[tab]}>
        {tab === 'reglas' ? (
          <RuleCatalog rows={shown} all={rows} filter={filter} onFilter={(patch) => setFilter((f) => ({ ...f, ...patch }))} onOpen={openRule} />
        ) : tab === 'cobertura' ? (
          <Coverage rows={rows} rules={rules} alerts={alerts} onOpen={openRule} />
        ) : tab === 'cadenas' ? (
          <Chains chains={chains} now={now} onOpen={openRule} />
        ) : tab === 'probador' ? (
          <Tester text={testText} onText={setTestText} events={events} onOpen={openRule} />
        ) : tab === 'ruido' ? (
          <Noise hosts={hosts} ruleIds={ruleIds} canWrite={canWrite} onOpen={openRule} onSuppress={suppress} />
        ) : tab === 'supresiones' ? (
          <Suppressions
            list={suppressions}
            rules={rules}
            hosts={hosts}
            now={now}
            seed={seed}
            canWrite={canWrite}
            onChanged={refresh}
            onNotice={notice}
            onOpen={openRule}
          />
        ) : tab === 'validacion' ? (
          <Battery canRun={me.can_triage} onNotice={notice} />
        ) : tab === 'indicadores' ? (
          <Indicators alerts={alerts} now={now} />
        ) : (
          <DraftRule q={draftQ} onQ={setDraftQ} events={events} onNotice={notice} />
        )}
      </section>
      {toastEl}
    </div>
  )
}
