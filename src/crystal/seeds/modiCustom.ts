// =============================================================================
// Custom modi — authored (non-canonical) flagship flows seeded at boot.
// =============================================================================
//
// These are NOT canonical platform tools (canonica:false) — they are real
// authored forks of a canonical Essentia, "one degree off": a deriveSavedModus
// fork that bakes a pinned prompt + loadout, owned by an AuctorKey, linked to
// its parent via `fonte`. Registered alongside the canon on boot.

import type { Modus } from '../../types/modus.js'
import { deriveSavedModus } from '../deriveSavedModus.js'
import { ESSENTIA_KLEINEDIT_4B } from './essentiae.js'

// The dialed-in PS2 recipe. Leads with the explicit `<lora:…:1.05>` tag — the loraResolver's Pass 1
// passes it through verbatim because `impresstation_klein` is a known (canonica flux2) LoRA, and the
// Coziness MultiLoraLoader stacks it at weight 1.05. The rest is the "emulator-upscaled, not blurry,
// not clinical" instruction we locked in.
const STATIONTHIS_PROMPT =
  '<lora:impresstation_klein:1.05> low poly playstation screenshot style. A low-poly PlayStation 2 ' +
  'era 3D model, lightly upscaled like a PS2 emulator running at 2x internal resolution: keep the ' +
  'chunky low-polygon geometry and flat-shaded surfaces, with cleaner, moderately sharp edges and ' +
  'readable textures — but keep a gentle retro softness and a little texture warmth. Slightly crisp, ' +
  'not razor-sharp; clean but not clinical. Extrude any flat 2D elements into solid 3D polygonal forms ' +
  'with real depth and foreshortening. A nicely emulated PS2 screenshot — clearer than the console, ' +
  'softer than 4K.'

// STATIONTHIS — the flagship custom modus. Forked from klein-edit-4b (fonte), owned by monyrth
// (anima tg:5472638766), prompt pinned to the recipe above, steps baked to 9, the impresstation-klein
// LoRA pinned into the weight manifest so the pod downloads it. The runnable name is `stationthis`;
// callers supply only an image.
export const STATIONTHIS: Modus = deriveSavedModus(ESSENTIA_KLEINEDIT_4B, {
  slug: 'stationthis',
  name: 'STATIONTHIS',
  owner: { animaId: 'ca162446-6c2b-447c-8ed7-9f22f90d8cea' },
  promptMode: 'pinned',
  aditus: { prompt: STATIONTHIS_PROMPT, steps: 9 },
  pinned: [{ id: 'intella.impresstation-klein' }],
})

/** Authored flagship modi — seeded after the canonical essentiae they fork from. */
export const CANONICAL_CUSTOM_MODI: Modus[] = [STATIONTHIS]
