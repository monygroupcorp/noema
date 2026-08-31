import { v4 as uuidv4 } from 'uuid'
import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Modus } from '../types/modus.js'
import type { Actum } from '../types/actum.js'
import type { Modo, ModoStore } from '../types/modo.js'
import type { Signum, Signorum } from '../types/significandi.js'

type AuctorKey = { animaId: string } | { commitment: string }

export interface TesseraOpenResult {
  modo: Modo
  tessera: Signum
}

/**
 * TesseraCursor wraps an execution cursor and adds Modo session tracking.
 * On openModo(): creates the session record + issues a tessera Signum budget.
 * On run(): delegates to inner cursor, then records the actum on the Modo.
 *
 * It does NOT accrue session spend. `Modo.impetusAccrued` holds the SETTLED
 * figure, which does not exist yet when run() returns — the cursor's reported
 * impetus is only settlement's base term, before any surcharge or the
 * reservation cap. `ActumCompletor.complete` is the single accrual site, on
 * both the sync rail (dispatchInceptio completes inline) and the async one.
 */
export class TesseraCursor implements Cursor {
  constructor(
    private inner: Cursor,
    private modos: ModoStore,
    private signorum: Signorum,
  ) {}

  async openModo(
    budget: bigint,
    auctorKey: AuctorKey,
    idleWarmthSec = 300
  ): Promise<TesseraOpenResult> {
    const modo = await this.modos.create({
      status: 'claiming',
      impetusAccrued: 0n,
      acta: [],
      idleWarmthSec,
    })

    // tessera forma is anonymous — no animaId ever
    const tessera = await this.signorum.issue({
      forma: 'tessera',
      valor: budget,
      auctor: 'system:session',
      testis: uuidv4(),
      modoId: modo.id,
    })

    return { modo, tessera }
  }

  async reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint> {
    return this.inner.reserve(modus, aditus)
  }

  async run(actum: Actum, modo?: Modo): Promise<CursorResult> {
    // aditus validated by validateAditus before dispatch
    const result = await this.inner.run(actum, modo)

    if (modo) {
      // Track the actum on the session. Spend is NOT accrued here on either rail:
      // the settled amount is decided by ActumCompletor, which is where it accrues.
      await this.modos.update(modo.id, { acta: [...modo.acta, actum.id] })
    }

    return result
  }
}
