import { expect, test } from 'bun:test'
import { DEFAULT_ME, describeAction, modeText, permissions } from './console-user'

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
