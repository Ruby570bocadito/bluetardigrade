import { expect, test } from 'bun:test'
import {
  addChronology,
  addEvidence,
  applyPlaybook,
  PLAYBOOK_TEMPLATES,
  parsePlaybookState,
  progressOf,
  readPlaybooks,
  removeChronology,
  removeEvidence,
  toggleCheck,
  upsertPlaybook,
  writePlaybooks,
  type IncidentPlaybookState,
} from './incident-playbook'

const NOW = '2026-10-05T17:30:00.000Z'
const CASE = '0123456789abcdef'
const ransomware = PLAYBOOK_TEMPLATES.find((t) => t.id === 'ransomware')!

function memory(items: Record<string, string> = {}): { store: Storage; get: () => Record<string, string> } {
  const bag: Record<string, string> = { ...items }
  return {
    store: {
      getItem: (k: string) => (k in bag ? bag[k] : null),
      setItem: (k: string, v: string) => {
        bag[k] = v
      },
      removeItem: (k: string) => {
        delete bag[k]
      },
      clear: () => {
        for (const k of Object.keys(bag)) delete bag[k]
      },
      key: () => null,
      get length() {
        return Object.keys(bag).length
      },
    } as Storage,
    get: () => bag,
  }
}

function seeded(): IncidentPlaybookState {
  let state = applyPlaybook(CASE, 'ransomware', NOW)
  state = toggleCheck(state, ransomware, 'alcance', NOW)
  return addEvidence(state, { kind: 'hash', label: 'SHA-256 del cifrador', detail: 'abc123', at: NOW })
}

test('the three templates are complete and unique', () => {
  expect(PLAYBOOK_TEMPLATES.map((t) => t.id)).toEqual(['ransomware', 'phishing', 'compromised-account'])
  for (const t of PLAYBOOK_TEMPLATES) {
    expect(t.items.length).toBeGreaterThanOrEqual(10)
    const ids = new Set(t.items.map((i) => i.id))
    expect(ids.size).toBe(t.items.length)
    for (const item of t.items) {
      expect(item.text.length).toBeLessThanOrEqual(1000)
      if (item.attack) expect(item.attack).toMatch(/^T\d{4}(?:\.\d{3})?$/)
    }
    expect(t.evidenceHints.length).toBeGreaterThanOrEqual(3)
  }
})

test('apply starts an empty plan and progress counts checked items only', () => {
  const state = applyPlaybook(CASE, 'ransomware', NOW)
  expect(state.templateId).toBe('ransomware')
  expect(state.checks).toEqual({})
  expect(progressOf(state, ransomware)).toEqual({ done: 0, total: ransomware.items.length })
  const checked = toggleCheck(state, ransomware, 'aislar', NOW)
  expect(progressOf(checked, ransomware)).toEqual({ done: 1, total: ransomware.items.length })
  const back = toggleCheck(checked, ransomware, 'aislar', NOW)
  expect(back.checks['aislar']).toBeUndefined()
})

test('toggling rejects items from another template or unknown ids', () => {
  const state = seeded()
  const phishing = PLAYBOOK_TEMPLATES.find((t) => t.id === 'phishing')!
  expect(() => toggleCheck(state, phishing, 'mensaje', NOW)).toThrow()
  expect(() => toggleCheck(state, ransomware, 'no-existe', NOW)).toThrow()
})

test('evidence is validated and removable', () => {
  const state = seeded()
  expect(state.evidence).toHaveLength(1)
  expect(() => addEvidence(state, { kind: 'virus', label: 'x', at: NOW })).toThrow()
  expect(() => addEvidence(state, { kind: 'note', label: '   ', at: NOW })).toThrow()
  expect(() => addEvidence(state, { kind: 'note', label: 'a\nb', at: NOW })).toThrow()
  expect(() => addEvidence(state, { kind: 'note', label: 'x'.repeat(201), at: NOW })).toThrow()
  const multi = addEvidence(state, { kind: 'note', label: 'volcado', detail: 'línea 1\nlínea 2', at: NOW })
  expect(multi.evidence[1].detail).toContain('\n')
  const gone = removeEvidence(multi, state.evidence[0].id, NOW)
  expect(gone.evidence).toHaveLength(1)
  expect(() => removeEvidence(state, 'no-existe', NOW)).toThrow()
})

