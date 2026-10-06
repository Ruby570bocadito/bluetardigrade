import { afterEach, describe, expect, test } from 'bun:test'
import {
  detectedShare,
  fetchScenarioSurface,
  normalizeTechnique,
  passRatePercent,
  scenarioCountsByTactic,
  scenarioTacticSlugs,
  scenariosForTactic,
  techniqueCovers,
  type ScenarioRun,
  type ScenarioView,
} from './simulation'
import type { RuleMeta, SfSequence } from './console-types'

const realFetch = globalThis.fetch
let sent: { url: string; init: RequestInit }[] = []

function respond(status: number, body: string) {
  sent = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const RULES: RuleMeta[] = [
  { id: 'soc-lsass', name: 'LSASS', description: '', severity: 'high', event_type: 'process.access', mitre: 'T1003', tactic: 'credential-access', tags: [], conditions: [] },
  { id: 'soc-smb', name: 'SMB', description: '', severity: 'medium', event_type: 'network.connect', mitre: 'T1021.002', tactic: 'lateral-movement', tags: [], conditions: [] },
  { id: 'soc-psexec', name: 'PsExec', description: '', severity: 'high', event_type: 'process.create', mitre: 'T1569.002', tactic: 'execution', tags: [], conditions: [] },
]

const SEQUENCES: SfSequence[] = [
  { id: 'seq-lateral', name: 'Lateral', description: '', severity: 'critical', window_seconds: 600, tags: [], steps: ['soc-smb', 'soc-psexec'] },
]

const SCENARIOS: ScenarioView[] = [
  { id: 'sim-lsass', name: 'LSASS', description: '', attack: ['t1003.001'], host: 'LAB-SIM-A', events: 4, expected: [{ rule: 'soc-lsass', min: 1 }], origin: 'a.yaml' },
  { id: 'sim-smb', name: 'SMB', description: '', attack: ['t1021.002'], host: 'LAB-SIM-B', events: 3, expected: [{ rule: 'seq-lateral', min: 1 }], origin: 'b.yaml' },
  { id: 'sim-unplaced', name: 'Unplaced', description: '', attack: ['t1486'], host: 'LAB-SIM-C', events: 2, expected: [{ rule: 'soc-missing-rule', min: 1 }], origin: 'c.yaml' },
]

describe('scenario surface', () => {
  test('an unarmed engine (501) surfaces the arming hint, never a fake battery', async () => {
    respond(501, '{"error":"scenario validation is not armed: start the engine with -scenarios <dir>"}')
    const surface = await fetchScenarioSurface()
    expect(surface).toEqual({ state: 'unarmed', hint: 'scenario validation is not armed: start the engine with -scenarios <dir>' })
    expect(sent[0].url).toBe('/api/engine/api/scenarios')
  })

  test('other errors collapse to unavailable and an armed library passes through', async () => {
    respond(500, '{"error":"scenario dir broken"}')
    expect((await fetchScenarioSurface()).state).toBe('unavailable')
    respond(200, '{"armed":true,"dir":"/lab/scenarios","count":1,"scenarios":[]}')
    const armed = await fetchScenarioSurface()
    expect(armed.state).toBe('armed')
    if (armed.state === 'armed') expect(armed.library.dir).toBe('/lab/scenarios')
  })

  test('the launch POST carries only the chosen scenarios', async () => {
    respond(202, '{"run_id":"run-abc","status":"running","total":1,"detected":0,"missing":0,"catalog_errors":0,"errors":0,"duration_ms":0,"pass_rate":0,"started_at":"2026-10-05T10:00:00Z"}')
    const launch = await (await import('./simulation')).launchScenarioRun(['sim-lsass'])
    expect(launch.ok).toBe(true)
    expect(sent[0].url).toBe('/api/engine/api/scenarios/run')
    expect(sent[0].init.method).toBe('POST')
    expect(JSON.parse(String(sent[0].init.body))).toEqual({ only: ['sim-lsass'] })
  })
})

describe('technique normalization and tactic mapping (SIM-3)', () => {
  test('technique ids normalize to the uppercase T-form and reject garbage', () => {
    expect(normalizeTechnique('t1003.001')).toBe('T1003.001')
    expect(normalizeTechnique(' T1595 ')).toBe('T1595')
    expect(normalizeTechnique('attack.t1003')).toBe('')
    expect(normalizeTechnique('lsass')).toBe('')
    expect(normalizeTechnique('T12345')).toBe('')
  })

  test('a sub-technique is covered by its parent technique', () => {
    expect(techniqueCovers('T1003', 't1003.001')).toBe(true)
    expect(techniqueCovers('T1003.001', 'T1003')).toBe(false)
    expect(techniqueCovers('T1021.002', 'T1021.002')).toBe(true)
    expect(techniqueCovers('T1003', 'T1005')).toBe(false)
  })

  test('scenarios map to tactics through expected rules, sequence steps and technique fallback', () => {
    const direct = scenarioTacticSlugs(SCENARIOS[0], RULES, SEQUENCES)
    expect([...direct]).toEqual(['credential-access'])
    const viaSequence = scenarioTacticSlugs(SCENARIOS[1], RULES, SEQUENCES)
    expect([...viaSequence].sort()).toEqual(['execution', 'lateral-movement'])
    const unplaced = scenarioTacticSlugs(SCENARIOS[2], RULES, SEQUENCES)
    expect(unplaced.size).toBe(0)
  })

  test('counts and tactic lookups stay deterministic and never guess unplaced scenarios', () => {
    const counts = scenarioCountsByTactic(SCENARIOS, RULES, SEQUENCES)
    expect(counts.get('credential-access')).toBe(1)
    expect(counts.get('execution')).toBe(1)
    expect(counts.get('lateral-movement')).toBe(1)
    expect(counts.get('impact')).toBeUndefined()
    expect(scenariosForTactic('credential-access', SCENARIOS, RULES, SEQUENCES).map((s) => s.id)).toEqual(['sim-lsass'])
    expect(scenariosForTactic('impact', SCENARIOS, RULES, SEQUENCES)).toEqual([])
  })
})

describe('run formatting', () => {
  test('pass rate renders as a rounded percent', () => {
    expect(passRatePercent(0.8571)).toBe('86 %')
    expect(passRatePercent(0)).toBe('0 %')
    expect(passRatePercent(1)).toBe('100 %')
  })

  test('the detected share excludes catalog authoring errors from the denominator', () => {
    const run: ScenarioRun = { run_id: 'r', started_at: 'x', status: 'completed', total: 10, detected: 8, missing: 1, catalog_errors: 1, errors: 0, duration_ms: 5, pass_rate: 0.8 }
    expect(detectedShare(run)).toBe('89 %')
    expect(detectedShare({ ...run, total: 1, detected: 0, catalog_errors: 1 })).toBe('—')
  })
})
