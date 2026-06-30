import type { Collection } from 'mongodb'

// Caeremonia — the Arcanum Groth16 Phase-2 trusted-setup ceremony, as a persistent
// coordinator object. ONE global ceremony: a status doc (phase + published hash chain)
// plus a list of contributor-slot requests.
//
// The HTTP surface (ceremoniaRouter) is read-only + slot-claim. The chain is advanced
// by the coordinator (scripts/arcanum-trusted-setup.sh → finalize), which calls open()/
// appendContribution()/finalize() — never the public API. See docs/arcanum-ceremony.md.

export type CaeremoniaPhase = 'announced' | 'open' | 'finalized'

export interface Contributio {
  /** 1-based position in the hash chain. */
  index: number
  /** Contributor's chosen name/handle. */
  name: string
  /** sha256 of the .zkey they produced — the public attestation anchor. */
  outputHash: string
  at: Date
}

export interface CaeremoniaStatus {
  phase: CaeremoniaPhase
  /** Hash of arcanum_0000.zkey — the chain's root, published when the ceremony opens. */
  rootHash: string | null
  chain: Contributio[]
  /** Final proving-key hash once the beacon is applied. */
  finalHash: string | null
  /** Open contributor slots while accepting, else null. */
  openSlots: number | null
}

// The honest pre-coordinator state: announced, nothing collected yet.
const ANNOUNCED: CaeremoniaStatus = {
  phase: 'announced', rootHash: null, chain: [], finalHash: null, openSlots: null,
}

/**
 * The hash of the zkey the NEXT contributor must build on — the last contribution's
 * output, or the root when the chain is empty. null before the ceremony opens.
 */
export function headHash(status: CaeremoniaStatus): string | null {
  return status.chain.length ? status.chain[status.chain.length - 1].outputHash : status.rootHash
}

export interface CeremoniaStore {
  /** Current ceremony status (announced fallback before the coordinator has run). */
  status(): Promise<CaeremoniaStatus>
  /** Record interest in a contributor slot. Idempotent-ish: deduped by contact. */
  requestSlot(contact: string): Promise<void>
  /** Coordinator: open the ceremony with the root zkey hash. */
  open(rootHash: string, openSlots?: number | null): Promise<void>
  /**
   * Append a verified contribution to the public chain — the sequencer's atomic
   * step. Optimistic lock: the push only lands if the chain head is still
   * `expectHeadHash` (the zkey the contributor built on). Returns false when a
   * concurrent contribution already moved the head — the caller re-syncs and retries.
   */
  appendContribution(c: Omit<Contributio, 'at'>, expectHeadHash: string): Promise<boolean>
  /** Coordinator: seal the ceremony with the beacon'd final proving-key hash. */
  finalize(finalHash: string): Promise<void>
}

const DOC_ID = 'caeremonia'

interface StatusDoc {
  _id: string
  phase: CaeremoniaPhase
  rootHash: string | null
  chain: Contributio[]
  finalHash: string | null
  openSlots: number | null
}

export class MongoCeremoniaStore implements CeremoniaStore {
  constructor(
    private readonly statusCol: Collection<StatusDoc>,
    private readonly slotCol: Collection,
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.slotCol.createIndex({ contact: 1 }, { unique: true })
  }

  async status(): Promise<CaeremoniaStatus> {
    const doc = await this.statusCol.findOne({ _id: DOC_ID })
    if (!doc) return ANNOUNCED
    return {
      phase: doc.phase,
      rootHash: doc.rootHash,
      chain: doc.chain ?? [],
      finalHash: doc.finalHash,
      openSlots: doc.openSlots,
    }
  }

  async requestSlot(contact: string): Promise<void> {
    await this.slotCol.updateOne(
      { contact },
      { $setOnInsert: { contact, at: new Date() } },
      { upsert: true },
    )
  }

  async open(rootHash: string, openSlots: number | null = null): Promise<void> {
    await this.statusCol.updateOne(
      { _id: DOC_ID },
      { $set: { phase: 'open', rootHash, openSlots }, $setOnInsert: { chain: [], finalHash: null } },
      { upsert: true },
    )
  }

  async appendContribution(c: Omit<Contributio, 'at'>, expectHeadHash: string): Promise<boolean> {
    // Conditional push: only when the current head still equals expectHeadHash.
    // Head = last chain.outputHash, or rootHash when the chain is empty.
    const res = await this.statusCol.updateOne(
      {
        _id: DOC_ID,
        phase: 'open',
        $expr: {
          $eq: [
            { $ifNull: [{ $last: '$chain.outputHash' }, '$rootHash'] },
            expectHeadHash,
          ],
        },
      },
      { $push: { chain: { ...c, at: new Date() } } },
    )
    return res.modifiedCount === 1
  }

  async finalize(finalHash: string): Promise<void> {
    await this.statusCol.updateOne(
      { _id: DOC_ID },
      { $set: { phase: 'finalized', finalHash, openSlots: null } },
    )
  }
}

/** In-memory store for tests and pre-DB dev. */
export class MemoryCeremoniaStore implements CeremoniaStore {
  private state: CaeremoniaStatus = { ...ANNOUNCED, chain: [] }
  private slots = new Set<string>()

  async status(): Promise<CaeremoniaStatus> {
    return { ...this.state, chain: [...this.state.chain] }
  }
  async requestSlot(contact: string): Promise<void> { this.slots.add(contact) }
  async open(rootHash: string, openSlots: number | null = null): Promise<void> {
    this.state.phase = 'open'; this.state.rootHash = rootHash; this.state.openSlots = openSlots
  }
  async appendContribution(c: Omit<Contributio, 'at'>, expectHeadHash: string): Promise<boolean> {
    if (this.state.phase !== 'open') return false
    const head = this.state.chain.length
      ? this.state.chain[this.state.chain.length - 1].outputHash
      : this.state.rootHash
    if (head !== expectHeadHash) return false
    this.state.chain.push({ ...c, at: new Date() })
    return true
  }
  async finalize(finalHash: string): Promise<void> {
    this.state.phase = 'finalized'; this.state.finalHash = finalHash; this.state.openSlots = null
  }
  /** Test helper: how many distinct contacts have requested a slot. */
  slotCount(): number { return this.slots.size }
}