test('chronology entries need a valid time and are removable', () => {
  const state = seeded()
  const withHito = addChronology(state, { at: '2026-10-04T10:00:00Z', text: 'Primer cifrado observado' }, NOW)
  expect(withHito.chronology).toHaveLength(1)
  expect(withHito.updatedAt).toBe(NOW)
  expect(() => addChronology(state, { at: 'no-es-fecha', text: 'x' }, NOW)).toThrow()
  expect(() => addChronology(state, { at: NOW, text: '' }, NOW)).toThrow()
  const gone = removeChronology(withHito, withHito.chronology[0].id, NOW)
  expect(gone.chronology).toHaveLength(0)
})

test('storage round-trips and drops incompatible entries one by one', () => {
  const { store, get } = memory()
  writePlaybooks(store, { [CASE]: seeded() })
  const raw = JSON.parse(get()['bluetardigrade.incident-playbooks.v1'])
  expect(raw.version).toBe(1)
  const read = readPlaybooks(store)
  expect(read[CASE].templateId).toBe('ransomware')
  expect(read[CASE].checks['alcance'].done).toBe(true)

  raw.cases['deadbeefdeadbeef'] = { incidentId: 'deadbeefdeadbeef', templateId: 'desconocida' }
  raw.cases['otro'] = { incidentId: 'otro', templateId: 'phishing', appliedAt: NOW, updatedAt: NOW, checks: {}, evidence: [], chronology: [] }
  get()['bluetardigrade.incident-playbooks.v1'] = JSON.stringify(raw)
  const mixed = readPlaybooks(store)
  expect(Object.keys(mixed).sort()).toEqual([CASE, 'otro'])
  expect(mixed['otro'].templateId).toBe('phishing')
})

test('reading tolerates broken JSON being an error the caller shows', () => {
  const { store } = memory({ 'bluetardigrade.incident-playbooks.v1': '{no-json' })
  expect(() => readPlaybooks(store)).toThrow()
  const empty = memory({ 'bluetardigrade.incident-playbooks.v1': '' })
  // empty string reads as absent
  expect(readPlaybooks(empty.store)).toEqual({})
})

test('write evicts the least recently updated beyond the cap', () => {
  const { store } = memory()
  const cases: Record<string, IncidentPlaybookState> = {}
  for (let i = 0; i < 42; i++) {
    const id = i.toString(16).padStart(32, '0')
    cases[id] = applyPlaybook(id, 'phishing', new Date(Date.parse(NOW) + i * 1000).toISOString())
  }
  writePlaybooks(store, cases)
  const kept = readPlaybooks(store)
  expect(Object.keys(kept)).toHaveLength(40)
  expect(kept[idFor(0)]).toBeUndefined()
  expect(kept[idFor(41)]).toBeDefined()
})

function idFor(i: number): string {
  return i.toString(16).padStart(32, '0')
}

test('parsePlaybookState normalizes and skips bad rows inside a case', () => {
  const state = parsePlaybookState({
    incidentId: CASE,
    templateId: 'phishing',
    appliedAt: NOW,
    updatedAt: NOW,
    checks: { mensaje: { done: true, at: NOW }, raro: 'no-es-objeto', pendiente: { done: false, at: NOW } },
    evidence: [{ id: 'a'.repeat(32), kind: 'url', label: 'enlace', at: NOW }, { id: 'malo', kind: 'otro', label: 'x', at: NOW }],
    chronology: [{ id: 'b'.repeat(32), at: NOW, text: 'hito' }, 'no-es-objeto'],
  })
  expect(state.checks).toEqual({ mensaje: { done: true, at: NOW } })
  expect(state.evidence).toHaveLength(1)
  expect(state.chronology).toHaveLength(1)
  expect(() => parsePlaybookState({ incidentId: CASE, templateId: 'ransomware' })).toThrow()
  expect(() => parsePlaybookState({ ...seeded(), incidentId: 'con\u202ebidi' })).toThrow()
})

test('upsert revalidates and keys by the state incident id', () => {
  const state = seeded()
  const cases = upsertPlaybook({}, state)
  expect(cases[CASE].templateId).toBe('ransomware')
  expect(upsertPlaybook(cases, applyPlaybook('f'.repeat(32), 'ransomware', NOW))['f'.repeat(32)]).toBeDefined()
})
