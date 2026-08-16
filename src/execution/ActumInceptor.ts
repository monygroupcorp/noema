import { randomUUID } from 'node:crypto'
import { computeRecipient } from '../arcanum/prover.js'
import type { Actum } from '../types/actum.js'
import type { Signorum } from '../types/significandi.js'
import type { Modorum } from '../types/modus.js'
import type { Cursorum, Actorum, Inceptio } from '../types/cursus.js'
import type { ArcanumVerifier } from '../arcanum/ArcanumVerifier.js'
import type { Bursarum } from '../types/bursa.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { bus } from '../lib/bus.js'

const log = makeLogger('execution:inceptor')

const DEFAULT_EXPIRAT_MS = 15 * 60 * 1000  // 15 minutes

/**
 * Thrown when the payer cannot cover a run's upper-bound reservation.
 *
 * A typed domain error so a caller can tell "the payer is short" apart from "the
 * server failed": the API layer maps this to `402 economy.insufficient_signa`
 * instead of the generic 500. `balance` and `required` are carried as FIELDS —
 * the mapper reads them as data rather than parsing them back out of the message.
 *
 * Layering: this lives in the core and carries no API error vocabulary;
 * translation to an `ApiError` happens at the allocutio boundary.
 */
export class InsufficientFundsError extends Error {
  constructor(readonly balance: bigint, readonly required: bigint) {
    super(`Insufficient funds: balance ${balance} < required ${required}`)
    this.name = 'InsufficientFundsError'
  }
}

interface Deps {
  modorum: Modorum
  cursorum: Cursorum
  signorum: Signorum
  acta: Actorum
  /** Required for the arcanumProof path — absent: ZK spend proofs will be rejected */
  arcanumVerifier?: ArcanumVerifier
  /** Required for the bursaToken path — absent: bursa runs will be rejected */
  bursarium?: Bursarum
}

export class ActumInceptor {
  constructor(private readonly deps: Deps) {}

