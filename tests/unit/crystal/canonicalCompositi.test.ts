import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_COMPOSITI } from '../../../src/crystal/seeds/compositi.js'
import { CANONICAL_ESSENTIAE } from '../../../src/crystal/seeds/essentiae.js'
import type { Modus } from '../../../src/types/modus.js'

// Authoring-time gate for canonical spells (ADR-0008/0009). Validates that every
// compositus is structurally runnable AND that its ligamina line up with the REAL
// declared schemas — so a wrong wire (e.g. exitus 'imageUrl' when the source declares
// 'image') fails the build instead of silently feeding a downstream step nothing.
const REGISTRY = new Map<string, Modus>(
  [...CANONICAL_ESSENTIAE, ...CANONICAL_COMPOSITI].map(m => [m.id, m]),
)

test('there is at least one canonical compositus', () => {
  assert.ok(CANONICAL_COMPOSITI.length > 0)
})

for (const c of CANONICAL_COMPOSITI) {
  test(`canonical compositus '${c.id}' is well-formed`, () => {
    assert.equal(c.genus, 'compositus', 'genus is compositus')
    assert.ok(!c.ministerium, 'a compositus has no ministerium')
    const gradus = c.gradus ?? []
    assert.ok(gradus.length > 0, 'has gradus steps')

    for (const g of gradus) {
      const child = REGISTRY.get(g.modusId)
      assert.ok(child, `step ${g.ordine}: '${g.modusId}' is a registered canonical flow`)
      assert.equal(child!.genus, 'atomicus', `step ${g.ordine}: '${g.modusId}' is atomic (v1 is flat-only)`)

      for (const [porta, fons] of Object.entries(g.ligamina ?? {})) {
        // (a) the target port is a real aditus port on this step's modus
        assert.ok(porta in child!.aditus, `ligamen target '${porta}' is an aditus port on '${g.modusId}'`)
        // (b) the source is a strictly-earlier step
        assert.ok(fons.gradus < g.ordine, `ligamen '${porta}': source ordine ${fons.gradus} precedes step ${g.ordine}`)
        const srcStep = gradus.find(s => s.ordine === fons.gradus)
        assert.ok(srcStep, `ligamen '${porta}': source step ordine ${fons.gradus} exists`)
        const srcModus = REGISTRY.get(srcStep!.modusId)!
        // (c) THE ALIGNMENT LOCK — the source step actually DECLARES that exitus key
        assert.ok(
          fons.exitus in srcModus.exitus,
          `ligamen '${porta}': source '${srcStep!.modusId}' declares exitus '${fons.exitus}' (got: ${Object.keys(srcModus.exitus).join(', ')})`,
        )
      }
    }
  })
}
