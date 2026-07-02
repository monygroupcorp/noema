// =============================================================================
// deriveAgentWorkspace — clone the CAMEL starter template into a private, NFT-baked
// agent workspace (ADR-0011 §6 + §8 clone contract).
// =============================================================================
//
// The legacy `WorkspaceFactory.provisionAgentWorkspace` did three things to the
// template spell: (1) strip agent-context scaffolding windows/connections, (2) bake
// the NFT image into the target step as a `static` input and remove that key from
// `exposedInputs`, (3) substitute `$NFT_*` placeholders. On crystal this is a thin
// helper over `deriveSavedModus`:
//
//   • The compositus `Modus` has no "agent-context windows" — that was canvas
//     scaffolding the Modus model simply doesn't carry, so (1) is inherent.
//   • Baking = set the target compositus `aditus` Porta's `default` to the NFT URL
//     and flip `required:false` — so the caster is never asked for it. The compiler
//     binds the child step's input BY NAME from the compositus aditus (ligamina
//     precedence: `explicit ligamen > compositus aditus by name > child default`),
//     so this static IS honored at runtime — the crystal-native equivalent of the
//     legacy step-level `{type:'static'}` (legacy spell-level mappings were dropped;
//     the compositus aditus is not).
//   • `$NFT_*` placeholders are substituted across the derived modus's string fields.
//
// The result is a private (`canonica:false`, owner=`{animaId}`), content-hashed
// derived `Modus` linked to the template via `fonte` — reusing the whole saved-flow
// provenance model. No git-style revision sync (ADR §6 drops it).

import type { Modus } from '../types/modus.js'
import { deriveSavedModus } from './deriveSavedModus.js'
import { hashModus } from './hashModus.js'

export interface AgentNftBinding {
  /** The compositus `aditus` port that receives the NFT image, e.g. `input_second_image`. */
  imageInputKey: string
  /** The resolved (R2-mirrored or direct) NFT image URL to bake as the static default. */
  imageUrl: string
}

export interface DeriveAgentWorkspaceOpts {
  /** Global-unique id/slug for the agent's private workspace modus. */
  slug: string
  /** Display name (post `$NFT_*` substitution). */
  name: string
  /** The agent's Anima id — owns the derived private modus. */
  animaId: string
  /** The NFT image slot bake (image URL → a compositus aditus port). */
  nft: AgentNftBinding
  /**
   * `$NFT_*` placeholder → value map, substituted across the derived modus's string
   * fields (name, labels, descriptions, prompt affixes). E.g. `$NFT_NAME` → the NFT name.
   */
  placeholders?: Record<string, string>
  versio?: string
}

/** Substitute `$NFT_*` placeholders across every string in a modus (JSON round-trip,
 *  same technique as the legacy `_substituteSnapshot`). */
function substitutePlaceholders<M extends Modus>(modus: M, placeholders: Record<string, string>): M {
  const entries = Object.entries(placeholders)
  if (entries.length === 0) return modus
  let raw = JSON.stringify(modus)
  for (const [ph, value] of entries) {
    // Strip the outer quotes JSON.stringify adds so the escaped value splices into the serialized JSON.
    const escaped = JSON.stringify(String(value ?? '')).slice(1, -1)
    raw = raw.split(ph).join(escaped)
  }
  return JSON.parse(raw) as M
}

/**
 * Derive a private, NFT-baked agent workspace modus from the starter template.
 * Throws if the template does not declare the NFT image input port in its `aditus`.
 */
export function deriveAgentWorkspace<M extends Modus>(template: M, opts: DeriveAgentWorkspaceOpts): M {
  const { imageInputKey, imageUrl } = opts.nft
  if (!template.aditus[imageInputKey]) {
    throw Object.assign(
      new Error(`Template '${template.id}' has no aditus port '${imageInputKey}' to bake the NFT image into`),
      { code: 'TEMPLATE_SLOT_MISSING' },
    )
  }

  // Bake the NFT image as the port's default via the saved-flow deriver (prompt stays open).
  let derived = deriveSavedModus(template, {
    slug: opts.slug,
    name: opts.name,
    owner: { animaId: opts.animaId },
    aditus: { [imageInputKey]: imageUrl },
    promptMode: 'open',
    ...(opts.versio ? { versio: opts.versio } : {}),
  })

  // "Remove from exposedInputs": a baked port is no longer a required input the caster answers.
  derived = {
    ...derived,
    aditus: {
      ...derived.aditus,
      [imageInputKey]: { ...derived.aditus[imageInputKey], required: false },
    },
  }

  // $NFT_* substitution across string fields, then re-seal the content hash. The
  // JSON round-trip inside substitutePlaceholders would flatten Date fields to ISO
  // strings, so restore the two Modus dates afterward (they carry no placeholders).
  if (opts.placeholders) {
    const { natum, mutatum } = derived
    derived = substitutePlaceholders(derived, opts.placeholders)
    derived.natum = natum
    derived.mutatum = mutatum
  }
  derived.contentHash = hashModus(derived)
  return derived
}
