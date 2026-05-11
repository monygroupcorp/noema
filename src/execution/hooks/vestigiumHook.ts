import type { Actum } from '../../types/actum.js'
import type { Vestigium, Vestigiorum, VestigiumGenus, VestigiumVisibility } from '../../types/vestigium.js'

type AuctorKey = { animaId: string } | { arcanumHash: string }

export interface VestigiumHookOptions {
  genus?: VestigiumGenus
  visibilitas?: VestigiumVisibility
  promptKey?: string
  summaryKey?: string
}

/**
 * Create a Vestigium from a completed Actum.
 * Called by the API handler / executor after ActumCompletor.complete().
 * index() is intentionally NOT awaited — embedding is async and non-blocking.
 */
export async function createVestigiumFromActum(
  actum: Actum,
  auctorKey: AuctorKey,
  vestigiorum: Vestigiorum,
  options: VestigiumHookOptions = {}
): Promise<Vestigium> {
  const { genus = 'image', visibilitas = 'privata', promptKey = 'prompt', summaryKey } = options

  const aditus = actum.aditus ?? {}
  const exitus = actum.exitus ?? {}

  const promptum = typeof aditus[promptKey] === 'string'
    ? (aditus[promptKey] as string)
    : JSON.stringify(aditus)

  const summarium = resolveSummarium(exitus, summaryKey)

  const v = await vestigiorum.create({
    actumId: actum.id,
    modusId: actum.modusId,
    modusVersiono: actum.modusVersiono,
    modoId: actum.modoId,
    auctorKey,
    promptum,
    summarium,
    genus,
    visibilitas,
  })

  // Fire-and-forget: index asynchronously if embed is configured
  vestigiorum.index(v.id).catch(() => {})

  return v
}

function resolveSummarium(exitus: Record<string, unknown>, summaryKey?: string): string {
  if (summaryKey && typeof exitus[summaryKey] === 'string') return exitus[summaryKey] as string
  if (typeof exitus.caption === 'string') return exitus.caption
  if (typeof exitus.text === 'string') return exitus.text
  if (typeof exitus.summarium === 'string') return exitus.summarium
  return ''
}
