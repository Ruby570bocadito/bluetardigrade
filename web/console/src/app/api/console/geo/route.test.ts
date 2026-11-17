import { afterEach, beforeEach, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { GET } from './route'

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_ACCESS_TOKEN'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const BASE = 'http://127.0.0.1:3000'

test('locates public IPv4 addresses and leaves the rest out', async () => {
  const res = await GET(new Request(`${BASE}/api/console/geo?ips=8.8.8.8,10.0.0.21,not-an-ip,8.8.8.8`))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { results: Record<string, { country: string } | null>; attribution: string }
  expect(body.results['8.8.8.8']?.country).toBe('US')
  expect(body.results['10.0.0.21']).toBeNull()
  expect(body.results['not-an-ip']).toBeNull()
  expect(Object.keys(body.results)).toHaveLength(3)
  expect(body.attribution).toContain('DB-IP')
})

test('refuses a batch larger than the map ever needs', async () => {
  const ips = Array.from({ length: 300 }, (_, i) => `8.8.${Math.floor(i / 256)}.${i % 256}`).join(',')
  expect((await GET(new Request(`${BASE}/api/console/geo?ips=${ips}`))).status).toBe(400)
})

test('it sits behind the access gate like every console API', async () => {
  process.env.CONSOLE_ACCESS_TOKEN = 'token-de-prueba-de-la-consola'
  const res = await proxy(new NextRequest(`${BASE}/api/console/geo?ips=8.8.8.8`))
  expect(res.status).toBe(401)
})
