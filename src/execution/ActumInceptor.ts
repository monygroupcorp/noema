import { randomUUID, createHash } from 'node:crypto'
import type { Actum } from '../types/actum.js'
import type { Signorum } from '../types/significandi.js'
import type { Modorum } from '../types/modus.js'
import type { Cursorum, Actorum, Inceptio } from '../types/cursus.js'
import type { ArcanumVerifier } from '../arcanum/ArcanumVerifier.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { bus } from '../lib/bus.js'

const log = makeLogger('execution:inceptor')

const DEFAULT_EXPIRAT_MS = 15 * 60 * 1000  // 15 minutes

interface Deps {
  modorum: Modorum
  cursorum: Cursorum
  signorum: Signorum
  acta: Actorum
  /** Required for the arcanumProof path — absent: ZK spend proofs will be rejected */
  arcanumVerifier?: ArcanumVerifier
}

export class ActumInceptor {
  constructor(private readonly deps: Deps) {}

  async initiate(params: Inceptio): Promise<Actum> {
    const { modorum, cursorum, signorum, acta } = this.deps
    const { modusId, versio, aditus, by, modoId, computeStrategy: strategyOverride, gpuClass: gpuOverride, shareTokenHint } = params

    // 1. Resolve modus
    const modus = await modorum.find(modusId, versio)
    if (!modus) throw new Error(`Modus '${modusId}' not found`)

    // 2. Get runner + reserve upper-bound impetus
    const runner = cursorum.resolve(modus)
    const reservation = await runner.reserve(modus, aditus)

    // ── ZK anonymous path ───────────────────────────────────────────────────
    if ('arcanumProof' in by) {
      return this._initiateWithProof(params, modus, runner, reservation)
    }

    // ── Identified + legacy arcanum hash path ───────────────────────────────

    // 3. Balance check
    const balance = await signorum.balance(by)
    if (balance < reservation && !process.env.DEV_FREE_EXECUTION) {
      log.warn('insufficient funds', { balance: balance.toString(), required: reservation.toString() })
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
    runner: ReturnType<Deps['cursorum']['resolve']>,
    reservation: bigint,
  ): Promise<Actum> {
    if (!modus) throw new Error('modus is null')
    const { acta } = this.deps
    const { aditus, by, modoId, computeStrategy: strategyOverride, gpuClass: gpuOverride, shareTokenHint } = params

    if (!('arcanumProof' in by)) throw new Error('expected arcanumProof path')
    const { arcanumProof } = by

    if (!this.deps.arcanumVerifier) {
      throw new Error('arcanumVerifier not configured — cannot accept ZK spend proofs')
    }

    // Verify recipient = hash(modusId, aditus) — proof is bound to this execution
    const expectedRecipient = this._computeRecipient(modus.id, aditus)
    if (arcanumProof.publicSignals.recipient !== expectedRecipient) {
      throw new Error('Arcanum proof recipient mismatch — proof was generated for a different execution')
    }

    // Verify the Groth16 proof — throws on any failure
    const { nullifierHash, valor } = await this.deps.arcanumVerifier.verify(arcanumProof)

    // Check note valor covers the reservation
    if (valor < reservation) {
      throw new Error(`Arcanum note valor ${valor} < required ${reservation}`)
    }

    // Create the actum — nullifier is the nullifierHash from the proof
    const actumId = randomUUID()
    const computeStrategy = strategyOverride ?? modus.computeStrategy
    const gpuClass = gpuOverride ?? modus.gpuClass

    let actum: Actum
    try {
      actum = await acta.create({
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
      })
    } catch (err) {
      // Actum creation failed — do NOT mark nullifier spent; proof can be retried
      throw err
    }

    // Mark nullifier spent AFTER actum is safely persisted
    await this.deps.arcanumVerifier.markSpent(nullifierHash)

    return actum
  }

  /**
   * Binds a proof to a specific execution context.
   * recipient = sha256(modusId + ':' + JSON.stringify(sortedAditus)) as decimal
   * Prevents a valid proof from being front-run or replayed on a different modus.
   */
  private _computeRecipient(modusId: string, aditus: Record<string, unknown>): string {
    const sorted = Object.fromEntries(
      Object.entries(aditus).sort(([a], [b]) => a.localeCompare(b))
    )
    const payload = `${modusId}:${JSON.stringify(sorted)}`
    const hash = createHash('sha256').update(payload).digest()
    // Convert first 31 bytes to BigInt (field-safe for BN128)
    return BigInt('0x' + hash.slice(0, 31).toString('hex')).toString()
  }
}
