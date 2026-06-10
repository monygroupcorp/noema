// =============================================================================
// RunEventHub — subscribes to the bus and fans out per-run.
// =============================================================================

import { busToRunEvent, type RunEvent } from './runEvents.js'

export interface BusLike {
  on(event: string, listener: (...args: any[]) => void): unknown
}

export interface RunEventHubDeps {
  bus: BusLike
  postWebhook: (url: string, body: unknown) => Promise<void>
  bufferSize?: number
}

const CLEANUP_DELAY_MS = 30_000

export class RunEventHub {
  private readonly postWebhook: (url: string, body: unknown) => Promise<void>
  private readonly bufferSize: number

  private readonly subscribers = new Map<string, Set<(ev: RunEvent) => void>>()
  private readonly webhooks = new Map<string, string>()
  private readonly recent = new Map<string, RunEvent[]>()

  constructor(deps: RunEventHubDeps) {
    this.postWebhook = deps.postWebhook
    this.bufferSize = deps.bufferSize ?? 50

    for (const name of ['actum.stage', 'actum.complete', 'actum.fail'] as const) {
      deps.bus.on(name, (payload: unknown) => this._ingest(name, payload))
    }
  }

  _ingest(name: string, payload: unknown): void {
    const ev = busToRunEvent(name, payload)
    if (!ev) return

    // Buffer
    const buf = this.recent.get(ev.runId) ?? []
    buf.push(ev)
    if (buf.length > this.bufferSize) buf.splice(0, buf.length - this.bufferSize)
    this.recent.set(ev.runId, buf)

    // Notify subscribers
    const subs = this.subscribers.get(ev.runId)
    if (subs) {
      for (const cb of subs) {
        try { cb(ev) } catch { /* drop */ }
      }
    }

    // Webhook + deferred cleanup on terminal events
    if (ev.terminal) {
      const webhookUrl = this.webhooks.get(ev.runId)
      if (webhookUrl) {
        void this.postWebhook(webhookUrl, ev).catch(() => {})
      }
      // unref so the timer never keeps the process/test event loop alive. (A run that
      // never emits a terminal event leaks its maps until the actum-expiry reaper
      // fails it — bounded, and acceptable for in-process single-instance state.)
      setTimeout(() => {
        this.webhooks.delete(ev.runId)
        this.recent.delete(ev.runId)
        this.subscribers.delete(ev.runId)
      }, CLEANUP_DELAY_MS).unref?.()
    }
  }

  subscribe(runId: string, cb: (ev: RunEvent) => void): () => void {
    let subs = this.subscribers.get(runId)
    if (!subs) {
      subs = new Set()
      this.subscribers.set(runId, subs)
    }
    subs.add(cb)
    return () => {
      subs!.delete(cb)
      if (subs!.size === 0) this.subscribers.delete(runId)
    }
  }

  setWebhook(runId: string, url: string): void {
    this.webhooks.set(runId, url)
  }

  recentFor(runId: string): RunEvent[] {
    return [...(this.recent.get(runId) ?? [])]
  }
}
