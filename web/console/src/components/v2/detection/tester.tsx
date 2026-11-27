'use client'

// Detección · Probador: an event (written by hand, taken from an example,
// from the events in memory or drafted from a rule) evaluated against
// every loaded rule. Nothing is raised, stored or forwarded. The answer
// lists the rules that would fire and lights up the fields they matched.
import { useMemo, useState } from 'react'
import { Play } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { EXAMPLES } from '@/components/console/rule-tester'
import type { SfEvent } from '@/lib/console-types'
import { testRules, type RuleTestResult } from '@/lib/engine-writes'
import { matchedLines } from '@/lib/v2/detection-model'
import { eventTarget } from '@/lib/v2/investigate-model'
import { Empty } from '../home/parts'
import { SevPill } from './parts'

const pretty = (v: unknown) => JSON.stringify(v, null, 2)

/** What the engine keeps of an event that a rule can read (no ids or the console's own fields). */
function testable(ev: SfEvent): Record<string, unknown> {
  const { id: _id, timestamp: _ts, ...rest } = ev as SfEvent & { id?: string; timestamp?: string }
  return rest
}

export function Tester({ text, onText, events, onOpen }: { text: string; onText: (s: string) => void; events: SfEvent[]; onOpen: (id: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [tested, setTested] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const recent = useMemo(() => [...events].slice(-40).reverse(), [events])

  const load = (s: string) => {
    onText(s)
    setResult(null)
    setError('')
  }

  async function run() {
    let event: unknown
    try {
      event = JSON.parse(text)
    } catch {
      setResult(null)
      return setError(t.testerBadJson)
    }
    if (!event || typeof event !== 'object' || typeof (event as { type?: unknown }).type !== 'string') {
      setResult(null)
      return setError(t.testerNeedsType)
    }
    setBusy(true)
    setError('')
    const res = await testRules(event as { type: string })
    setBusy(false)
    if (!res.ok) {
      setResult(null)
      return setError(t.testerError(res.error))
    }
    setResult(res.data)
    setTested(pretty(event))
    setFocus(null)
  }

  const fields = result ? (focus ? (result.matches.find((m) => m.id === focus)?.matched_on ?? []) : result.matches.flatMap((m) => m.matched_on)) : []
  const lit = matchedLines(tested, fields)

  return (
    <div className="v2-tester">
      <section className="v2-tester-in" aria-labelledby="v2-tester-title">
        <h2 id="v2-tester-title">{t.testerTitle}</h2>
        <p className="v2-small v2-dim">{t.testerHint}</p>
        <div className="v2-tester-pick">
          <span className="v2-eyebrow">{t.testerExamples}</span>
          <div className="v2-chips">
            {EXAMPLES.map((ex, i) => (
              <button key={i} type="button" className="v2-chip-btn" onClick={() => load(pretty(ex.event))}>
                {dict.tester.examples[i]}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <label className="v2-select">
              <span className="v2-sr-only">{t.testerFromMemory}</span>
              <select
                value=""
                onChange={(e) => {
                  const ev = recent.find((x) => x.id === e.target.value)
                  if (ev) load(pretty(testable(ev)))
                }}
              >
                <option value="">{t.testerFromMemory}</option>
                {recent.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {`${ev.type} · ${ev.host} · ${eventTarget(ev)}`.slice(0, 90)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <textarea className="v2-input v2-textarea v2-tester-json" value={text} onChange={(e) => load(e.target.value)} spellCheck={false} rows={16} aria-label={t.testerEditorAria} />
        <div className="v2-tester-run">
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => void run()} disabled={busy}>
            <Play aria-hidden="true" />
            {busy ? t.testerRunning : t.testerRun}
          </button>
          {error && (
            <p role="alert" className="v2-error">
              {error}
            </p>
          )}
        </div>
      </section>

      <section className="v2-tester-out" aria-live="polite" aria-label={t.tabs.probador}>
        {!result ? (
          <Empty title={t.testerIdle} />
        ) : (
          <>
            <p className="v2-tester-count">
              <b>{t.testerResult(result.matches.length, result.evaluated)}</b>
              <span className="v2-mono v2-dim"> · {result.event_type}</span>
            </p>
            {result.matches.length === 0 ? (
              <p className="v2-small v2-dim">{t.testerNone}</p>
            ) : (
              <ul className="v2-tester-matches">
                {result.matches.map((m) => (
                  <li key={m.id} data-on={focus === m.id}>
                    <div>
                      <SevPill sev={m.severity} />
                      <button type="button" className="v2-link" onClick={() => onOpen(m.id)}>
                        {m.name}
                      </button>
                      {m.mitre && <span className="v2-tag v2-mono">{m.mitre}</span>}
                    </div>
                    <button type="button" className="v2-tester-fields" aria-pressed={focus === m.id} onClick={() => setFocus(focus === m.id ? null : m.id)}>
                      <span className="v2-dim">{t.testerOn}</span>
                      {m.matched_on.map((f) => (
                        <code key={f}>{f}</code>
                      ))}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <pre className="v2-tester-event" aria-label={t.testerEditorAria}>
              {tested.split('\n').map((line, i) => (
                <span key={i} data-lit={lit.has(i)}>
                  {line || ' '}
                </span>
              ))}
            </pre>
          </>
        )}
      </section>
    </div>
  )
}
