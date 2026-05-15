import type { Actum } from '../../types/actum.js'
import type { Vestigium, Vestigiorum, VestigiumGenus, VestigiumVisibility } from '../../types/vestigium.js'

type AuctorKey = { animaId: string } | { commitment: string }

export interface VestigiumHookOptions {
  genus?: VestigiumGenus
  visibilitas?: VestigiumVisibility
  /** Key in actum.aditus that holds the text prompt — default 'prompt' */
  promptKey?: string
  /** Key in actum.aditus that holds the negative prompt — default 'negative_prompt' */
  negativumKey?: string
  /** Key in actum.exitus that holds the primary output image URL */
  imagoKey?: string
  /** Key in actum.exitus that holds the text summary / caption */
  summaryKey?: string
  /** Intella model IDs resolved for this execution */
  intellaIds?: string[]
  /** Pre-rendered textual description of the models (for embeddingIntella) */
  intellaDescription?: string
}

/**
 * Create a Vestigium from a completed Actum and fire all three index calls
 * asynchronously. Each index* call is fire-and-forget — a missing embed
 * function or absent field silently no-ops rather than failing the response.
 */
export async function createVestigiumFromActum(
  actum: Actum,
  auctorKey: AuctorKey,
  vestigiorum: Vestigiorum,
  options: VestigiumHookOptions = {}
): Promise<Vestigium> {
  const {
    genus = 'image',
    visibilitas = 'privata',
    promptKey = 'prompt',
    negativumKey = 'negative_prompt',
    imagoKey = 'imageUrl',
    summaryKey,
    intellaIds,
    intellaDescription,
  } = options

  const aditus = actum.aditus ?? {}
  const exitus = actum.exitus ?? {}

  const promptum = typeof aditus[promptKey] === 'string'
    ? (aditus[promptKey] as string)
    : JSON.stringify(aditus)

  const negativum = typeof aditus[negativumKey] === 'string'
    ? (aditus[negativumKey] as string)
    : undefined

  const imagoUrl = typeof exitus[imagoKey] === 'string'
    ? (exitus[imagoKey] as string)
    : undefined

  const summarium = resolveSummarium(exitus, summaryKey)

  const v = await vestigiorum.create({
    actumId: actum.id,
    modusId: actum.modusId,
    modusVersiono: actum.modusVersiono,
    modoId: actum.modoId,
    auctorKey,
    promptum,
    negativum,
    summarium,
    imagoUrl,
    intellaIds,
    intellaDescription,
    genus,
    visibilitas,
  })

  // Fire all three index dimensions asynchronously — errors are silenced so
  // a missing embed function or absent field does not block the response.
  vestigiorum.indexPromptum(v.id).catch(() => {})
  vestigiorum.indexImago(v.id).catch(() => {})
  vestigiorum.indexIntella(v.id).catch(() => {})

  return v
}

function resolveSummarium(exitus: Record<string, unknown>, summaryKey?: string): string {
  if (summaryKey && typeof exitus[summaryKey] === 'string') return exitus[summaryKey] as string
  if (typeof exitus.caption === 'string') return exitus.caption
  if (typeof exitus.text === 'string') return exitus.text
  if (typeof exitus.summarium === 'string') return exitus.summarium
  return ''
}
