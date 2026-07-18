import { createServer } from 'node:net'
import type { Server as SocketIOServer } from 'socket.io'

type SocketEmitter = Pick<SocketIOServer, 'emit'>
let cachedIO: SocketEmitter | null | undefined

// Lazily resolve the Socket.IO server. A static import of `server.ts` would
// Execute its module-level Fastify listen and MQTT startup every time a test
// Loads scheduler.ts. Resolve only when a transition needs to emit, and
// Degrade to a no-op when the socket server is not reachable.
export async function getSocketEmitter(): Promise<Pick<SocketIOServer, 'emit'> | null> {
  if (cachedIO !== undefined) {
    return cachedIO
  }
  cachedIO = null
  // Node's test runner can briefly observe the development server's port as
  // Free while its watcher is restarting; importing server.ts in that window
  // Would start a second listener and invoke its fatal EADDRINUSE path.
  if (process.env.NODE_TEST_CONTEXT || (process.argv.includes('--test') && !process.env.NODE_ENV)) {
    return null
  }
  // Probe whether the socket server's port (4000) is already taken. If it is,
  // Importing server.ts would trigger its module body, which calls
  // `fastify.listen({port: 4000})` and, on EADDRINUSE, calls `process.exit(1)`.
  // Skipping the import keeps the data path functional while degrading the
  // Socket emit to a silent no-op.
  if (await isPortBusy(4000)) {
    return null
  }
  try {
    const mod = (await import('../server.js')) as { io?: SocketEmitter }
    cachedIO = mod.io ?? null
  } catch {
    cachedIO = null
  }
  return cachedIO
}

async function isPortBusy(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const tester = createServer()
    tester.once('error', () => {
      tester.close(() => {})
      resolve(true)
    })
    tester.once('listening', () => {
      tester.close(() => resolve(false))
    })
    // Listening on 127.0.0.1 keeps the probe local; a server bound to
    // 0.0.0.0 still rejects this bind with EADDRINUSE.
    tester.listen(port, '127.0.0.1')
  })
}
