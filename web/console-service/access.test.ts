import { expect, test } from 'bun:test'
import { io } from 'socket.io-client'
import { bindsBeyondLoopback, createHub, hubTokenMatches } from './hub'

function connect(port: number, auth?: Record<string, unknown>) {
  const socket = io(`http://127.0.0.1:${port}`, {
    path: '/', transports: ['websocket'], reconnection: false, autoConnect: false, auth,
  })
  const result = new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 3000)
    socket.on('connect', () => { clearTimeout(timer); resolve(true) })
    socket.on('connect_error', () => { clearTimeout(timer); resolve(false) })
  })
  socket.connect()
  return { socket, result }
}

test('HUB_ACCESS_TOKEN gates every socket, Origin-less clients included', async () => {
  const hub = createHub({ port: 0, quiet: true, engineApi: 'http://127.0.0.1:1', env: { HUB_ACCESS_TOKEN: 'hub-secret' } })
  await hub.start()
  const port = hub.address()!.port
  try {
    for (const auth of [undefined, { token: 'wrong' }, { token: 42 }]) {
      const { socket, result } = connect(port, auth)
      expect(await result).toBe(false)
      socket.close()
    }
    const { socket, result } = connect(port, { token: 'hub-secret' })
    expect(await result).toBe(true)
    socket.close()
  } finally {
    await hub.stop()
  }
})

test('a hub bound beyond loopback refuses to start without a token', async () => {
  const hub = createHub({ port: 0, host: '0.0.0.0', quiet: true, engineApi: 'http://127.0.0.1:1', env: {} })
  await expect(hub.start()).rejects.toThrow('HUB_ACCESS_TOKEN')
  const declared = createHub({ port: 0, host: '0.0.0.0', quiet: true, engineApi: 'http://127.0.0.1:1', env: { HUB_ALLOW_UNAUTHENTICATED: '1' } })
  await declared.start()
  await declared.stop()
})

test('loopback detection and token comparison', () => {
  for (const h of ['127.0.0.1', '::1', '[::1]', 'localhost', 'LOCALHOST']) expect(bindsBeyondLoopback(h)).toBe(false)
  for (const h of ['0.0.0.0', '::', '192.168.1.10', 'soc.lab']) expect(bindsBeyondLoopback(h)).toBe(true)
  expect(hubTokenMatches('a', 'a')).toBe(true)
  expect(hubTokenMatches('a', 'ab')).toBe(false)
  expect(hubTokenMatches(undefined, 'a')).toBe(false)
})

test('with a token the status surface needs it and /health answers liveness only', async () => {
  const env = { HUB_ACCESS_TOKEN: 'hub-secret', ANALYST_BASE_URL: 'http://provider.internal/v1', ANALYST_API_KEY: 'k', ANALYST_MODEL: 'private-model', CONSOLE_CORS_ORIGIN: 'https://soc.internal' }
  const hub = createHub({ port: 0, quiet: true, engineApi: 'http://127.0.0.1:1', env })
  await hub.start()
  const base = `http://127.0.0.1:${hub.address()!.port}`
  try {
    for (const headers of [undefined, { authorization: 'Bearer wrong' }, { authorization: 'Basic aHViLXNlY3JldA==' }]) {
      const health = await fetch(`${base}/health`, { headers })
      expect(health.status).toBe(200)
      const text = await health.text()
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(['service', 'status'])
      for (const secret of ['provider.internal', 'private-model', 'soc.internal', '127.0.0.1:1']) expect(text).not.toContain(secret)
      const page = await fetch(`${base}/`, { headers: { accept: 'text/html', ...headers } })
      expect(page.status).toBe(401)
      expect(page.headers.get('www-authenticate')).toBe('Bearer')
      expect(await page.text()).not.toContain('private-model')
    }
    const auth = { authorization: 'Bearer hub-secret' }
    const full = (await (await fetch(`${base}/healthz`, { headers: auth })).json()) as Record<string, any>
    expect(full.analyst.model).toBe('private-model')
    expect(full.engine.endpoint).toBeDefined()
    const page = await fetch(`${base}/`, { headers: { accept: 'text/html', ...auth } })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('private-model')
  } finally {
    await hub.stop()
  }
})
