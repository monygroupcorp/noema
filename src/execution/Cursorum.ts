import type { Cursorum as CursorumInterface, Cursor } from '../types/cursus.js'
import type { Modus } from '../types/modus.js'

export class Cursorum implements CursorumInterface {
  private readonly cursors = new Map<string, Cursor>()

  register(ministerium: string, cursor: Cursor): void {
    this.cursors.set(ministerium, cursor)
  }

  resolve(modus: Modus): Cursor {
    if (!modus.ministerium) {
      throw new Error(`Modus '${modus.id}' has no ministerium — cannot resolve a runner`)
    }
    const cursor = this.cursors.get(modus.ministerium)
    if (!cursor) {
      throw new Error(`No cursor registered for ministerium '${modus.ministerium}'`)
    }
    return cursor
  }
}
