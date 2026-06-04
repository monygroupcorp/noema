import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLoraTriggers, setLoraWeight } from '../../../src/crystal/loraResolver.js'
import type { Intella, Intellae } from '../../../src/types/intelligendi.js'

// ── fixture helpers ──────────────────────────────────────────────────────────

function makeIntella(over: Partial<Intella>): Intella {
  return {
    id: over.id ?? `intella.${over.slug ?? over.trigger ?? 'x'}`,
    nomen: over.nomen ?? over.slug ?? 'x',
    genus: 'lora',
    architectura: 'lora',
    parametri: 0,
    sources: [],
    dest: 'models/loras/x.safetensors',
    sizeGb: 0.1,
    versio: '1.0.0',
    canonica: false,
    natum: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

function mapOf(...intellae: Intella[]): Map<string, Intellae> {
  const m = new Map<string, Intellae>()
  for (const i of intellae) {
    for (const raw of (i.trigger ?? '').split(',')) {
      const key = raw.trim().toLowerCase()
      if (!key) continue
      const b = m.get(key); if (b) b.push(i); else m.set(key, [i])
    }
  }
  return m
}

const MILADY  = makeIntella({ id: 'i.milady',  slug: 'milady-v3',  trigger: 'milady',  access: 'public', defaultWeight: 1.0 })
const PRIVATE = makeIntella({ id: 'i.priv',    slug: 'my-private', trigger: 'priv',    access: 'private', ownerAnimaId: 'anima-alice', defaultWeight: 1.0 })

// ── empty map / no-op ────────────────────────────────────────────────────────

test('empty trigger map: passthrough, no applied loras', () => {
  const r = resolveLoraTriggers('a portrait of a cat', { triggerMap: new Map() })
  assert.equal(r.modifiedPrompt, 'a portrait of a cat')
  assert.equal(r.appliedLoras.length, 0)
  assert.equal(r.warnings.length, 0)
})

// ── plain trigger word ──────────────────────────────────────────────────────

test('plain trigger: injects <lora:slug:1> and keeps the original word for CLIP', () => {
  const r = resolveLoraTriggers('a portrait, milady style', { triggerMap: mapOf(MILADY) })
  assert.match(r.modifiedPrompt, /<lora:milady-v3:1>/)
  assert.match(r.modifiedPrompt, /milady/)
  assert.equal(r.appliedLoras.length, 1)
  assert.equal(r.appliedLoras[0].slug, 'milady-v3')
  assert.equal(r.appliedLoras[0].weight, 1)
  assert.equal(r.appliedLoras[0].intellaId, 'i.milady')
})

// ── explicit weight ─────────────────────────────────────────────────────────

test('explicit weight (trigger:0.5) overrides defaultWeight', () => {
  const r = resolveLoraTriggers('milady:0.5 style', { triggerMap: mapOf(MILADY) })
  assert.match(r.modifiedPrompt, /<lora:milady-v3:0.5>/)
  assert.equal(r.appliedLoras[0].weight, 0.5)
})

// ── silence with :0.0 ──────────────────────────────────────────────────────

test('trigger:0.0 silences — keeps original word, applies NO LoRA', () => {
  const r = resolveLoraTriggers('milady:0.0 vibes', { triggerMap: mapOf(MILADY) })
  assert.equal(r.appliedLoras.length, 0)
  assert.ok(!r.modifiedPrompt.includes('<lora:'))
})

// ── dot/exclamation modifiers ───────────────────────────────────────────────

test('one !: +0.2 over defaultWeight', () => {
  const r = resolveLoraTriggers('milady!', { triggerMap: mapOf(MILADY) })
  assert.equal(r.appliedLoras[0].weight, 1.2)
  assert.match(r.modifiedPrompt, /<lora:milady-v3:1.2>/)
  // modifier chars CONSUMED — no ! in output
  assert.ok(!r.modifiedPrompt.includes('!'))
})

test('two !!: +0.4 over defaultWeight', () => {
  const r = resolveLoraTriggers('milady!!', { triggerMap: mapOf(MILADY) })
  assert.equal(r.appliedLoras[0].weight, 1.4)
})

test('one .: -0.2 from defaultWeight', () => {
  const r = resolveLoraTriggers('milady.', { triggerMap: mapOf(MILADY) })
  assert.equal(r.appliedLoras[0].weight, 0.8)
})

test('three ...: -0.6 from defaultWeight', () => {
  const r = resolveLoraTriggers('milady...', { triggerMap: mapOf(MILADY) })
  assert.equal(r.appliedLoras[0].weight, 0.4)
})

// ── conflict resolution ─────────────────────────────────────────────────────

test('private LoRA owned by the executor wins over a public hit on the same trigger', () => {
  // Two intellae sharing the trigger 'shared'
  const pub = makeIntella({ id: 'i.pub',  slug: 'public-shared',  trigger: 'shared', access: 'public' })
  const own = makeIntella({ id: 'i.own',  slug: 'my-shared',      trigger: 'shared', access: 'private', ownerAnimaId: 'anima-alice' })
  const r = resolveLoraTriggers('shared style', {
    triggerMap: mapOf(pub, own),
    animaId: 'anima-alice',
  })
  assert.equal(r.appliedLoras[0].slug, 'my-shared')
})

test('multiple public hits: warning emitted naming the chosen slug (most recent wins)', () => {
  const a = makeIntella({ id: 'i.a', slug: 'pub-a', trigger: 'common', access: 'public', mutatum: new Date('2026-01-01') })
  const b = makeIntella({ id: 'i.b', slug: 'pub-b', trigger: 'common', access: 'public', mutatum: new Date('2026-05-01') })
  const r = resolveLoraTriggers('common style', { triggerMap: mapOf(a, b) })
  assert.equal(r.appliedLoras[0].slug, 'pub-b')
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /Multiple public LoRAs for trigger 'common'/)
  assert.match(r.warnings[0], /Using: pub-b/)
})

// ── duplicates ──────────────────────────────────────────────────────────────

test('same trigger twice: LoRA applied once; second occurrence drops the trigger word', () => {
  const r = resolveLoraTriggers('milady cat, milady dog', { triggerMap: mapOf(MILADY) })
  // Tag appears once
  const tagCount = (r.modifiedPrompt.match(/<lora:milady-v3:1>/g) ?? []).length
  assert.equal(tagCount, 1)
  assert.equal(r.appliedLoras.length, 1)
})

// ── inline <lora:...> tag ───────────────────────────────────────────────────

test('inline <lora:slug:weight> tag with a known slug: passes through and counts as applied', () => {
  const r = resolveLoraTriggers('a portrait <lora:milady-v3:0.7> style', { triggerMap: mapOf(MILADY) })
  assert.match(r.modifiedPrompt, /<lora:milady-v3:0.7>/)
  assert.equal(r.appliedLoras.length, 1)
  assert.equal(r.appliedLoras[0].slug, 'milady-v3')
  assert.equal(r.appliedLoras[0].weight, 0.7)
})

test('inline <lora:unknown-slug> stripped with a warning', () => {
  const r = resolveLoraTriggers('a portrait <lora:unknown:1.0> style', { triggerMap: mapOf(MILADY) })
  assert.ok(!r.modifiedPrompt.includes('<lora:'))
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /unknown or inaccessible/)
})

