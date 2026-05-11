import type { Actum } from '../types/actum.js'
import type { Exitus, ActumCompletor as IActumCompletor, Actorum } from '../types/cursus.js'
import type { Signorum } from '../types/significandi.js'

export class ActumCompletor implements IActumCompletor {
  constructor(
    private readonly actorum: Actorum,
    private readonly signorum: Signorum,
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
    await this.signorum.release(actum.signaConsumed)
    return this.actorum.update(actum.id, {
      status: 'fractus',
      error,
      completum: new Date(),
    })
  }
}
