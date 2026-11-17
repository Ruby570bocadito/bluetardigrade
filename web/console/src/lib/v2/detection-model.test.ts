import { describe, expect, test } from 'bun:test'
import type { RuleMeta, SfAlert, SfSequence, SfSuppression } from '@/lib/console-types'
import { parseQuery } from '@/lib/v2/investigate-model'
import {
  byActivity,
  chainRows,
  chainUses,
  detectionTabFromParam,
  draftFromTokens,
  draftYaml,
  filterRuleRows,
  matchedLines,
  parseTechniques,
  ruleIdFrom,
  ruleRows,
  ruleTopHosts,
  skeletonEvent,
  suppressionStates,
  v2DraftLink,
  v2RuleLink,
} from './detection-model'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const rule = (id: string, name: string, extra: Partial<RuleMeta> = {}): RuleMeta => ({
  id, name, description: '', severity: 'high', event_type: 'process.create', mitre: '', tactic: '', tags: [], conditions: [], ...extra,
})
const RULES: RuleMeta[] = [
  rule('ps-enc', 'PowerShell con comando codificado', { mitre: 'T1059.001', tactic: 'Execution', tags: ['attack.t1059.001', 'attack.execution'], conditions: [{ field: 'process.command_line', operator: 'icontains', value: '-enc' }] }),
  rule('lsass', 'Volcado de LSASS', { severity: 'critical', tags: ['attack.t1003.001', 'attack.credential-access'], conditions: [{ field: 'process.name', operator: 'iin', value: ['procdump.exe', 'rundll32.exe'] }] }),
  rule('vss', 'Borrado de instantáneas VSS', { severity: 'critical', tactic: 'Impact', event_type: 'process.create' }),
]
const alert = (id: string, ruleId: string, host: string, h: number): SfAlert => ({
  id, timestamp: ago(h), rule_id: ruleId, rule_name: ruleId, severity: 'high', host, event_id: `e${id}`, event_type: 'process.create', summary: '', matched_on: [],
})
const ALERTS: SfAlert[] = [
  alert('1', 'ps-enc', 'WS-014', 1),
  alert('2', 'ps-enc', 'WS-014', 2),
  alert('3', 'ps-enc', 'WS-022', 30),
  alert('4', 'lsass', 'SRV-DC01', 5),
  alert('5', 'chain-1', 'WS-014', 0.5),
]
const SEQ: SfSequence[] = [
  { id: 'chain-1', name: 'Campaña de intrusión', description: '', severity: 'critical', window_seconds: 900, tags: [], steps: ['PowerShell con comando codificado', 'lsass'], step_rules: [['ps-enc'], ['lsass', 'vss']] },
]
const SUP: SfSuppression[] = [
  { rule_id: 'ps-enc', host: 'WS-022', reason: 'copia nocturna', expires: ago(-48) },
  { rule_id: 'vss', reason: 'mantenimiento', expires: ago(2) },
  { rule_id: 'lsass', host: 'LAB', reason: 'laboratorio' },
]

describe('rules', () => {
  const rows = ruleRows(RULES, ALERTS, SEQ, SUP, NOW)

  test('alerts in memory, tactic from the rule or its tags, chains and suppressions', () => {
    const ps = rows[0]
    expect(ps).toMatchObject({ tactic: 'execution', alerts24h: 2, lastFired: ago(1), chains: ['Campaña de intrusión'] })
    expect(ps.week).toEqual([0, 0, 0, 0, 0, 1, 2])
    expect(ps.suppressions.map((s) => s.host)).toEqual(['WS-022'])
    expect(rows[1].tactic).toBe('credential-access')
    expect(rows[2]).toMatchObject({ tactic: 'impact', alerts24h: 0, lastFired: undefined, chains: ['Campaña de intrusión'] })
  })

  test('search by condition values, filters by severity and tactic, busiest first', () => {
    expect(filterRuleRows(rows, { q: 'procdump', sev: 'all', tactic: 'all' }).map((r) => r.rule.id)).toEqual(['lsass'])
    expect(filterRuleRows(rows, { q: 't1059', sev: 'all', tactic: 'all' }).map((r) => r.rule.id)).toEqual(['ps-enc'])
    expect(filterRuleRows(rows, { q: '', sev: 'critical', tactic: 'impact' }).map((r) => r.rule.id)).toEqual(['vss'])
    expect([...rows].sort(byActivity).map((r) => r.rule.id)).toEqual(['ps-enc', 'lsass', 'vss'])
    expect(ruleTopHosts(ALERTS, 'ps-enc')).toEqual([{ host: 'WS-014', count: 2 }, { host: 'WS-022', count: 1 }])
  })

  test('numeric condition values (a port written as a number in the YAML) do not break the search', () => {
    const port = rule('c2', 'Conexión al puerto 4444', { conditions: [{ field: 'network.destination_port', operator: 'eq', value: 4444 as unknown as string }] })
    const all = ruleRows([...RULES, port], [], [], [], NOW)
    expect(filterRuleRows(all, { q: '4444', sev: 'all', tactic: 'all' }).map((r) => r.rule.id)).toEqual(['c2'])
    expect(filterRuleRows(all, { q: 'zzz', sev: 'all', tactic: 'all' })).toEqual([])
  })

  test('a chain uses a rule named by id, by name or as an alternative', () => {
    expect(chainUses(SEQ[0], RULES[2])).toBe(true)
    expect(chainUses(SEQ[0], rule('x', 'otra'))).toBe(false)
  })
})

