import type { Cursor, Cursorum } from '../types/cursus.js'
import type { Modus } from '../types/modus.js'

export class SimpleCursorum implements Cursorum {
  private readonly registry = new Map<string, Cursor>()

  register(ministerium: string, cursor: Cursor): void {
    this.registry.set(ministerium, cursor)
  }

  resolve(modus: Modus): Cursor {
    const cursor = modus.ministerium && this.registry.get(modus.ministerium)
    if (!cursor) throw new Error(`No cursor registered for ministerium '${modus.ministerium}'`)
    return cursor
  }
}
