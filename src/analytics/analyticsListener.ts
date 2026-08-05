import { bus } from '../lib/bus.js'
import type { WideEvent } from '../lib/wide.js'
import type { WideEventStore } from './WideEventStore.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('analytics:listener')

let honeycombKey: string | undefined
let honeycombDataset: string | undefined

export function startAnalyticsListener(store: WideEventStore): void {
  honeycombKey     = process.env.HONEYCOMB_API_KEY
  honeycombDataset = process.env.HONEYCOMB_DATASET

  async function handleWide(wide: WideEvent): Promise<void> {
    // 1. Persist to MongoDB
    try {
      await store.save(wide)
    } catch (err) {
      log.warn('failed to save wide event', { actumId: wide.actumId, err })
    }

    // 2. Forward to Honeycomb (optional)
    if (honeycombKey && honeycombDataset) {
      forwardToHoneycomb(wide).catch(err => {
        log.warn('honeycomb forward failed', { actumId: wide.actumId, err })
      })
    }
  }

  bus.on('actum.complete', handleWide)
  bus.on('actum.fail',     handleWide)
}

async function forwardToHoneycomb(wide: WideEvent): Promise<void> {
  if (!honeycombKey || !honeycombDataset) return

  const body = JSON.stringify([{
    time: wide.ts,
    data: {
      ...wide,
      // Convert bigint strings to numbers for Honeycomb's numeric columns
      reservation_eth: Number(wide.reservation) / 1e18,
      impetus_eth:     Number(wide.impetus)     / 1e18,
      refund_eth:      Number(wide.refund)      / 1e18,
    },
  }])

  await fetch(
    `https://api.honeycomb.io/1/batch/${encodeURIComponent(honeycombDataset)}`,
    {
      method:  'POST',
      headers: {
        'X-Honeycomb-Team': honeycombKey,
        'Content-Type':     'application/json',
      },
      body,
    }
  )
}
