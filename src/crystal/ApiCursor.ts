import type { Modus } from '../types/modus.js'
import type { Actum } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult } from '../types/cursus.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { ApiProvider, ApiCapability, ApiCapabilitySpec } from './apiProviders.js'

// =============================================================================
// ApiCursor — ONE cursor, driven by a provider descriptor (data)
// =============================================================================
//
// Registered once per provider under that provider's `ministerium` key, bound
// to the provider's descriptor. All hosted-API inference (OpenAI, OpenRouter,
// …) flows through this single class. Adding a provider = descriptor + env key
// + a seed modus — no code here changes.
//
// CAPABILITY DISPATCH is declared, not sniffed: each modus stamps
// `aditus.__capability` ('chat' | 'image' | 'imageEdit'). This mirrors the
// existing `__spaceUrl` routing-key convention and reaches run() through the
// Actum (which does not carry the Modus). Absent → defaults to 'chat'.
//
// STREAMING DECISION (Concierge-critical): option (a) — the cursor stays SYNC.
// It returns the full completion plus real usage-metered impetus. The Concierge
// owns its own token-streaming chat session directly against the provider for
// the interactive path, and only SETTLES through a run when it commits work.
// This keeps the ledger clean and the run rail simple. Documented in the handoff.
// =============================================================================

/**
 * ApiHttp — the one I/O seam. Injected so the cursor stays hermetic (a fake
 * transport in tests, no network). The real impl (`httpApiTransport`) is a thin
 * `fetch` against the descriptor's `baseUrl` — no SDK shape leaks in, so
 * OpenRouter is a pure descriptor add.
 */
export interface ApiHttp {
  /** POST a JSON body with a bearer key. Returns parsed JSON. Throws on non-2xx. */
  postJson(url: string, apiKey: string, body: unknown): Promise<unknown>
  /** POST a multipart form (image edit) with a bearer key. Returns parsed JSON. */
  postForm(url: string, apiKey: string, form: FormData): Promise<unknown>
}

interface ApiCursorDeps {
  /** Bearer key resolved from `provider.authEnv` by the container. */
  apiKey: string
  http: ApiHttp
  /** Fetches an input image URL into bytes for the imageEdit multipart. */
  mediaFetcher?: MediaFetcher
}

