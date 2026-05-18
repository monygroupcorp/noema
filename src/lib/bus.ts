import { EventEmitter } from 'node:events'
import type { LogEntry } from './logger.js'
import type { WideEvent } from './wide.js'

// Typed event map — extended in Phase 2 with actum lifecycle events
export interface BusEvents {
  'log':             [entry: LogEntry]
  'actum.start':     [data: { actumId: string; modusId: string; animaId?: string }]
  'actum.stage':     [data: { actumId: string; stage: string; elapsedMs: number }]
  'actum.complete':  [wide: WideEvent]
  'actum.fail':      [wide: WideEvent]
}

class TypedBus extends EventEmitter {
  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): boolean {
    return super.emit(event, ...args)
  }
  on<K extends keyof BusEvents>(event: K, listener: (...args: BusEvents[K]) => void): this {
    return super.on(event, listener)
  }
}

export const bus = new TypedBus()
