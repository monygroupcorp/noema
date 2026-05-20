import type { Actum } from '../types/actum.js'
import type { Exitus, ActumCompletor as IActumCompletor, Actorum } from '../types/cursus.js'
import type { Signorum } from '../types/significandi.js'

export class ActumCompletor implements IActumCompletor {
  constructor(
    private readonly actorum: Actorum,
    private readonly signorum: Signorum,
    private readonly terminatePod?: (podId: string) => Promise<void>,
  ) {}

  async complete(actum: Actum, exitus: Exitus): Promise<Actum> {
    await this.signorum.settle(actum.signaConsumed, exitus.impetus, actum.id)
    return this.actorum.update(actum.id, {
      status: 'completus',
      exitus: exitus.exitus,
      impetus: exitus.impetus,
      duratio: exitus.duratio,
      materiamId: exitus.materiamId,
      completum: new Date(),
    })
  }

  async fail(actum: Actum, error: string): Promise<Actum> {
    // Invariant: terminating the pod is attempted before releasing signa so we
    // never refund a user while a pod is still burning money on their behalf.
    if (actum.externusJobId && this.terminatePod) {
      await this.terminatePod(actum.externusJobId).catch(() => {})
    }
    await this.signorum.release(actum.signaConsumed)
    return this.actorum.update(actum.id, {
      status: 'fractus',
      error,
      completum: new Date(),
    })
  }
}
