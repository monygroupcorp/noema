import type { Modus } from '../types/modus.js'
import type { Actum } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult } from '../types/cursus.js'

interface HuggingFaceClient {
  predict(spaceUrl: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
}

export class HuggingFaceCursor implements Cursor {
  constructor(private readonly client: HuggingFaceClient) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    return modus.impetusFixum ?? 0n
  }

  async run(actum: Actum, _modo?: Modo): Promise<CursorResult> {
    // aditus validated by validateAditus before dispatch
    const aditus = actum.aditus

    if (!aditus.__spaceUrl) {
      throw new Error('HuggingFaceCursor: __spaceUrl is required in actum.aditus')
    }

    const spaceUrl = String(aditus.__spaceUrl)

    // Pass all aditus fields to predict, except the __spaceUrl routing key
    const { __spaceUrl: _removed, ...params } = aditus

    const response = await this.client.predict(spaceUrl, params)

    return {
      kind: 'sync',
      exitus: {
        exitus: { ...response },
        impetus: 0n,
      },
    }
  }
}
