import { afterEach, beforeEach, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { LOGO_BODY } from '@/lib/brand-logo'
import { GET as loginPage } from './route'

// The sign-in page shares the command center's look (palette and mark)
// and still runs no code, frames nothing and refuses to be framed.

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_ACCESS_TOKEN'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.CONSOLE_ACCESS_TOKEN = 'token-de-prueba-de-la-consola'
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test('the sign-in page draws the bluetardigrade mark, runs no script and frames nothing', async () => {
  const res = await loginPage(new Request('http://127.0.0.1:3000/login'))
  const html = await res.text()
  expect(html).toContain(LOGO_BODY)
  expect(html).toContain('Centro de mando')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('<iframe')
  // no look cookie any more: one look for everyone
  expect(res.headers.get('set-cookie') ?? '').not.toContain('bt-look')
})

test('nobody may frame the sign-in page', async () => {
  const res = await proxy(new NextRequest('http://127.0.0.1:3000/login', { headers: { accept: 'text/html' } }))
  expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
})
