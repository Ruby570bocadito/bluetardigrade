import { expect, test } from 'bun:test'
import { io } from 'socket.io-client'
import { createHub } from './hub'

for (const transport of ['websocket', 'polling'] as const) {
  for (const [origin, allowed] of [['https://untrusted.example', false], ['http://localhost:3000', true], ['https://soc.example', true]] as const) {
    test(`${transport} handshake checks ${origin}`, async () => {
      const hub = createHub({ port: 0, quiet: true, engineApi: 'http://127.0.0.1:1', env: { CONSOLE_CORS_ORIGIN: 'https://soc.example' } })
      await hub.start()
      const socket = io(`http://127.0.0.1:${hub.address()!.port}`, {
        path: '/', transports: [transport], extraHeaders: { Origin: origin }, reconnection: false, autoConnect: false,
      })
      try {
        const result = new Promise<boolean>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('handshake timed out')), 3000)
          socket.on('console:snapshot', () => { clearTimeout(timer); resolve(true) })
          socket.on('connect_error', () => { clearTimeout(timer); resolve(false) })
        })
        socket.connect()
        expect(await result).toBe(allowed)
        expect(hub.state.clientsConnected).toBe(allowed ? 1 : 0)
      } finally {
        socket.close()
        await hub.stop()
      }
    })
  }
}
