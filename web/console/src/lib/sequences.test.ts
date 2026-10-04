import { expect, test } from 'bun:test'
import type { SfSequence } from './console-types'
import { scopeText, stepAlternatives, stepStatus, unarmedSteps } from './sequences'

const plain: SfSequence = { id: 's1', name: 'Plain', description: '', severity: 'high', window_seconds: 600, tags: [], steps: ['A', 'B'] }
const lateral: SfSequence = {
  ...plain,
  id: 's2',
  steps: ['Mimikatz | LSASS', 'PsExec | WMI'],
  step_rules: [['Mimikatz', 'LSASS'], ['PsExec', 'WMI']],
  scope: 'user',
  min_hosts: 2,
}

test('older engines without step_rules: each step is its own rule', () => {
  expect(stepAlternatives(plain, 1)).toEqual(['B'])
  expect(scopeText(plain)).toBe('mismo equipo')
})

test('alternatives complete a step and add up their hits', () => {
  const live = new Set(['LSASS', 'PsExec', 'WMI'])
  const hits = new Map([['LSASS', 2], ['WMI', 1], ['PsExec', 3]])
  expect(stepStatus(lateral, 0, live, hits)).toEqual({ rules: ['Mimikatz', 'LSASS'], loaded: ['LSASS'], hits: 2 })
  expect(stepStatus(lateral, 1, live, hits).hits).toBe(4)
  expect(unarmedSteps(lateral, live)).toEqual([])
  expect(unarmedSteps(lateral, new Set(['PsExec']))).toEqual([0])
  expect(unarmedSteps(plain, new Set(['A']))).toEqual([1])
})

test('scope reads as the operator would say it', () => {
  expect(scopeText(lateral)).toBe('misma cuenta en 2 equipos o más')
  expect(scopeText({ ...lateral, min_hosts: 1 })).toBe('misma cuenta')
})
