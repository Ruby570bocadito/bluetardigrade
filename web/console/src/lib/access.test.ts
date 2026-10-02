import { afterEach, expect, test } from 'bun:test'
import { authorized, basicPassword, tokenEquals } from './access'

const saved = process.env.CONSOLE_ACCESS_TOKEN
afterEach(() => {
  if (saved === undefined) delete process.env.CONSOLE_ACCESS_TOKEN
  else process.env.CONSOLE_ACCESS_TOKEN = saved
})

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

test('basicPassword parses the password, colons and UTF-8 included', () => {
  expect(basicPassword('Basic ' + b64('ana:s3:cr:et'))).toBe('s3:cr:et')
  expect(basicPassword('basic ' + b64(':contraseña'))).toBe('contraseña')
  expect(basicPassword(null)).toBeNull()
  expect(basicPassword('Bearer x')).toBeNull()
  expect(basicPassword('Basic ' + b64('sin-separador'))).toBeNull()
  expect(basicPassword('Basic %%%')).toBeNull()
})

test('tokenEquals compares content, not prefixes', async () => {
  expect(await tokenEquals('abc', 'abc')).toBe(true)
  expect(await tokenEquals('abc', 'abcd')).toBe(false)
  expect(await tokenEquals('', 'a')).toBe(false)
})

test('authorized is open without a token and gated with one', async () => {
  delete process.env.CONSOLE_ACCESS_TOKEN
  expect(await authorized(new Request('http://127.0.0.1:3000/'))).toBe(true)
  process.env.CONSOLE_ACCESS_TOKEN = 'tok'
  expect(await authorized(new Request('http://127.0.0.1:3000/'))).toBe(false)
  expect(await authorized(new Request('http://127.0.0.1:3000/', { headers: { authorization: 'Basic ' + b64('x:tok') } }))).toBe(true)
})
