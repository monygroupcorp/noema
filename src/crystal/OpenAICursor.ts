import type { Modus } from '../types/modus.js'
import type { Actum } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult } from '../types/cursus.js'

interface OpenAIClient {
  chat(params: { model: string; messages: Array<{ role: string; content: string }>; temperature?: number }): Promise<{ content: string; usage?: { total_tokens?: number } }>
  image(params: { model: string; prompt: string; size?: string; quality?: string; n?: number }): Promise<{ url: string }>
}

export class OpenAICursor implements Cursor {
  constructor(private readonly client: OpenAIClient) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    return modus.impetusFixum ?? 0n
  }

  async run(actum: Actum, _modo?: Modo): Promise<CursorResult> {
    // aditus validated by validateAditus before dispatch
    const aditus = actum.aditus

    // Dispatch: if aditus has 'size' or 'quality', it's an image generation request.
    const isImage = aditus.size !== undefined || aditus.quality !== undefined

    if (isImage) {
      const prompt = String(aditus.prompt ?? '')
      const imageResult = await this.client.image({
        model: String(aditus.model ?? 'dall-e-3'),
        prompt,
        size: aditus.size !== undefined ? String(aditus.size) : undefined,
        quality: aditus.quality !== undefined ? String(aditus.quality) : undefined,
        n: aditus.n !== undefined ? Number(aditus.n) : undefined,
      })

      return {
        kind: 'sync',
        exitus: {
          exitus: { imageUrl: imageResult.url },
          impetus: 0n,
        },
      }
    }

    // Default: chat completion
    const prompt = String(aditus.prompt ?? '')
    const messages: Array<{ role: string; content: string }> = Array.isArray(aditus.messages)
      ? aditus.messages as Array<{ role: string; content: string }>
      : [{ role: 'user', content: prompt }]

    const chatResult = await this.client.chat({
      model: String(aditus.model ?? 'gpt-4o'),
      messages,
      temperature: aditus.temperature !== undefined ? Number(aditus.temperature) : undefined,
    })

    return {
      kind: 'sync',
      exitus: {
        exitus: { response: chatResult.content },
        impetus: 0n,
      },
    }
  }
}
