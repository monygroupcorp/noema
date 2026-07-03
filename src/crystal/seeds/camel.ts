// =============================================================================
// CAMEL seed — the trusted issuer, the treasury Anima, and the starter template.
// =============================================================================
//
// Exact prod seed (from `provision-camelcabal-treasury.js`, ADR-0011 §8):
//   Issuer  { issuerId:'https://camelcabal.fun', name:'CAMEL', jwksUrl:… }
//   Treasury{ treasuryId:'camelcabal-1', issuerDomain:'camelcabal.fun', balance:0 }
//           → an ordinary Anima (id === treasuryId), funded manually (faucet off)
//   starterWorkspaceSlug → template compositus `918b546f`
//
// The template is the "CamelMemify" spell shape: a prompt (left open for the caster)
// plus an `input_second_image` slot that provisioning bakes to the agent's NFT image.
// It invokes the `kontext-edit` image-edit essentia. (The exact multi-image client
// graph is imported at go-live; this seed is the runnable-shaped placeholder the
// clone contract operates on.)

import type { Db } from 'mongodb'
import type { Modus, Modorum } from '../../types/modus.js'
import type { IssuerStore } from '../../types/issuer.js'
import type { TreasuryConfig } from '../AgentProvisioner.js'
import { hashModus } from '../hashModus.js'

export const CAMEL_ISSUER = {
  issuerId: 'https://camelcabal.fun',
  name: 'CAMEL',
  jwksUrl: 'https://camelcabal.fun/.well-known/jwks.json',
} as const

/** The one prod treasury. treasury Anima id === treasuryId (ADR: treasury = Anima). */
export const CAMEL_TREASURY: TreasuryConfig = {
  treasuryId: 'camelcabal-1',
  animaId: 'camelcabal-1',
  issuerId: CAMEL_ISSUER.issuerId,
  templateModusId: '918b546f',
  nftImageInputKey: 'input_second_image',
  starterGrant: 0n, // faucet off — grants are manual admin top-ups
  status: 'active',
}

/** The "CamelMemify" starter template — a compositus spell, id === starterWorkspaceSlug. */
export const CAMEL_TEMPLATE_MODUS: Modus = {
  id: '918b546f',
  nomen: 'CamelMemify',
  genus: 'compositus',
  versio: '1.0.0',
  contentHash: '', // set on registration via hashModus()
  canonica: true,

  aditus: {
    // Open — the caster's edit instruction.
    prompt: { type: 'text', required: true, description: 'What to do with the image' },
    // The NFT slot — provisioning bakes the agent's NFT image here (required:false after bake).
    input_second_image: { type: 'image', required: true, description: 'The agent NFT image (baked at provisioning)' },
  },
  exitus: { image: { type: 'image', description: 'The memeified image' } },

  gradus: [
    { ordine: 0, modusId: 'kontext-edit' },
  ],

  natum: new Date('2026-07-02'),
  mutatum: new Date('2026-07-02'),
}

export interface SeedCamelDeps {
  issuers: Pick<IssuerStore, 'upsert' | 'findByIssuerId'>
  modorum: Pick<Modorum, 'find' | 'register'>
  /** Raw Db to upsert the treasury Anima with a fixed id (AnimaStore.create assigns a uuid). */
  db: Db
  animaeCollection?: string
}

/** Idempotently seed the CAMEL issuer, treasury Anima, and starter template. */
export async function seedCamel(deps: SeedCamelDeps): Promise<void> {
  await deps.issuers.upsert({ ...CAMEL_ISSUER })

  // Treasury = an ordinary Anima with a fixed id (=== treasuryId). Upsert, don't clobber.
  const now = new Date()
  await deps.db.collection(deps.animaeCollection ?? 'animae').updateOne(
    { id: CAMEL_TREASURY.animaId },
    { $setOnInsert: { id: CAMEL_TREASURY.animaId, nomen: 'CamelCabal Treasury', natum: now, mutatum: now } },
    { upsert: true },
  )

  // Register the template compositus if absent, content-hash sealed.
  const existing = await deps.modorum.find(CAMEL_TEMPLATE_MODUS.id)
  if (!existing) {
    const sealed = { ...CAMEL_TEMPLATE_MODUS, contentHash: hashModus(CAMEL_TEMPLATE_MODUS) }
    await deps.modorum.register(sealed)
  }
}
