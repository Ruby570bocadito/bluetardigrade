import { expect, test } from 'bun:test'
import { io, type Socket } from 'socket.io-client'
import { createHub } from './hub'

test('reconnecting cannot reset the hub analyst budget', async () => {
  let calls = 0
  const provider = Bun.serve({ port: 0, fetch() {
    calls++
    return Response.json({ choices: [{ message: { content: 'fixture' } }] })
  } })
  const settings = { ANALYST_BASE_URL: `${provider.url.origin}/v1`, ANALYST_API_KEY: 'fixture-key', ANALYST_MODEL: 'fixture-model' }
  const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]))
  Object.assign(process.env, settings)
  const hub = createHub({ port: 0, quiet: true, engineApi: 'http://127.0.0.1:1' })
  const sockets: Socket[] = []
  try {
    await hub.start()
    for (let i = 0; i < 11; i++) {
      const socket = io(`http://127.0.0.1:${hub.address()!.port}`, { path: '/', transports: ['websocket'], autoConnect: false, reconnection: false })
      sockets.push(socket)
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('connect_error', reject)
        socket.connect()
      })
      const result = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('analyst timeout')), 2000)
        socket.once('analyst:done', () => { clearTimeout(timer); resolve('done') })
        socket.once('analyst:error', (error: { message: string }) => { clearTimeout(timer); resolve(error.message) })
      })
      socket.emit('analyst:ask', { alert: { rule_id: 'fixture', host: 'FIXTURE' } })
      if (i < 10) expect(await result).toBe('done')
      else expect(await result).toContain('Limite global')
      socket.close()
    }
    expect(calls).toBe(10)
  } finally {
    for (const socket of sockets) socket.close()
    await hub.stop()
    provider.stop(true)
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
