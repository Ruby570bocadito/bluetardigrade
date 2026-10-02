import { expect, test } from 'bun:test'
import { io } from 'socket.io-client'
import { bindsBeyondLoopback, createHub, hubTokenMatches } from './hub'

function connect(port: number, auth?: Record<string, unknown>) {
  const socket = io(`http://127.0.0.1:${port}`, {
    path: '/', transports: ['websocket'], reconnection: false, autoConnect: false, auth,
  })
  const result = new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 3000)
    socket.on('console:snapshot', () => { clearTimeout(timer); resolve(true) })
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
