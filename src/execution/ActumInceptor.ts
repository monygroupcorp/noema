import { randomUUID } from 'node:crypto'
import type { Actum } from '../types/actum.js'
import type { Signorum } from '../types/significandi.js'
import type { Modorum } from '../types/modus.js'
import type { Cursorum, Actorum, Inceptio } from '../types/cursus.js'

const DEFAULT_EXPIRAT_MS = 15 * 60 * 1000  // 15 minutes

interface Deps {
  modorum: Modorum
  cursorum: Cursorum
  signorum: Signorum
  acta: Actorum
}

export class ActumInceptor {
  constructor(private readonly deps: Deps) {}

  async initiate(params: Inceptio): Promise<Actum> {
    const { modorum, cursorum, signorum, acta } = this.deps
    const { modusId, versio, aditus, by, modoId, computeStrategy: strategyOverride, gpuClass: gpuOverride } = params

    // 1. Resolve modus
    const modus = await modorum.find(modusId, versio)
    if (!modus) throw new Error(`Modus '${modusId}' not found`)

    // 2. Get runner + reserve upper-bound impetus
    const runner = cursorum.resolve(modus)
    const reservation = await runner.reserve(modus, aditus)

    // 3. Balance check
    const balance = await signorum.balance(by)
    if (balance < reservation) {
      throw new Error(`Insufficient funds: balance ${balance} < required ${reservation}`)
    }

    // 4. Select valid signa to cover the reservation (greedy, smallest first)
    const history = await signorum.history(by)
    const valid = history.filter(s => s.status === 'valid').sort((a, b) => (a.valor < b.valor ? -1 : 1))
    const selected: string[] = []
    let covered = 0n
    for (const s of valid) {
      if (covered >= reservation) break
      selected.push(s.id)
      covered += s.valor
    }

    // 5. Pre-generate actum id so we can lock against it before writing
    const actumId = randomUUID()

    // 6. Lock selected signa against the pending actum
    await signorum.lock(selected, actumId)

    // 7. Create the actum record — release locks if this fails (atomicity)
    try {
      // Per-run override > Modus preference > absent (platform defaults at dispatch)
      const computeStrategy = strategyOverride ?? modus.computeStrategy
      const gpuClass = gpuOverride ?? modus.gpuClass

      return await acta.create({
        id: actumId,
        modusId: modus.id,
        modusVersiono: modus.versio,
        modoId,
        impetus: reservation,
        signaConsumed: selected,
        aditus,
        status: 'nascens',
        expirat: new Date(Date.now() + DEFAULT_EXPIRAT_MS),
        ...(computeStrategy ? { computeStrategy } : {}),
        ...(gpuClass ? { gpuClass } : {}),
      })
    } catch (err) {
      await signorum.release(selected)
      throw err
    }
  }
}