// ── private LoRA access ─────────────────────────────────────────────────────

test('private LoRA: applies for the owner animaId', () => {
  const r = resolveLoraTriggers('priv style', { triggerMap: mapOf(PRIVATE), animaId: 'anima-alice' })
  assert.equal(r.appliedLoras.length, 1)
  assert.equal(r.appliedLoras[0].slug, 'my-private')
})

test('private LoRA: shared-private (non-owner) still applies via the shared bucket', () => {
  // animaId here is NOT the owner — the LoRA is shared-private from alice's perspective
  const r = resolveLoraTriggers('priv style', { triggerMap: mapOf(PRIVATE), animaId: 'anima-bob' })
  assert.equal(r.appliedLoras.length, 1, 'shared-private still resolves (caller already has access in the map)')
})

// ── setLoraWeight utility ───────────────────────────────────────────────────

test('setLoraWeight: updates an existing tag in place', () => {
  const out = setLoraWeight('cat <lora:milady-v3:1> dog', 'milady-v3', 0.5)
  assert.equal(out, 'cat <lora:milady-v3:0.5> dog')
})

test('setLoraWeight: unchanged when slug not present', () => {
  const out = setLoraWeight('cat dog', 'milady-v3', 0.5)
  assert.equal(out, 'cat dog')
})

// ── substring-scan: legacy multi-char / multi-word triggers ─────────────────
//
// The tokenizer-only Pass 2 can't reach triggers containing colons, spaces,
// or escaped parens. Pass 1.5 (`_substringScan`) handles these in-place.

const COLON_TRIGGER  = makeIntella({ id: 'i.colon',  slug: 'moriimee-v1', trigger: 'artist:moriimee', access: 'public', defaultWeight: 1.0 })
const PARENS_TRIGGER = makeIntella({ id: 'i.parens', slug: 'nineties-v1', trigger: '1990s \\(style\\)', access: 'public', defaultWeight: 1.0 })
const SPACE_TRIGGER  = makeIntella({ id: 'i.space',  slug: 'retro-arts',  trigger: 'retro artstyle', access: 'public', defaultWeight: 1.0 })