export class ApiCursor implements Cursor {
  constructor(
    private readonly provider: ApiProvider,
    private readonly deps: ApiCursorDeps,
  ) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    return modus.impetusFixum ?? 0n
  }

  async run(actum: Actum, _modo?: Modo): Promise<CursorResult> {
    const aditus = actum.aditus
    // The reservation ActumInceptor locked — the upper bound run() must not exceed.
    const reserved = actum.impetus
    const capability = this.resolveCapability(aditus)

    switch (capability) {
      case 'image':     return this.runImage(aditus, reserved)
      case 'imageEdit': return this.runImageEdit(aditus, reserved)
      case 'chat':      return this.runChat(aditus, reserved)
    }
  }

  // ── chat (the generic OpenAI-compatible path) ────────────────────────────
  private async runChat(aditus: Record<string, unknown>, reserved: bigint): Promise<CursorResult> {
    const spec = this.capability('chat')
    const prompt = String(aditus.prompt ?? '')
    const messages = Array.isArray(aditus.messages)
      ? (aditus.messages as Array<{ role: string; content: string }>)
      : [{ role: 'user', content: prompt }]

    const body: Record<string, unknown> = {
      model: String(aditus.model ?? spec.defaultModel),
      messages,
    }
    if (aditus.temperature !== undefined) body.temperature = Number(aditus.temperature)

    const res = await this.deps.http.postJson(this.url(spec), this.deps.apiKey, body) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { total_tokens?: number }
    }

    const response = res.choices?.[0]?.message?.content ?? ''
    const tokens = res.usage?.total_tokens ?? 0
    return this.sync({ response }, this.clamp(this.meterChat(tokens), reserved))
  }

  // ── image generation ─────────────────────────────────────────────────────
  private async runImage(aditus: Record<string, unknown>, reserved: bigint): Promise<CursorResult> {
    const spec = this.capability('image')
    const n = aditus.n !== undefined ? Number(aditus.n) : 1

    const body: Record<string, unknown> = {
      model: String(aditus.model ?? spec.defaultModel),
      prompt: String(aditus.prompt ?? ''),
      n,
    }
    if (aditus.size !== undefined) body.size = String(aditus.size)
    if (aditus.quality !== undefined) body.quality = String(aditus.quality)

    const res = await this.deps.http.postJson(this.url(spec), this.deps.apiKey, body)
    return this.sync({ image: this.imageFrom(res) }, this.clamp(this.meterImages(n), reserved))
  }

  // ── image editing (OpenAI images.edit — multipart) ───────────────────────
  private async runImageEdit(aditus: Record<string, unknown>, reserved: bigint): Promise<CursorResult> {
    const spec = this.capability('imageEdit')
    if (!this.deps.mediaFetcher) {
      throw new Error(`ApiCursor(${this.provider.id}): imageEdit needs a mediaFetcher to load the input image`)
    }
    const imageUrl = String(aditus.image ?? '')
    if (!imageUrl) throw new Error(`ApiCursor(${this.provider.id}): imageEdit requires an input 'image'`)

    const form = new FormData()
    form.append('model', String(aditus.model ?? spec.defaultModel))
    form.append('prompt', String(aditus.prompt ?? ''))
    const imageBytes = await this.deps.mediaFetcher.fetch(imageUrl)
    form.append('image', new Blob([Uint8Array.from(imageBytes)]), 'image.png')
    if (aditus.mask !== undefined) {
      const maskBytes = await this.deps.mediaFetcher.fetch(String(aditus.mask))
      form.append('mask', new Blob([Uint8Array.from(maskBytes)]), 'mask.png')
    }

    const res = await this.deps.http.postForm(this.url(spec), this.deps.apiKey, form)
    return this.sync({ image: this.imageFrom(res) }, this.clamp(this.meterImages(1), reserved))
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Declared capability from the routing key; defaults to chat. */
  private resolveCapability(aditus: Record<string, unknown>): ApiCapability {
    const declared = aditus.__capability
    if (declared === 'chat' || declared === 'image' || declared === 'imageEdit') return declared
    return 'chat'
  }

  private capability(cap: ApiCapability): ApiCapabilitySpec {
    const spec = this.provider.capabilities[cap]
    if (!spec) {
      throw new Error(`ApiCursor(${this.provider.id}): provider does not serve capability '${cap}'`)
    }
    return spec
  }

  private url(spec: ApiCapabilitySpec): string {
    return `${this.provider.baseUrl}${spec.path}`
  }

  /** OpenAI image responses carry `data[0].url` (dall-e) or `data[0].b64_json` (gpt-image). */
  private imageFrom(res: unknown): string {
    const data = (res as { data?: Array<{ url?: string; b64_json?: string }> }).data?.[0]
    if (data?.url) return data.url
    if (data?.b64_json) return `data:image/png;base64,${data.b64_json}`
    return ''
  }

  private meterChat(tokens: number): bigint {
    const per1k = this.provider.pricing.chatImpetusPer1kTokens ?? 0n
    if (per1k === 0n || tokens <= 0) return 0n
    // ceil(tokens × per1k / 1000) — never under-charge on the sub-unit remainder.
    return (BigInt(tokens) * per1k + 999n) / 1000n
  }

  private meterImages(n: number): bigint {
    const perImage = this.provider.pricing.imageImpetusPerImage ?? 0n
    return perImage * BigInt(Math.max(0, n))
  }

  /** Enforce the two-phase cost invariant: run().impetus ≤ reserve(). */
  private clamp(impetus: bigint, reserved: bigint): bigint {
    return impetus > reserved ? reserved : impetus
  }

  private sync(exitus: Record<string, unknown>, impetus: bigint): CursorResult {
    return { kind: 'sync', exitus: { exitus, impetus } }
  }
}

/**
 * The real transport — global `fetch` (Node 18+), bearer auth, no SDK. Shared
 * across all provider descriptors.
 */
export const httpApiTransport: ApiHttp = {
  async postJson(url, apiKey, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(`API POST ${url} → ${res.status}: ${msg}`)
    }
    return res.json()
  },
  async postForm(url, apiKey, form) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(`API POST ${url} → ${res.status}: ${msg}`)
    }
    return res.json()
  },
}
