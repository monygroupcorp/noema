import type { Materia, MateriaStore } from '../types/materia.js'

/**
 * Praefectus — warm GPU pool scheduler.
 *
 * "Praefectus" = commander/overseer in Latin — the one who decides which pod
 * handles each incoming job.
 *
 * v1: single responsibility — find an idle warm pod matching the requested
 * Docker image. VRAM filtering, priority, cost optimization, and host-fee
 * dispatch are all natural next iterations layered on top of this seam.
 */
export class Praefectus {
  constructor(private readonly materiae: MateriaStore) {}

  /**
   * Find an idle warm pod running the requested image.
   *
   * Returns the first compatible Materia, or null if none are available
   * (caller should fall back to cold-start provisioning).
   */
  async findWarm(imageRef: string): Promise<Materia | null> {
    return this.materiae.findWarm({ imageRef })
  }
}
