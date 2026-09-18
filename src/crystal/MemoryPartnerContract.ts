import { randomUUID } from 'node:crypto'
import type { PartnerContractSignature, PartnerContractStore } from '../types/partnerContract.js'

/** In-memory contract-signature book — the hermetic mirror of `MongoPartnerContract`.
 *  Append-only: `sign` never replaces a row, so the history a partner reads back is the
 *  history that governed its runs. */
export class MemoryPartnerContract implements PartnerContractStore {
  private readonly rows: PartnerContractSignature[] = []

  async sign(
    input: Omit<PartnerContractSignature, 'id' | 'signedAt'> & { signedAt?: Date },
  ): Promise<PartnerContractSignature> {
    const record: PartnerContractSignature = { ...input, id: randomUUID(), signedAt: input.signedAt ?? new Date() }
    this.rows.push(record)
    return record
  }

  async findCurrent(animaId: string, version: string): Promise<PartnerContractSignature | null> {
    const matches = this.rows
      .filter(r => r.animaId === animaId && r.version === version)
      .sort((a, b) => a.signedAt.getTime() - b.signedAt.getTime())
    return matches[0] ?? null
  }

  async list(animaId: string): Promise<PartnerContractSignature[]> {
    return this.rows
      .filter(r => r.animaId === animaId)
      .sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())
  }
}