describe('chains and suppressions', () => {
  test('steps named by their rules, with alternatives, and the last completion', () => {
    const [c] = chainRows(SEQ, RULES, ALERTS)
    expect(c.steps).toEqual([
      { label: 'PowerShell con comando codificado', ruleId: 'ps-enc', ruleIds: ['ps-enc'], alternatives: [] },
      { label: 'Volcado de LSASS', ruleId: 'lsass', ruleIds: ['lsass', 'vss'], alternatives: [{ label: 'Borrado de instantáneas VSS', ruleId: 'vss' }] },
    ])
    expect(c).toMatchObject({ completions: 1, lastCompleted: ago(0.5) })
  })

  test('active first by time left, permanent ones without end, expired last', () => {
    const st = suppressionStates(SUP, RULES, NOW)
    expect(st.map((x) => [x.ruleName, x.expired, x.permanent])).toEqual([
      ['PowerShell con comando codificado', false, false],
      ['Volcado de LSASS', false, true],
      ['Borrado de instantáneas VSS', true, false],
    ])
    expect(Math.round(st[0].remainingMs! / 3_600_000)).toBe(48)
  })
})

describe('tester', () => {
  test('a starting event from the rule conditions: lists give their first value, ranges are joined, negations left out', () => {
    expect(skeletonEvent(RULES[1])).toEqual({ type: 'process.create', process: { name: 'procdump.exe' } })
    expect(
      skeletonEvent({
        event_type: 'network.connect',
        conditions: [
          { field: 'network.destination_port', operator: 'eq', value: '4444' },
          { field: 'process.image', operator: 'istartswith', value: 'C:\\Users\\' },
          { field: 'process.image', operator: 'iendswith', value: '.exe' },
          { field: 'process.name', operator: 'not_in', value: ['chrome.exe'] },
          { field: 'process.command_line', operator: 'regex', value: '.*' },
        ],
      }),
    ).toEqual({ type: 'network.connect', network: { destination_port: 4444 }, process: { image: 'C:\\Users\\.exe' } })
  })

  test('the lines holding the matched fields', () => {
    const json = JSON.stringify({ type: 'process.create', process: { name: 'powershell.exe', command_line: 'powershell -enc x' } }, null, 2)
    const lines = matchedLines(json, ['process.command_line'])
    expect([...lines].map((i) => json.split('\n')[i].trim())).toEqual(['"command_line": "powershell -enc x"'])
  })
})

describe('from a search to a rule', () => {
  test('tokens become conditions in the engine schema; what cannot be said is skipped', () => {
    const d = draftFromTokens(parseQuery('proceso:schtasks.exe linea:"/create" -usuario:SYSTEM padre:cmd.exe -linea:"/query" pid:4 destino:10.0.0.5:445'), 'process.create')
    expect(d.eventType).toBe('process.create')
    expect(d.conditions).toEqual([
      { field: 'process.name', operator: 'ieq', value: 'schtasks.exe' },
      { field: 'process.command_line', operator: 'icontains', value: '/create' },
      { field: 'user', operator: 'ineq', value: 'SYSTEM' },
      { field: 'enrichment.parent_name', operator: 'ieq', value: 'cmd.exe' },
      { field: 'network.destination_ip', operator: 'eq', value: '10.0.0.5' },
      { field: 'network.destination_port', operator: 'eq', value: 445 },
    ])
    expect(d.skipped.map((t) => t.value)).toEqual(['/query', '4'])
    expect(draftFromTokens(parseQuery('tipo:red puerto:443'), 'process.create').eventType).toBe('network.connect')
  })

  test('the YAML has the shape of the rule files', () => {
    const d = draftFromTokens(parseQuery('proceso:schtasks.exe linea:"/create"'), 'process.create')
    const yaml = draftYaml(d, { id: 'abc', name: 'Tarea programada creada', description: 'Crea una tarea', severity: 'medium', techniques: parseTechniques('T1053.005'), tactic: 'persistence' })
    expect(yaml).toBe(
      [
        '- name: "Tarea programada creada"',
        '  id: "abc"',
        '  description: >',
        '    Crea una tarea',
        '  severity: medium',
        '  event_type: process.create',
        '  conditions:',
        '    - field: process.name',
        '      operator: ieq',
        '      value: "schtasks.exe"',
        '    - field: process.command_line',
        '      operator: icontains',
        '      value: "/create"',
        '  actions:',
        '    - type: alert',
        '  tags: ["attack.t1053.005", "attack.persistence"]',
        '  enabled: true',
        '',
      ].join('\n'),
    )
    expect(parseTechniques('t1059, T1053.005 y T1059')).toEqual(['T1059', 'T1053.005'])
    expect(ruleIdFrom('Tarea programada creada desde un intérprete')).toBe('tarea-programada-creada-desde-un-interprete')
    expect(ruleIdFrom('¿?')).toBe('regla-nueva')
  })

  test('tabs and links', () => {
    expect(detectionTabFromParam('ruido')).toBe('ruido')
    expect(detectionTabFromParam('x')).toBe('reglas')
    expect(v2RuleLink('a b')).toBe('/v2/deteccion?regla=a%20b')
    expect(v2DraftLink('proceso:x')).toBe('/v2/deteccion?vista=borrador&q=proceso%3Ax')
  })
})
