// =============================================================================
// TABULA — the canvas workspace
// =============================================================================
//
// "Tabula" = tablet, board, panel, writing surface (Latin, 1st declension
// feminine). A tabula rasa is a blank slate. In Roman administration, the
// tabula was the surface on which plans were drawn and agreements recorded.
//
// A Tabula is the authoring layer above a Modus. Where a Modus is a
// published, versioned, content-addressed artifact, a Tabula is the
// living draft on the canvas — visual, mutable, shareable, forkable.
//
// SEPARATION OF CONCERNS:
//   Tabula  — visual layout, authoring state, draft (what the canvas sees)
//   Modus   — published artifact, content-addressed, immutable (what runs)
//
// When a Tabula is published, it materialises into a compositus Modus
// in the Modorum registry. The Tabula keeps a pointer to its published Modus.
// Remixing a Tabula forks the Tabula, not the Modus.
//
// WHY THIS SOLVES THE "UNWIELDY" PROBLEM:
//   The existing workspace system conflates visual state, execution state,
//   and spell definitions. Splitting Tabula (authoring) from Modus (artifact)
//   means neither contaminates the other's lifecycle or access patterns.
// =============================================================================

import type { AuctorKey } from '../flow/types.js'
export type { AuctorKey }

/**
 * TabulaNodus — a node placed on the canvas.
 * "nodus" = knot/node in Latin — a point of connection.
 */
export interface TabulaNodus {
  /** Unique within this Tabula */
  id: string
  /** FK → Modus or Essentia. What this node represents */
  modusId: string
  /** Canvas position */
  x: number
  y: number
  /**
   * Per-node aditus overrides — values set in the node's parameter panel.
   * These become the Porta.default values when published to a Modus.
   */
  aditus: Record<string, unknown>
}

/**
 * TabulaVinculum — a connection between two nodes on the canvas.
 * "vinculum" = bond/chain in Latin — what binds two nodes together.
 */
export interface TabulaVinculum {
  id: string
  /** FK → TabulaNodus.id */
  fonteNodusId: string
  /** Output port name on the source node */
  fontePorta: string
  /** FK → TabulaNodus.id */
  scopusNodusId: string
  /** Input port name on the target node */
  scopusPorta: string
  /**
   * True when fonte.porta type ≠ scopus.porta type.
   * Allowed but flagged — the user is warned, execution may fail.
   */
  discordantia: boolean
}

export type TabulaVisibility = 'privata' | 'communis' | 'publica'
// privata  → visible only to auctor
// communis → visible to anyone with the link
// publica  → listed in the public marketplace

export type TabulaStatus = 'draft' | 'published' | 'archivata'

/**
 * Tabula — a canvas workspace.
 *
 * The visual authoring surface for composing modi. Lives independently of
 * the Modus it may eventually produce. Can be shared, forked, and iterated
 * without affecting published execution artifacts.
 */
export interface Tabula {
  id: string
  /** "nomen" = name in Latin — the workspace's title */
  nomen: string
  /** Optional description for the marketplace listing */
  descriptio?: string

  /**
   * "auctor" = author — who created this workspace. Reuses the crystal's identity
   * union (`AuctorKey` = `{ animaId } | { commitment } | { bursaToken }`, the same
   * shape `Modus.auctor` carries) so anonymous (commitment/purse) authors are owners
   * too, not just identified souls.
   */
  auctor: AuctorKey

  /** The nodes placed on the canvas */
  nodi: TabulaNodus[]
  /** The connections between nodes */
  vincula: TabulaVinculum[]

  /**
   * FK → Modus. Set when this Tabula has been published.
   * The published Modus is content-addressed and immutable.
   * The Tabula continues to exist as the mutable authoring layer above it.
   */
  modusId?: string

  status: TabulaStatus
  visibilitas: TabulaVisibility

  /**
   * FK → Tabula. If this workspace was forked from another, points to the
   * original. Preserves attribution chain for royalties.
   */
  fonteId?: string

  /**
   * FK → Tabula. The master workspace this Tabula derives from.
   * Set on agent workspaces in a fleet — points to the admin's master Tabula.
   * Absent on standalone and forked workspaces.
   */
  templateId?: string

  /**
   * When true, this Tabula tracks its templateId and re-applies its
   * agent-specific nodi[].aditus overrides whenever the master publishes
   * a new Modus version. The base structure refreshes; the bindings survive.
   * Only meaningful when templateId is set.
   */
  followTemplate?: boolean

  /** "natum" = born — when this workspace was created */
  natum: Date
  /** "mutatum" = changed — when this workspace was last saved */
  mutatum: Date
}

/** "Tabulae" — nominative plural of tabula */
export type Tabulae = Tabula[]

/**
 * Tabularum — genitive plural "of the tablets."
 * The workspace store.
 */
export interface Tabularum {
  find(id: string): Promise<Tabula | null>
  list(filter?: Partial<Pick<Tabula, 'auctor' | 'status' | 'visibilitas'>>): Promise<Tabulae>
  create(tabula: Omit<Tabula, 'id' | 'natum' | 'mutatum' | 'nodi' | 'vincula'>): Promise<Tabula>
  update(id: string, patch: Partial<Pick<Tabula, 'nomen' | 'descriptio' | 'nodi' | 'vincula' | 'status' | 'visibilitas' | 'modusId' | 'mutatum'>>): Promise<Tabula>
  /** Delete a Tabula outright. Idempotent — deleting an already-gone id is a no-op. */
  remove(id: string): Promise<void>
  /**
   * Fork a Tabula — creates a new draft owned by newAuctor, pointing
   * back to the original via fonteId.
   */
  fork(id: string, newAuctor: AuctorKey): Promise<Tabula>

  /**
   * Return all Tabulae derived from a given template.
   * Used by the propagation service when the admin publishes a new master Modus.
   */
  listDerived(templateId: string): Promise<Tabulae>
}
