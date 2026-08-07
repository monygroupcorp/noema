// =============================================================================
// familiaBackfill.test.ts — noema-147
//
// Guards the `params.baseIntellaId` → `familia` repair mapping used by
// `scripts/backfill-intella-familia.ts`, and encodes the production defect it repairs:
// a migrated LoRA with no `familia` is INVISIBLE to trigger resolution.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  BASE_FAMILIAE,
  FAMILIA_BY_BASE_INTELLA_ID,
  classifyBaseModel,
  familiaFromBaseIntellaId,
  isKnownBaseIntellaId,
} from '../../../src/crystal/modelLicense.js'
import type { Intella, Intellae, Intellarum } from '../../../src/types/intelligendi.js'

describe('FAMILIA_BY_BASE_INTELLA_ID', () => {
  // The load-bearing guard: the resolver matches `familia` against values BASE_TABLE produces.
  // If this map ever drifts into a private vocabulary, the backfill writes values that match
  // nothing and the defect silently returns in a new shape.
  test('every non-null value is a familia BASE_TABLE can produce', () => {
    for (const [baseId, familia] of Object.entries(FAMILIA_BY_BASE_INTELLA_ID)) {
      if (familia === null) continue
      assert.ok(
        BASE_FAMILIAE.has(familia),
        `${baseId} maps to familia='${familia}', which BASE_TABLE never produces (vocabulary: ${[...BASE_FAMILIAE].sort().join(', ')})`,
      )
    }
  })

  test('the two non-obvious collapses resolve to sdxl', () => {
    assert.equal(familiaFromBaseIntellaId('intella.pony-base'), 'sdxl')
    assert.equal(familiaFromBaseIntellaId('intella.illustrious-base'), 'sdxl')
  })

  test('the straightforward bases resolve to their own family', () => {
    assert.equal(familiaFromBaseIntellaId('intella.flux-base'), 'flux')
    assert.equal(familiaFromBaseIntellaId('intella.sdxl-base'), 'sdxl')
    assert.equal(familiaFromBaseIntellaId('intella.sd15-base'), 'sd15')
  })

  // An unmapped base-intella id needs an operator decision — collapsing it into "known" would
  // let the backfill quietly do nothing about a base nobody has classified.
  test('an unmapped base-intella id is unknown, not null', () => {
    assert.equal(familiaFromBaseIntellaId('intella.wan22-base'), null)
    assert.equal(isKnownBaseIntellaId('intella.wan22-base'), false)
  })

  // The known-but-null distinction this map exists to preserve still has a live case at the
  // BASE_TABLE level (kontext no longer supplies one): SD2/SD3 is a real, recognized base with
  // no base flow, vs. a string BASE_TABLE has never heard of.
  test('a recognized-but-baseless model is distinguishable from an unrecognized one', () => {
    const sd3 = classifyBaseModel('SD 3.5 Large')
    assert.equal(sd3.familia, null)
    assert.equal(sd3.license, 'stability-community')

    const unrecognized = classifyBaseModel('some-model-nobody-has-heard-of')
    assert.equal(unrecognized.familia, null)
    assert.equal(unrecognized.license, 'unknown')
  })

  test('null/undefined/empty ids are unknown, never silently mapped', () => {
    for (const id of [null, undefined, '']) {
      assert.equal(isKnownBaseIntellaId(id), false)
      assert.equal(familiaFromBaseIntellaId(id), null)
    }
  })

  // Object.prototype pollution must not read as a known base (a `constructor`/`toString`
  // baseIntellaId would otherwise pass a naive `in`/truthy membership check).
  test('inherited Object.prototype keys are not known bases', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(isKnownBaseIntellaId(id), false, `${id} must not read as a known base`)
      assert.equal(familiaFromBaseIntellaId(id), null)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Regression: the exact production failure.
//
// `MongoIntella.findByTrigger` / `triggerMap` query `{ genus:'lora', familia, … }` with EXACT
// top-level equality (MongoIntella.ts:148 / :171). FakeIntellarum below reproduces that rule
// faithfully — familia equality, genus, public access, trigger-word match — so a document
// missing `familia` matches nothing, exactly as it does in Mongo.
// ─────────────────────────────────────────────────────────────────────────────

/** A v2 intella document as it sits in the collection (pre-projection). */
type IntellaDoc = Record<string, unknown>

class FakeIntellarum implements Pick<Intellarum, 'findByTrigger' | 'triggerMap'> {
  constructor(private readonly docs: IntellaDoc[]) {}

  /** Mirrors projectV2ToV1: v2 `params.triggerWords[]` → v1 comma-separated `trigger` string. */
  private project(doc: IntellaDoc): Intella {
    const p = (doc.params ?? {}) as Record<string, unknown>
    const { params: _params, ...rest } = doc
    return {
      ...rest,
      trigger: ((p.triggerWords as string[] | undefined) ?? []).join(','),
      baseIntellaId: p.baseIntellaId,
    } as unknown as Intella
  }

  /** Mirrors `{ genus:'lora', familia, <public access> }` — familia is EXACT top-level equality. */
  private candidates(familia: string): IntellaDoc[] {
    return this.docs.filter(d => {
      if (d.genus !== 'lora') return false
      if (d.familia !== familia) return false          // ← the whole defect lives on this line
      const access = d.access as { kind?: string } | undefined
      return access?.kind === 'public'
    })
  }

  async findByTrigger(trigger: string, familia: string): Promise<Intellae> {
    const t = trigger.toLowerCase()
    return this.candidates(familia)
      .filter(d => {
        const words = (((d.params ?? {}) as Record<string, unknown>).triggerWords as string[] | undefined) ?? []
        return words.some(w => w.toLowerCase().includes(t))
      })
      .map(d => this.project(d))
  }

  async triggerMap(familia: string): Promise<Map<string, Intellae>> {
    const map = new Map<string, Intellae>()
    for (const doc of this.candidates(familia)) {
      const intella = this.project(doc)
      for (const raw of (intella.trigger ?? '').split(',')) {
        const key = raw.trim().toLowerCase()
        if (!key) continue
        const bucket = map.get(key)
        if (bucket) bucket.push(intella)
        else map.set(key, [intella])
      }
    }
    return map
  }
}

/** Shaped like a real migrated LoRA: a user-trained model carrying trigger words and a base id,
 *  with no familia — exactly what the v1->v2 migration produced. */
function migratedLoraDoc(overrides: IntellaDoc = {}): IntellaDoc {
  return {
    id: 'intella.sample-lora',
    nomen: 'Sample LoRA',
    genus: 'lora',
    access: { kind: 'public' },
    params: {
      triggerWords: ['trigword'],
      baseIntellaId: 'intella.flux-base',
    },
    ...overrides,
  }
}

describe('trigger resolution regression — a migrated LoRA without familia', () => {
  test('resolves to NOTHING when familia is absent (the production defect)', async () => {
    const intellarum = new FakeIntellarum([migratedLoraDoc()])

    assert.deepEqual(await intellarum.findByTrigger('trigword', 'flux'), [])
    assert.equal((await intellarum.triggerMap('flux')).size, 0)
  })

  test('resolves once familia is backfilled from params.baseIntellaId', async () => {
    const familia = familiaFromBaseIntellaId('intella.flux-base')
    assert.equal(familia, 'flux')

    const intellarum = new FakeIntellarum([migratedLoraDoc({ familia })])

    const hits = await intellarum.findByTrigger('trigword', 'flux')
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.id, 'intella.sample-lora')

    const map = await intellarum.triggerMap('flux')
    assert.equal(map.get('trigword')?.length, 1)
  })

  test('the backfilled familia does not leak into a different family', async () => {
    const intellarum = new FakeIntellarum([migratedLoraDoc({ familia: 'flux' })])

    assert.deepEqual(await intellarum.findByTrigger('trigword', 'sdxl'), [])
    assert.equal((await intellarum.triggerMap('sdxl')).size, 0)
  })

  // Kontext is flux1-family, so the repair mapping backfills it like any other base and it
  // resolves inside flux flows.
  test('a kontext LoRA resolves once familia is backfilled', async () => {
    const familia = familiaFromBaseIntellaId('intella.kontext-base')
    assert.equal(familia, 'flux')

    const doc = migratedLoraDoc({
      id: 'intella.kontext-lora',
      familia,
      params: { triggerWords: ['konty'], baseIntellaId: 'intella.kontext-base' },
    })

    const intellarum = new FakeIntellarum([doc])
    const hits = await intellarum.findByTrigger('konty', 'flux')
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.id, 'intella.kontext-lora')
  })
})
