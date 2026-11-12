import { beforeEach, expect, test } from 'bun:test'
import { principalFor } from './access'
import {
  TOKEN_FAIL_LIMIT, TOKEN_FAIL_WINDOW_MS, TOKEN_GLOBAL_FAIL_LIMIT, clientAddress, resetTokenAttempts, tokenAttemptAllowed, tokenAttemptFailed,
  tokenAttemptSucceeded,
} from './attempts'

beforeEach(() => resetTokenAttempts())

const from = (xff?: string) => new Request('http://127.0.0.1:3000/', { headers: xff === undefined ? {} : { 'x-forwarded-for': xff } })

test('the client is the first forwarded hop; anything odd shares one bucket', () => {
  expect(clientAddress(from('203.0.113.7'))).toBe('203.0.113.7')
  expect(clientAddress(from(' 203.0.113.7 , 10.0.0.1'))).toBe('203.0.113.7')
  expect(clientAddress(from('2001:DB8::1'))).toBe('2001:db8::1')
  for (const odd of [undefined, '', 'x'.repeat(65), '<script>', 'a b']) expect(clientAddress(from(odd))).toBe('unknown')
})

test('a client is refused after the limit, for the window, and others are not', () => {
  const t0 = 1_000_000
  for (let i = 0; i < TOKEN_FAIL_LIMIT; i++) {
    expect(tokenAttemptAllowed('a', t0)).toBe(true)
    tokenAttemptFailed('a', t0)
  }
  expect(tokenAttemptAllowed('a', t0 + 1000)).toBe(false)
  expect(tokenAttemptAllowed('b', t0 + 1000)).toBe(true)
  expect(tokenAttemptAllowed('a', t0 + TOKEN_FAIL_WINDOW_MS)).toBe(true)
})

test('a correct token clears the client count, not the global one', () => {
  const t0 = 1_000_000
  for (let i = 0; i < TOKEN_FAIL_LIMIT - 1; i++) tokenAttemptFailed('a', t0)
  tokenAttemptSucceeded('a')
  tokenAttemptFailed('a', t0)
  expect(tokenAttemptAllowed('a', t0)).toBe(true)
})

test('rotating the address stops at the global ceiling', () => {
  const t0 = 1_000_000
  for (let i = 0; i < TOKEN_GLOBAL_FAIL_LIMIT; i++) {
    expect(tokenAttemptAllowed(`10.0.${i >> 8}.${i & 255}`, t0)).toBe(true)
    tokenAttemptFailed(`10.0.${i >> 8}.${i & 255}`, t0)
  }
  // an address never seen before is refused too
  expect(tokenAttemptAllowed('198.51.100.1', t0 + 1000)).toBe(false)
  expect(tokenAttemptAllowed('198.51.100.1', t0 + TOKEN_FAIL_WINDOW_MS)).toBe(true)
})

test('the counters are shared across bundles through globalThis', () => {
  tokenAttemptFailed('a')
  const shared = globalThis as { __sfConsoleTokenAttempts?: { clients: Map<string, unknown> } }
  expect(shared.__sfConsoleTokenAttempts?.clients.has('a')).toBe(true)
})

test('HTTP Basic with the shared token is limited, and a request without credentials is not an attempt', async () => {
  const saved = { token: process.env.CONSOLE_ACCESS_TOKEN, users: process.env.CONSOLE_USERS_FILE }
  delete process.env.CONSOLE_USERS_FILE
  process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
  const basic = (password: string, xff = '203.0.113.7') =>
    new Request('http://127.0.0.1:3000/', { headers: { authorization: 'Basic ' + btoa('x:' + password), 'x-forwarded-for': xff } })
  try {
    for (let i = 0; i < 50; i++) expect(await principalFor(from('203.0.113.7'))).toBeNull()
    expect((await principalFor(basic('console-secret')))?.role).toBe('admin')
    for (let i = 0; i < TOKEN_FAIL_LIMIT; i++) expect(await principalFor(basic(`guess-${i}`))).toBeNull()
    // the right token is refused too while the client is limited
    expect(await principalFor(basic('console-secret'))).toBeNull()
    expect((await principalFor(basic('console-secret', '203.0.113.8')))?.role).toBe('admin')
  } finally {
    for (const [k, v] of [['CONSOLE_ACCESS_TOKEN', saved.token], ['CONSOLE_USERS_FILE', saved.users]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})
