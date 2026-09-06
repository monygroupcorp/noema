import { randomUUID } from 'node:crypto'
import type { Locorum, Locus, LocusPlace } from '../types/locus.js'

/**
 * In-memory Locorum — the warm-pod line for a single process (tests, dev, and any
 * deployment running one node with no Mongo behind it).
 *
 * `claim` is exclusive here for the same reason it is in Mongo, by a different
 * mechanism: JavaScript's single-threaded turn is the atom, so reading the oldest
 * unclaimed place and stamping it happens with no await in between.
 */
export class MemoryLocorum implements Locorum {
  private readonly store = new Map<string, Locus>()

  async enqueue(input: { actumId: string; imageRef: string }): Promise<Locus> {
    const held = this._byActum(input.actumId)
    if (held) return held
    const locus: Locus = {
      id: randomUUID(),
      actumId: input.actumId,
      imageRef: input.imageRef,
      admissum: new Date(),
    }
    this.store.set(locus.id, locus)
    return locus
  }

  async place(actumId: string): Promise<LocusPlace | null> {
    const held = this._byActum(actumId)
    if (!held) return null
    const line = this._line(held.imageRef)
    const index = line.findIndex(l => l.actumId === actumId)
    // A claimed place is out of the line (`_line` excludes it) but still held: it is
    // being dispatched right now, so it stands at the head rather than nowhere.
    if (index < 0) return { place: 1, depth: line.length + 1 }
    return { place: index + 1, depth: line.length }
  }

  async claim(imageRef: string): Promise<Locus | null> {
    const next = this._line(imageRef)[0]
    if (!next) return null
    const claimed: Locus = { ...next, vocatum: new Date() }
    this.store.set(claimed.id, claimed)
    return claimed
  }

  async waiting(imageRef: string): Promise<Locus[]> {
    return this._line(imageRef)
  }

  async images(): Promise<string[]> {
    return [...new Set([...this.store.values()].map(l => l.imageRef))]
  }

  async remove(actumId: string): Promise<void> {
    const held = this._byActum(actumId)
    if (held) this.store.delete(held.id)
  }

  async release(id: string): Promise<void> {
    const held = this.store.get(id)
    if (!held) return
    const { vocatum: _claimed, ...rest } = held
    this.store.set(id, rest)
  }

  private _byActum(actumId: string): Locus | undefined {
    for (const l of this.store.values()) if (l.actumId === actumId) return l
    return undefined
  }

  /** The unclaimed places for one image, oldest first. */
  private _line(imageRef: string): Locus[] {
    return [...this.store.values()]
      .filter(l => l.imageRef === imageRef && l.vocatum === undefined)
      .sort((a, b) => a.admissum.getTime() - b.admissum.getTime())
  }
}
