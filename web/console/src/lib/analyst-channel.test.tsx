import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import {
  ANALYST_MARKDOWN_GUARD, acceptsFrame, alertKey, analystSocketOptions, analystTarget, withDelta, withDone, withError, withStep,
} from './analyst-channel'
import type { AnalystMessage, SfAlert } from './console-types'

const alert = (id: string, extra: Partial<SfAlert> = {}): SfAlert => ({
  id,
  timestamp: '2026-11-12T10:00:00Z',
  rule_id: 'r1',
  rule_name: 'Same rule',
  severity: 'high',
  host: `HOST-${id}`,
  event_id: `ev-${id}`,
  event_type: 'process.create',
  summary: 's',
  matched_on: [],
  tags: [],
  ...extra,
})

const ask = (id: string, extra: Partial<AnalystMessage> = {}): AnalystMessage => ({ id: `u-${id}`, role: 'user', ...extra })
const answer = (requestId: string): AnalystMessage => ({ id: `a-${requestId}`, role: 'analyst', requestId, steps: [], text: '' })

describe('analyst socket options', () => {
  test('the client never gives up reconnecting and caps the delay', () => {
    const opts = analystSocketOptions('')
    expect(opts.reconnection).toBe(true)
    expect(opts.reconnectionAttempts).toBe(Infinity)
    expect(opts.reconnectionDelayMax).toBeGreaterThanOrEqual(opts.reconnectionDelay as number)
    expect(opts.reconnectionDelayMax).toBeLessThanOrEqual(30_000)
    expect(opts.auth).toEqual({})
    expect(analystSocketOptions('hub-secret').auth).toEqual({ token: 'hub-secret' })
  })
})

describe('frames of the analysis in flight', () => {
  test('only frames of the active request are accepted', () => {
    expect(acceptsFrame('B', { requestId: 'B' })).toBe(true)
    // a frame of the analysis that was cut off must not write into B
    expect(acceptsFrame('B', { requestId: 'A' })).toBe(false)
    // nothing in flight: nothing to write to
    expect(acceptsFrame(null, { requestId: 'A' })).toBe(false)
    expect(acceptsFrame(null, {})).toBe(false)
    // a hub without request ids answers the one request allowed at a time
    expect(acceptsFrame('B', {})).toBe(true)
    expect(acceptsFrame('B', undefined)).toBe(true)
    expect(acceptsFrame('B', { requestId: 7 })).toBe(false)
  })

  test('frames change the answer of their own request, wherever it sits', () => {
    let messages: AnalystMessage[] = [ask('1'), answer('A'), ask('2'), answer('B')]
    messages = withStep(messages, 'A', { label: 'paso', state: 'run' })
    messages = withStep(messages, 'A', { label: 'paso', state: 'done' })
    messages = withDelta(messages, 'A', 'respuesta ')
    messages = withDelta(messages, 'A', 'de A')
    messages = withDelta(messages, 'B', 'de B')
    expect(messages[1].steps).toEqual([{ label: 'paso', state: 'done' }])
    expect(messages[1].text).toBe('respuesta de A')
    expect(messages[3].text).toBe('de B')
    // done keeps what was streamed and fills an answer that got no delta
    expect(withDone(messages, 'A', 'otro texto')[1].text).toBe('respuesta de A')
    expect(withDone([ask('1'), answer('C')], 'C', 'entera')[1].text).toBe('entera')
    expect(withError(messages, 'B', 'fallo')[3].error).toBe('fallo')
    expect(withError(messages, 'B', 'fallo')[1].error).toBeUndefined()
    // an unknown request changes nothing (same array, no re-render)
    expect(withDelta(messages, 'Z', 'x')).toBe(messages)
  })
})

describe('what a follow-up or a retry is about', () => {
  // two alerts of the same rule on different hosts, a newer third on top:
  // looking the alert up by rule name or taking the newest picks the
  // wrong machine
  const newest = alert('3', { rule_name: 'Other rule' })
  const sameRuleOtherHost = alert('2')
  const analysed = alert('1')
  const queue = [newest, sameRuleOtherHost, analysed]

  test('the alert that was analysed, not the newest nor a namesake', () => {
    const messages = [ask('1', { alertName: analysed.rule_name, alert: analysed }), answer('A')]
    const target = analystTarget(messages, queue)
    expect(target).toEqual({ kind: 'alert', alert: analysed })
    expect(target?.kind === 'alert' && target.alert.host).toBe('HOST-1')
  })

  test('still the analysed alert after it left the live queue', () => {
    const messages = [ask('1', { alertName: analysed.rule_name, alert: analysed }), answer('A')]
    expect(analystTarget(messages, [newest])).toEqual({ kind: 'alert', alert: analysed })
  })

  test('the last request decides: an incident after an alert', () => {
    const incident = ask('2', { incidentTitle: 'Caso', incidentPayload: { source: 'incident', alerts: [analysed], groups: [] } as unknown as AnalystMessage['incidentPayload'] })
    const messages = [ask('1', { alert: analysed }), answer('A'), incident, answer('B')]
    expect(analystTarget(messages, queue)).toEqual({ kind: 'incident', message: incident })
  })

  test('an empty transcript starts with the newest alert, or nothing', () => {
    expect(analystTarget([], queue)).toEqual({ kind: 'alert', alert: newest })
    expect(analystTarget([], [])).toBeNull()
  })

  test('alert keys', () => {
    expect(alertKey(analysed)).toBe('1')
    expect(alertKey({ id: '', event_id: 'ev-9', rule_id: 'r1' } as SfAlert)).toBe('ev-9:r1')
  })
})

describe('analyst answer rendering', () => {
  const render = (text: string) => renderToStaticMarkup(<ReactMarkdown {...ANALYST_MARKDOWN_GUARD}>{text}</ReactMarkdown>)

  test('links and images in the answer are not rendered, their text stays', () => {
    const html = render('**Riesgo** alto. [Ver evidencia](https://attacker.example/x) ![pixel](https://attacker.example/p.png) <https://attacker.example/auto>')
    expect(html).toContain('<strong>Riesgo</strong>')
    expect(html).toContain('Ver evidencia')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href')
    expect(html).not.toContain('src=')
  })

  test('the formatting the analyst uses still renders', () => {
    const html = render('**Qué ha pasado**: `cmd.exe`\n\n- uno\n- dos')
    expect(html).toContain('<code>cmd.exe</code>')
    expect(html).toContain('<li>uno</li>')
  })
})