  async initiate(params: Inceptio): Promise<Actum> {
    const { modorum, cursorum, signorum, acta } = this.deps
    const { modusId, versio, aditus, by, modoId, computeStrategy: strategyOverride, gpuClass: gpuOverride, shareTokenHint, pinnedModels, compositum } = params

    // 1. Resolve modus
    const modus = await modorum.find(modusId, versio)
    if (!modus) throw new Error(`Modus '${modusId}' not found`)

    // 2. Get runner + reserve upper-bound impetus
    const runner = cursorum.resolve(modus)
    const reservation = await runner.reserve(modus, aditus)

    // ── ZK anonymous path ───────────────────────────────────────────────────
    if ('arcanumProof' in by) {
      return this._initiateWithProof(params, modus, reservation)
    }

    // ── Bursa (anonymous credit purse) path ─────────────────────────────────
    if ('bursaToken' in by) {
      return this._initiateWithBursa(params, modus, reservation)
    }

    // ── Identified + legacy arcanum hash path ───────────────────────────────

    // 3. Balance check
    const balance = await signorum.balance(by)
    if (balance < reservation && !process.env.DEV_FREE_EXECUTION) {
      log.warn('insufficient funds', { balance: balance.toString(), required: reservation.toString() })
      throw new InsufficientFundsError(balance, reservation)
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

    // 4a. Legacy commitment path: stamp nullifier, reject double-spend
    let nullifier: string | undefined
    if ('commitment' in by) {
      const selectedSigna = valid.filter(s => selected.includes(s.id))
      const arcanumSignum = selectedSigna.find(s => s.forma === 'arcanum')
      if (arcanumSignum) {
        nullifier = arcanumSignum.id
        const existing = await acta.findByNullifier(nullifier)
        if (existing) {
          throw new Error(`Arcanum already spent: nullifier ${nullifier} recorded on actum ${existing.id}`)
        }
      }
    }

    // 5. Pre-generate actum id so we can lock against it before writing
    const actumId = randomUUID()

    // 6. Lock selected signa against the pending actum
    await signorum.lock(selected, actumId)

    // 7. Create the actum record — release locks if this fails (atomicity)
    try {
      const computeStrategy = strategyOverride ?? modus.computeStrategy
      const gpuClass = gpuOverride ?? modus.gpuClass

      const actum = await acta.create({
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
        ...(nullifier ? { nullifier } : {}),
        ...(shareTokenHint ? { shareTokenHint } : {}),
        ...(pinnedModels?.length ? { pinnedModels } : {}),
        ...(compositum ? { compositum } : {}),
      })
      log.info('actum initiated', {
        actumId:     actum.id,
        modusId:     modus.id,
        byType:      'arcanumProof' in by ? 'arcanumProof'
                     : 'commitment' in by ? 'commitment'
                     : 'animaId',
        reservation: reservation.toString(),
      })
      const ctx = getTrace()
      if (ctx) ctx.actumId = actum.id
      bus.emit('actum.start', {
        actumId: actum.id,
        modusId: modus.id,
        animaId: 'animaId' in by ? by.animaId : undefined,
      })
      return actum
    } catch (err) {
      await signorum.release(selected)
      throw err
    }
  }

  // ── ZK proof path ─────────────────────────────────────────────────────────

  private async _initiateWithProof(
    params: Inceptio,
    modus: Awaited<ReturnType<NonNullable<Deps['modorum']['find']>>>,
    reservation: bigint,
  ): Promise<Actum> {
    if (!modus) throw new Error('modus is null')
    const { acta } = this.deps
    const { aditus, by, modoId, computeStrategy: strategyOverride, gpuClass: gpuOverride, shareTokenHint, pinnedModels, compositum } = params

    if (!('arcanumProof' in by)) throw new Error('expected arcanumProof path')
    const { arcanumProof } = by

    if (!this.deps.arcanumVerifier) {
      throw new Error('arcanumVerifier not configured — cannot accept ZK spend proofs')
    }

    // Verify recipient = hash(modusId, aditus) — proof is bound to this execution
    const expectedRecipient = computeRecipient(modus.id, aditus)
    if (arcanumProof.publicSignals.recipient !== expectedRecipient) {
      throw new Error('Arcanum proof recipient mismatch — proof was generated for a different execution')
    }

    // Verify the Groth16 proof — throws on any failure
    const { nullifierHash, valor } = await this.deps.arcanumVerifier.verify(arcanumProof)

    // Check note valor covers the reservation. This is the same "payer is short"
    // condition as the identified path's balance check and carries the same typed
    // error: a note's valor is denominated in impetus points, exactly like a signum
    // balance, so `InsufficientFundsError` applies without any unit translation.
    if (valor < reservation) {
      throw new InsufficientFundsError(valor, reservation)
    }

    // Create the actum — nullifier is the nullifierHash from the proof
    const actumId = randomUUID()
    const computeStrategy = strategyOverride ?? modus.computeStrategy
    const gpuClass = gpuOverride ?? modus.gpuClass

    // Claim the nullifier first — markSpent must be atomic (DB unique index on nullifierHash).
    // If two concurrent requests race with the same proof, only one wins here; the second
    // throws before creating a duplicate actum. If acta.create then fails, the note is
    // burned rather than double-spent — an acceptable trade under the ZK threat model.
    await this.deps.arcanumVerifier.markSpent(nullifierHash)

    return acta.create({
      id: actumId,
      modusId: modus.id,
      modusVersiono: modus.versio,
      modoId,
      impetus: reservation,
      signaConsumed: [],  // no Signorum signa — the note is the payment
      aditus,
      status: 'nascens',
      expirat: new Date(Date.now() + DEFAULT_EXPIRAT_MS),
      nullifier: nullifierHash,
      ...(computeStrategy ? { computeStrategy } : {}),
      ...(gpuClass ? { gpuClass } : {}),
      ...(shareTokenHint ? { shareTokenHint } : {}),
      ...(pinnedModels?.length ? { pinnedModels } : {}),
      ...(compositum ? { compositum } : {}),
    })
  }

  private async _initiateWithBursa(
    params: Inceptio,
    modus: Awaited<ReturnType<NonNullable<Deps['modorum']['find']>>>,
    reservation: bigint,
  ): Promise<Actum> {
    if (!modus) throw new Error('modus is null')
    const { acta } = this.deps
    const { aditus, by, modoId, computeStrategy: strategyOverride, gpuClass: gpuOverride, shareTokenHint, pinnedModels, compositum } = params

    if (!('bursaToken' in by)) throw new Error('expected bursaToken path')
    const { bursaToken } = by

    if (!this.deps.bursarium) {
      throw new Error('bursarium not configured — cannot accept bursa token runs')
    }

    // Atomic debit — throws if token not found or balance insufficient
    await this.deps.bursarium.debit(bursaToken, reservation)

    const actumId = randomUUID()
    const computeStrategy = strategyOverride ?? modus.computeStrategy
    const gpuClass = gpuOverride ?? modus.gpuClass

    try {
      return await acta.create({
        id: actumId,
        modusId: modus.id,
        modusVersiono: modus.versio,
        modoId,
        impetus: reservation,
        signaConsumed: [],
        aditus,
        status: 'nascens',
        expirat: new Date(Date.now() + DEFAULT_EXPIRAT_MS),
        bursaToken,
        ...(computeStrategy ? { computeStrategy } : {}),
        ...(gpuClass ? { gpuClass } : {}),
        ...(shareTokenHint ? { shareTokenHint } : {}),
        ...(pinnedModels?.length ? { pinnedModels } : {}),
        ...(compositum ? { compositum } : {}),
      })
    } catch (err) {
      // Debit already committed — restore credits so the purse isn't silently drained.
      await this.deps.bursarium.credit(bursaToken, reservation).catch(() => {
        log.error('bursa credit-back failed after actum create error', { bursaToken, reservation: reservation.toString() })
      })
      throw err
    }
  }

}
