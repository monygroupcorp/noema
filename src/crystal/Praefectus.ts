import type { Materia, MateriaStore } from '../types/materia.js'

/**
 * Praefectus — warm GPU pool scheduler.
 *
 * "Praefectus" = commander/overseer in Latin — the one who decides which pod
 * handles each incoming job.
 *
 * Routing paths:
 *   findWarm(imageRef)           — standard: any idle pod running the image
 *   findWarm(imageRef, economy)  — economy queue: only economy-policy pods
 *   findByShareToken(token)      — link-share: the specific pod behind a link
 */
export class Praefectus {
  constructor(private readonly materiae: MateriaStore) {}

  /**
   * Find an idle warm pod running the requested image.
   *
   * Pass forEconomy: true to restrict to pods that have opted into the
   * economy pool (podPolicy: 'economy'). Economy jobs must not consume
   * pods whose owners requested privacy.
   *
   * Returns null when no compatible warm pod is available.
   */
  async findWarm(imageRef: string, options?: { forEconomy?: boolean }): Promise<Materia | null> {
    return this.materiae.findWarm({
      imageRef,
      ...(options?.forEconomy ? { podPolicy: 'economy' as const } : {}),
    })
  }

  /**
   * Find the pod behind a share link.
   *
   * Returns the pod if it is idle and the token matches, null otherwise.
   * Callers should verify the pod's imageRef is compatible with the requested Modus.
   */
  async findByShareToken(shareToken: string): Promise<Materia | null> {
    return this.materiae.findWarm({ shareToken })
  }
}
