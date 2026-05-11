import type { Actum } from '../types/actum.js'
import type { Signorum } from '../types/significandi.js'
import type { Exitus, Actorum } from '../types/cursus.js'
import type { Nexus } from '../types/nexus.js'

interface Deps {
  acta: Actorum
  signorum: Signorum
  nexus: Nexus
}

export class ActumCompletor {
  constructor(private readonly deps: Deps) {}

  async complete(actum: Actum, result: Exitus): Promise<Actum> {
    const { acta, signorum, nexus } = this.deps
    const { exitus, impetus, duratio, materiamId } = result
    const now = new Date()

    const current = await acta.findById(actum.id)
    if (current?.status === 'completus') {
      throw new Error(`Actum '${actum.id}' is already completus — double-completion rejected`)
    }

    // Cursor cost contract: actual must never exceed the quoted reservation
    if (impetus > actum.impetus) {
      throw new Error(
        `Cursor overcharge: actual impetus ${impetus} exceeds reservation ${actum.impetus}`
      )
    }

    // Settle signa: spend all locked, refund the delta to the original identity
    if (actum.signaConsumed.length) {
      await signorum.settle(actum.signaConsumed, impetus, actum.id)
    }

    // Update the actum record with final values
    const completed = await acta.update(actum.id, {
      status: 'completus',
      exitus,
      impetus,
      duratio,
      completum: now,
      ...(materiamId ? { materiamId } : {}),
    })

    // Business logic rail — hooks fire here
    await nexus.emit({
      type: 'execution_spend',
      payload: {
        actum: completed,
        impetus,
      },
    })

    return completed
  }

  async fail(actum: Actum, error: string): Promise<Actum> {
    const { acta, signorum } = this.deps

    const current = await acta.findById(actum.id)
    if (current?.status === 'completus' || current?.status === 'fractus') {
      return current
    }

    // Release all locked signa — nothing was consumed
    if (actum.signaConsumed.length) {
      await signorum.release(actum.signaConsumed)
    }

    return acta.update(actum.id, {
      status: 'fractus',
      error,
      completum: new Date(),
    })
  }

}
