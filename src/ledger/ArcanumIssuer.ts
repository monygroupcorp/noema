import { randomBytes } from 'node:crypto'
import type { Signorum } from '../types/significandi.js'
import type { ArcanumTreeStore } from '../arcanum/ArcanumTree.js'
import type { ArcanumIssuance } from '../arcanum/types.js'
import { computeCommitment, computeNullifierHash } from '../arcanum/poseidon.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('arcanum:issuer')

// ---------------------------------------------------------------------------
// ArcanumIssuer — converts identified balance → anonymous Merkle note
// ---------------------------------------------------------------------------
//
// ISSUANCE FLOW:
//   1. Caller provides animaId + amount.
//   2. 32-byte secret + 32-byte nullifier generated server-side.
//      (Client-side generation is also valid — see note below.)
//   3. commitment = poseidon(nullifier, secret) inserted into Merkle tree.
//   4. Identified signa locked + settled (debit).
//   5. Note returned to client — secret and nullifier NEVER stored server-side.
//
// PRIVACY GUARANTEE:
//   - The Merkle tree stores { commitment, valor, leafIndex }. No animaId.
//   - The deposit record stores { animaId, valor }. No commitment.
//   - Timing/valor correlation between deposit and leaf is an accepted residual risk.
//     The critical property is that USAGE (what you generate) is unlinkable to identity.
//
// CLIENT-SIDE GENERATION NOTE:
//   For maximum privacy, the client should generate (secret, nullifier) locally
//   and send only the commitment to the server. This eliminates even the server's
//   transient knowledge of the private inputs. ArcanumIssuer supports this via
//   the `commitment` override — if provided, server-side generation is skipped.
//
// NOTE LOSS:
//   If the client loses their note, the credit is unrecoverable.
//   The platform cannot reverse the anonymization.
// ---------------------------------------------------------------------------

interface Deps {
  signorum: Signorum
  tree: ArcanumTreeStore
}

export class ArcanumIssuer {
  constructor(private readonly deps: Deps) {}

  /**
   * Convert identified balance → anonymous Merkle note.
   *
   * If `commitment` is provided (client-generated), the server inserts it into
   * the tree without ever knowing (secret, nullifier). If absent, the server
   * generates them and returns them in the note — note must be stored by client.
   */
  async issue(
    from: { animaId: string },
    amount: bigint,
    options?: { commitment?: string; nullifier?: string; secret?: string },
  ): Promise<ArcanumIssuance> {
    const { signorum, tree } = this.deps

    if (amount <= 0n) throw new Error('amount must be positive')

    // 1. Balance check
    const balance = await signorum.balance({ animaId: from.animaId })
    if (balance < amount) {
      throw new Error(`Insufficient identified balance: ${balance} < ${amount}`)
    }

    // 2. Generate or accept (nullifier, secret, commitment)
    let nullifier: string
    let secret: string
    let commitment: string

    if (options?.commitment && options?.nullifier) {
      // Client-generated: server never sees secret
      nullifier = options.nullifier
      secret = '0'  // not used server-side when client provides commitment
      commitment = options.commitment
    } else {
      // Server-generated (less private, but simpler UX)
      nullifier = randomBytes(32).toString('hex')
      secret = randomBytes(32).toString('hex')
      commitment = await computeCommitment(nullifier, secret)
    }

    const nullifierHash = await computeNullifierHash(nullifier)

    // 3+4. Reserve exactly `amount` of the payer's identified signa, then settle it.
    // `reserve()` splits a note that is larger than `amount` at lock time (locked child =
    // the shortfall, valid child = the remainder) instead of locking the whole note and
    // waiting for settle()'s delta refund — the remainder must stay spendable for the
    // whole conversion, not just once it completes.
    const { randomUUID } = await import('node:crypto')
    const conversionId = randomUUID()
    const reservation = await signorum.reserve({ animaId: from.animaId }, amount, conversionId)
    if (!reservation.ok) {
      throw new Error(`Insufficient identified balance: ${reservation.available} < ${amount}`)
    }
    try {
      await signorum.settle(reservation.signaIds, amount, conversionId)
    } catch (err) {
      await signorum.release(reservation.signaIds)
      throw err
    }

    // 5. Insert commitment into anonymous Merkle tree
    const { leafIndex, proof } = await tree.insert(commitment, amount)

    return {
      note: {
        nullifierHash,
        commitment,
        leafIndex,
        valor: amount,
        spent: false,
      },
      merkleRoot: proof.root,
      merklePathElements: proof.pathElements,
      merklePathIndices: proof.pathIndices,
    }
  }
}