test('substring scan: colon-trigger resolves', () => {
  const r = resolveLoraTriggers('a moody scene, artist:moriimee mood', { triggerMap: mapOf(COLON_TRIGGER) })
  assert.match(r.modifiedPrompt, /<lora:moriimee-v1:1>/)
  assert.equal(r.appliedLoras.length, 1)
  assert.equal(r.appliedLoras[0].slug, 'moriimee-v1')
  // Trigger text preserved for CLIP
  assert.match(r.modifiedPrompt, /artist:moriimee/)
})

test('substring scan: escaped-parens trigger resolves', () => {
  const r = resolveLoraTriggers('1990s \\(style\\) photo', { triggerMap: mapOf(PARENS_TRIGGER) })
  assert.match(r.modifiedPrompt, /<lora:nineties-v1:1>/)
  assert.equal(r.appliedLoras.length, 1)
})

test('substring scan: multi-word trigger resolves', () => {
  const r = resolveLoraTriggers('a retro artstyle scene', { triggerMap: mapOf(SPACE_TRIGGER) })
  assert.match(r.modifiedPrompt, /<lora:retro-arts:1>/)
  assert.equal(r.appliedLoras.length, 1)
})

test('substring scan: explicit weight modifier applied', () => {
  const r = resolveLoraTriggers('artist:moriimee:0.5 mood', { triggerMap: mapOf(COLON_TRIGGER) })
  assert.match(r.modifiedPrompt, /<lora:moriimee-v1:0.5>/)
  assert.equal(r.appliedLoras[0].weight, 0.5)
})

test('substring scan: exclamation modifier (+0.2 each, two = +0.4)', () => {
  const r = resolveLoraTriggers('artist:moriimee!! mood', { triggerMap: mapOf(COLON_TRIGGER) })
  assert.equal(r.appliedLoras[0].weight, 1.4)
  // Modifier consumed
  assert.ok(!r.modifiedPrompt.includes('!'))
})

test('substring scan: :0.0 silences (no LoRA, keeps trigger text)', () => {
  const r = resolveLoraTriggers('artist:moriimee:0.0 mood', { triggerMap: mapOf(COLON_TRIGGER) })
  assert.equal(r.appliedLoras.length, 0)
  assert.ok(!r.modifiedPrompt.includes('<lora:'))
  assert.match(r.modifiedPrompt, /artist:moriimee/)
})

test('substring scan: overlapping triggers — longer wins', () => {
  // Both 'art' and 'artist:moriimee' would match starting at the 'a' of 'artist:'.
  // The longer (`artist:moriimee`) must win.
  const shortKey = makeIntella({ id: 'i.short', slug: 'art-generic', trigger: 'art:short', access: 'public', defaultWeight: 1.0 })
  const r = resolveLoraTriggers('artist:moriimee scene', { triggerMap: mapOf(shortKey, COLON_TRIGGER) })
  assert.equal(r.appliedLoras.length, 1)
  assert.equal(r.appliedLoras[0].slug, 'moriimee-v1')
})

test('substring scan: same trigger twice — LoRA applied once', () => {
  const r = resolveLoraTriggers('artist:moriimee cat, artist:moriimee dog', { triggerMap: mapOf(COLON_TRIGGER) })
  const tagCount = (r.modifiedPrompt.match(/<lora:moriimee-v1:1>/g) ?? []).length
  assert.equal(tagCount, 1)
  assert.equal(r.appliedLoras.length, 1)
})

test('substring scan: trigger with regex metacharacters is escaped (no false matches)', () => {
  // The trigger contains `\(` `\)` — must be regex-escaped, not interpreted.
  // A prompt with a literal `(style)` should NOT match `1990s \(style\)`.
  const r = resolveLoraTriggers('a (style) thing', { triggerMap: mapOf(PARENS_TRIGGER) })
  assert.equal(r.appliedLoras.length, 0)
  assert.ok(!r.modifiedPrompt.includes('<lora:'))
})

test('substring scan: private colon-trigger requires owner animaId', () => {
  const priv = makeIntella({
    id: 'i.privcolon', slug: 'priv-moriimee', trigger: 'artist:moriimee',
    access: 'private', ownerAnimaId: 'anima-alice', defaultWeight: 1.0,
  })
  // Owner sees it
  const r1 = resolveLoraTriggers('artist:moriimee mood', {
    triggerMap: mapOf(priv), animaId: 'anima-alice',
  })
  assert.equal(r1.appliedLoras.length, 1)
  assert.equal(r1.appliedLoras[0].slug, 'priv-moriimee')
})
