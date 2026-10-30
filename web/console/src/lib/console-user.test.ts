import { expect, test } from 'bun:test'
import { DEFAULT_ME, PENDING_ME, describeAction, modeText, permissions, scopeText } from './console-user'

test('audit actions are described in words, unknown ones verbatim', () => {
  expect(describeAction({ method: 'POST', path: '/api/alerts/0123456789abcdef/status' })).toBe('Triaje de alerta')
  expect(describeAction({ method: 'PATCH', path: '/api/incidents/0123456789abcdef' })).toBe('Cambio en incidente')
  expect(describeAction({ method: 'POST', path: '/api/respond/kill' })).toBe('Respuesta: terminar proceso')
  expect(describeAction({ method: 'PUT', path: '/api/otra' })).toBe('PUT /api/otra')
})

test('permissions follow the role flags', () => {
  const viewer = { ...DEFAULT_ME, name: 'luis', role: 'viewer' as const, mode: 'users' as const, can_triage: false, can_respond: false }
  const allowed = permissions(viewer).filter((p) => p.allowed).map((p) => p.label)
  expect(allowed).toEqual(['Ver alertas, eventos, equipos e informes', 'Probar reglas (sin cambiar nada)'])
  expect(permissions(DEFAULT_ME).every((p) => p.allowed)).toBe(true)
  expect(modeText(viewer)).toContain('CONSOLE_USERS_FILE')
  expect(modeText(DEFAULT_ME)).toContain('loopback')
})

test('the session panel says which machines the account sees', () => {
  expect(scopeText(DEFAULT_ME)).toBe('Ves todos los equipos.')
  expect(scopeText({ ...DEFAULT_ME, scope: null })).toBe('Ves todos los equipos.')
  expect(scopeText({ ...DEFAULT_ME, role: 'analyst', mode: 'users', scope: ['madrid'] })).toStartWith('Ves solo los equipos del grupo madrid:')
  expect(scopeText({ ...DEFAULT_ME, role: 'viewer', mode: 'users', scope: ['madrid', 'servidores'] })).toStartWith('Ves solo los equipos de los grupos madrid, servidores:')
})

test('before /api/console/me answers the session grants nothing', () => {
  expect(PENDING_ME.pending).toBe(true)
  expect(PENDING_ME.can_triage || PENDING_ME.can_respond).toBe(false)
  expect(permissions(PENDING_ME).filter((p) => p.allowed).map((p) => p.label)).toEqual(['Ver alertas, eventos, equipos e informes', 'Probar reglas (sin cambiar nada)'])
  expect(DEFAULT_ME.pending).toBeUndefined()
})
