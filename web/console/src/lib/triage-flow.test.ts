// Unit tests for the VIZ-3 triage flow model (triage-flow.ts): the
// three real engine states, missing sources/tactics, deterministic
// ordering, folding into «Otras …» and the sum invariants of both link
// sets. No false-positive state is ever invented: the engine API only
// publishes new / acknowledged / closed.

//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import { buildTriageFlow, triageStateOf, triageTacticFullLabel, TRIAGE_STATES, OTHER_SOURCE_LABEL, OTHER_TACTIC_LABEL, NO_SOURCE_LABEL, NO_TACTIC_LABEL } from './triage-flow'
import type { SfAlert } from './console-types'

const alert = (over: Partial<SfAlert>): Pick<SfAlert, 'source' | 'tags' | 'status'> => ({
  source: 'sysmon',
  tags: ['attack.execution'],
  status: undefined,
  ...over,
})

describe('triageStateOf', () => {
  test('maps the engine lifecycle onto the three visible states', () => {
    expect(triageStateOf({ status: undefined })).toBe('nuevas')
    expect(triageStateOf({ status: 'acknowledged' })).toBe('reconocidas')
    expect(triageStateOf({ status: 'closed' })).toBe('cerradas')
  })
})

describe('buildTriageFlow', () => {
  test('empty window: no nodes with value, fixed states at zero, no links', () => {
    const m = buildTriageFlow([])
    expect(m.total).toBe(0)
    expect(m.sources).toEqual([])
    expect(m.tactics).toEqual([])
    expect(m.states.map((s) => s.value)).toEqual([0, 0, 0])
    expect(m.sourceTactic).toEqual([])
    expect(m.tacticState).toEqual([])
  })

  test('one alert flows exactly once through the three levels', () => {
    const m = buildTriageFlow([alert({})])
    expect(m.total).toBe(1)
    expect(m.sources).toEqual([{ key: 'sysmon', label: 'sysmon', value: 1 }])
    expect(m.tactics).toEqual([{ key: 'execution', label: 'Ejecución', value: 1 }])
    expect(m.states.map((s) => s.value)).toEqual([1, 0, 0])
    expect(m.sourceTactic).toEqual([{ source: 'sysmon', target: 'execution', value: 1 }])
    expect(m.tacticState).toEqual([{ source: 'execution', target: 'nuevas', value: 1 }])
  })

  test('missing or blank source falls into «Sin fuente»', () => {
    const m = buildTriageFlow([alert({ source: undefined }), alert({ source: '   ' })])
    expect(m.sources).toEqual([{ key: '__sin-fuente', label: NO_SOURCE_LABEL, value: 2 }])
  })

  test('alerts without a tactic tag fall into «Sin táctica»', () => {
    const m = buildTriageFlow([alert({ tags: undefined }), alert({ tags: ['not-a-tactic'] })])
    expect(m.tactics).toEqual([{ key: '__sin-tactica', label: NO_TACTIC_LABEL, value: 2 }])
  })

  test('states stay in workflow order even with mixed statuses', () => {
    const m = buildTriageFlow([
      alert({ status: 'closed' }),
      alert({ status: 'acknowledged' }),
      alert({ status: 'acknowledged' }),
      alert({}),
    ])
    expect(m.states.map((s) => s.label)).toEqual(TRIAGE_STATES.map((s) => s.label))
    expect(m.states.map((s) => s.value)).toEqual([1, 2, 1])
  })

  test('both link sets always sum to the total', () => {
    const m = buildTriageFlow([
      alert({}),
      alert({ source: 'dns', tags: ['attack.command-and-control'], status: 'acknowledged' }),
      alert({ source: 'dns', tags: ['attack.command-and-control'], status: 'closed' }),
      alert({ source: 'sysmon', tags: ['attack.persistence'] }),
    ])
    const sumST = m.sourceTactic.reduce((acc, l) => acc + l.value, 0)
    const sumTS = m.tacticState.reduce((acc, l) => acc + l.value, 0)
    expect(sumST).toBe(m.total)
    expect(sumTS).toBe(m.total)
  })

  test('orders sources and tactics by value desc, then label asc', () => {
    const m = buildTriageFlow([
      alert({ source: 'aaa', tags: ['attack.execution'] }),
      alert({ source: 'aaa', tags: ['attack.execution'] }),
      alert({ source: 'zzz', tags: ['attack.execution'] }),
      alert({ source: 'mmm', tags: ['attack.impact'] }),
    ])
    expect(m.sources.map((s) => [s.label, s.value])).toEqual([['aaa', 2], ['mmm', 1], ['zzz', 1]])
    expect(m.tactics.map((t) => [t.label, t.value])).toEqual([['Ejecución', 3], ['Impacto', 1]])
  })

  test('folds beyond maxSources into «Otras fuentes» placed last', () => {
    const alerts = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((source) => alert({ source }))
    const m = buildTriageFlow(alerts, { maxSources: 6 })
    expect(m.sources).toHaveLength(7)
    expect(m.foldedSources).toBe(2)
    const other = m.sources[m.sources.length - 1]
    expect(other.key).toBe('__other-source')
    expect(other.label).toBe(OTHER_SOURCE_LABEL)
    expect(other.value).toBe(2)
    // the folded alerts keep flowing: their ribbons leave the fold node
    expect(m.sourceTactic.some((l) => l.source === '__other-source' && l.value === 2)).toBe(true)
  })

  test('folds beyond maxTactics into «Otras tácticas» placed last', () => {
    const slugs = ['reconnaissance', 'execution', 'persistence', 'defense-evasion', 'credential-access', 'discovery', 'lateral-movement', 'impact']
    const alerts = slugs.map((s) => alert({ tags: [`attack.${s}`] }))
    const m = buildTriageFlow(alerts, { maxTactics: 6 })
    expect(m.tactics).toHaveLength(7)
    expect(m.foldedTactics).toBe(2)
    expect(m.tactics[m.tactics.length - 1].label).toBe(OTHER_TACTIC_LABEL)
    expect(m.tacticState.some((l) => l.source === '__other-tactic' && l.value === 2)).toBe(true)
  })

  test('no fold node when everything fits', () => {
    const m = buildTriageFlow([alert({}), alert({})], { maxSources: 6, maxTactics: 6 })
    expect(m.foldedSources).toBe(0)
    expect(m.foldedTactics).toBe(0)
    expect(m.sources).toHaveLength(1)
    expect(m.sources.some((s) => s.key === '__other-source')).toBe(false)
  })

  test('links never carry zero or negative values', () => {
    const m = buildTriageFlow([alert({})])
    expect(m.sourceTactic.every((l) => l.value > 0)).toBe(true)
    expect(m.tacticState.every((l) => l.value > 0)).toBe(true)
  })

  test('tactic node keys map to full ATT&CK labels for the table twin', () => {
    expect(triageTacticFullLabel({ key: 'command-and-control', label: 'C2' })).toBe('Mando y control')
    expect(triageTacticFullLabel({ key: '__sin-tactica', label: NO_TACTIC_LABEL })).toBe(NO_TACTIC_LABEL)
  })

  test('triples carry the exact unfolded rows for the table twin', () => {
    const m = buildTriageFlow([
      alert({ source: 'dns', tags: ['attack.command-and-control'] }),
      alert({ source: 'dns', tags: ['attack.command-and-control'] }),
      alert({ source: 'dns', tags: ['attack.command-and-control'], status: 'closed' }),
    ], { maxSources: 1 })
    expect(m.triples).toEqual([
      { source: 'dns', tactic: 'Mando y control', state: 'Nuevas', value: 2 },
      { source: 'dns', tactic: 'Mando y control', state: 'Cerradas', value: 1 },
    ])
    const sum = m.triples.reduce((acc, t) => acc + t.value, 0)
    expect(sum).toBe(m.total)
  })

  test('same input always produces the same model (determinism)', () => {
    const alerts = [
      alert({ source: 'b', tags: ['attack.execution'] }),
      alert({ source: 'a', tags: ['attack.execution'] }),
      alert({ source: 'a', tags: undefined }),
    ]
    const left = JSON.stringify(buildTriageFlow(alerts))
    const right = JSON.stringify(buildTriageFlow(alerts.slice().reverse()))
    expect(left).toBe(right)
  })
})
