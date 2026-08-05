import type { Nexus as NexusInterface, SignumEventType, SignumEvent, SignumHook } from '../types/nexus.js'
import type { Signum } from '../types/significandi.js'

type SignaEntry = Omit<Signum, 'id' | 'natum' | 'status'>

export class Nexus implements NexusInterface {
  private readonly hooks = new Map<SignumEventType, Array<SignumHook<SignumEventType>>>()

  on<T extends SignumEventType>(type: T, hook: SignumHook<T>): void {
    if (!this.hooks.has(type)) this.hooks.set(type, [])
    this.hooks.get(type)!.push(hook as SignumHook<SignumEventType>)
  }

  async emit<T extends SignumEventType>(event: SignumEvent<T>): Promise<SignaEntry[]> {
    const hooks = this.hooks.get(event.type) ?? []
    const results = await Promise.allSettled(hooks.map(h => h(event as SignumEvent<SignumEventType>)))
    return results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  }
}
