'use client'

// Detección · De búsqueda a regla: a hunting query (the same tokens as in
// Investigar) written as a rule of the engine. Each token becomes a
// condition; the ones a rule cannot say are listed and left out, never
// bent. The rule files live on the engine host, so the result is YAML to
// copy into rules/*.yaml — nothing is written from here.
import { useMemo, useState } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { Severity, SfEvent } from '@/lib/console-types'
import { ATTACK_TACTICS, type TacticSlug } from '@/lib/soc-metrics'
import { draftFromTokens, draftYaml, parseTechniques, ruleIdFrom } from '@/lib/v2/detection-model'
import { filterEvents, formatQuery, formatToken, parseQuery } from '@/lib/v2/investigate-model'
import { QueryBar } from '../investigate/query-bar'

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export function DraftRule({ q, onQ, events, onNotice }: { q: string; onQ: (q: string) => void; events: SfEvent[]; onNotice: (message: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.detectionView
  const ops = t.operators as Record<string, string>
  const tokens = useMemo(() => parseQuery(q), [q])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [techniques, setTechniques] = useState('')
  const [tactic, setTactic] = useState<TacticSlug | ''>('')
  const [copied, setCopied] = useState(false)

  const draft = useMemo(() => draftFromTokens(tokens, 'process.create'), [tokens])
  const matches = useMemo(() => (tokens.length ? filterEvents(events, tokens).length : 0), [events, tokens])
  const title = name.trim() || t.draftNamePlaceholder
  const yaml = draftYaml(draft, {
    id: ruleIdFrom(title),
    name: title,
    description: description.trim(),
    severity,
    techniques: parseTechniques(techniques),
    tactic: tactic || null,
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(yaml)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      onNotice(t.draftCopyFailed)
    }
  }

  return (
    <div className="v2-draft">
      <section className="v2-draft-in" aria-labelledby="v2-draft-title">
        <h2 id="v2-draft-title">{t.draftTitle}</h2>
        <p className="v2-small v2-dim">{t.draftHint}</p>
        <QueryBar tokens={tokens} onTokens={(next) => onQ(formatQuery(next, lang))} events={events} onNotice={onNotice} />
        {tokens.length > 0 && <p className="v2-small">{t.draftMatches(matches, events.length)}</p>}
        <div className="v2-draft-form">
          <label className="v2-field">
            <span>{t.draftName}</span>
            <input className="v2-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.draftNamePlaceholder} maxLength={120} />
          </label>
          <label className="v2-field">
            <span>{t.draftDescription}</span>
            <textarea className="v2-input v2-textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={600} />
          </label>
          <label className="v2-field">
            <span>{t.draftSeverity}</span>
            <select className="v2-input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {SEVS.map((s) => (
                <option key={s} value={s}>
                  {dict.v2.sev[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="v2-field">
            <span>{t.draftTechniques}</span>
            <input className="v2-input v2-mono" value={techniques} onChange={(e) => setTechniques(e.target.value)} placeholder="T1053.005" />
          </label>
          <label className="v2-field">
            <span>{t.draftTactic}</span>
            <select className="v2-input" value={tactic} onChange={(e) => setTactic(e.target.value as TacticSlug | '')}>
              <option value="">—</option>
              {ATTACK_TACTICS.map((x) => (
                <option key={x.slug} value={x.slug}>
                  {dict.rules.tactics[x.slug]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="v2-draft-out" aria-labelledby="v2-draft-yaml">
        <h2 id="v2-draft-yaml" className="v2-sr-only">
          YAML
        </h2>
        {tokens.length === 0 ? (
          <p className="v2-small v2-dim">{t.draftEmpty}</p>
        ) : (
          <>
            <ul className="v2-conds">
              <li>
                <code className="v2-cond-field">event_type</code>
                <span className="v2-cond-op">=</span>
                <span className="v2-cond-values">
                  <code>{draft.eventType}</code>
                </span>
              </li>
              {draft.conditions.map((c, i) => (
                <li key={i}>
                  <code className="v2-cond-field">{c.field}</code>
                  <span className="v2-cond-op" title={c.operator}>
                    {ops[c.operator] ?? c.operator}
                  </span>
                  <span className="v2-cond-values">
                    <code>{String(c.value)}</code>
                  </span>
                </li>
              ))}
            </ul>
            {draft.skipped.length > 0 && (
              <div className="v2-draft-skipped" role="note">
                <span className="v2-small">{t.draftSkipped}</span>
                {draft.skipped.map((tok, i) => (
                  <code key={i}>{formatToken(tok, lang)}</code>
                ))}
              </div>
            )}
            <div className="v2-draft-yamlbox">
              <button type="button" className="v2-btn" onClick={() => void copy()}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? t.draftCopied : t.draftCopy}
              </button>
              <pre className="v2-mono">{yaml}</pre>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
