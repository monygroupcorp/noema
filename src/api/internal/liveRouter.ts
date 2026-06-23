import { Router } from 'express'
import { bus } from '../../lib/bus.js'

export function createLiveRouter(secret?: string): Router {
  const router = Router()

  router.get('/live', (req, res) => {
    // Auth — skip if INTERNAL_SECRET not configured (dev mode)
    if (secret) {
      const provided = req.headers['x-internal-secret'] ?? req.query.token
      if (provided !== secret) {
        res.status(401).json({ error: 'unauthorized' })
        return
      }
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // Send heartbeat every 15s to prevent proxy timeouts
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n')
    }, 15_000)

    function sendEvent(name: string, data: unknown): void {
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const onLog        = (entry: unknown)  => sendEvent('log',              entry)
    const onStart      = (data: unknown)   => sendEvent('actum.start',      data)
    const onProgressus = (data: unknown)   => sendEvent('actum.progressus', data)
    const onComplete   = (wide: unknown)   => sendEvent('actum.complete',   wide)
    const onFail       = (wide: unknown)   => sendEvent('actum.fail',       wide)

    bus.on('log',              onLog        as Parameters<typeof bus.on>[1])
    bus.on('actum.start',      onStart      as Parameters<typeof bus.on>[1])
    bus.on('actum.progressus', onProgressus as Parameters<typeof bus.on>[1])
    bus.on('actum.complete',   onComplete   as Parameters<typeof bus.on>[1])
    bus.on('actum.fail',       onFail       as Parameters<typeof bus.on>[1])

    req.on('close', () => {
      clearInterval(heartbeat)
      bus.off('log',              onLog        as Parameters<typeof bus.on>[1])
      bus.off('actum.start',      onStart      as Parameters<typeof bus.on>[1])
      bus.off('actum.progressus', onProgressus as Parameters<typeof bus.on>[1])
      bus.off('actum.complete',   onComplete   as Parameters<typeof bus.on>[1])
      bus.off('actum.fail',       onFail       as Parameters<typeof bus.on>[1])
    })
  })

  return router
}
