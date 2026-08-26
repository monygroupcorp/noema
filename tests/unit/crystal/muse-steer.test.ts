// The steer half of Muse: an instruction and a floor in, a vetoable PROPOSAL out. Pins the
// properties a steer depends on before any of it reaches a provider — validation as the single
// point (so a proposal only ever names changes the user can honestly accept or reject), the
// bounds enforced before the reservation, its own ministerium (so the hosted-API provider
// registrations and the decomposer both survive), and a closed door when no chat provider is
// registered.
//
// The property the whole feature rests on is that a steer PROPOSES and never applies. Its
// cursor-level half is here — this cursor holds no store and takes no resource id, so there is
// nothing it could write — and its route-level half is in
// `tests/unit/allocutio/api/museSessionRoutes.test.ts`, which drives the real route against a
// session store whose every mutator throws.
//
// Hermetic by construction: a fake transport, no Mongo and no network. It therefore says nothing
// about what a real model answers, only about what is done with the answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MuseSteerCursor,
  MUSE_STEER_MINISTERIUM,
  DEFAULT_STEER_BASE_TOKENS,
  DEFAULT_TOKENS_PER_FLOOR_FRAGMENT,
  type ChatProviderBinding,
} from '../../../src/crystal/MuseSteerCursor.js'
import {
  MAX_FLOOR_FRAGMENTS,
  MAX_INSTRUCTION_CHARS,
  STEER_SOURCE,
  parseProposal,
  steerMessages,
  validateProposal,
  type FragmentIdentity,
} from '../../../src/crystal/muse/steer.js'
import { CATEGORIES, fragmentKey } from '../../../src/crystal/muse/taxonomy.js'
import { ApiCursor, httpApiTransport } from '../../../src/crystal/ApiCursor.js'
import {
  API_PROVIDERS,
  OPENROUTER_PROVIDER,
  chatImpetus,
} from '../../../src/crystal/apiProviders.js'
import { SimpleCursorum } from '../../../src/crystal/SimpleCursorum.js'
import { MuseDecomposeCursor } from '../../../src/crystal/MuseDecomposeCursor.js'
import {
  MODUS_MUSE_STEER,
  MODUS_DATASET_DECOMPOSE,
  MODUS_CHATGPT,
  MODUS_DALLE_III,
  MODUS_OPENROUTER_CHAT,
  MODUS_VENICE_CHAT,
  CANONICAL_MODI,
} from '../../../src/crystal/seeds/modi.js'
import { resolveCanonVerb } from '../../../src/crystal/verbResolver.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { FetchLike } from '../../../src/crystal/muse/garden.js'

// ── fakes ────────────────────────────────────────────────────────────────────
// Invented content throughout: an imaginary moodboard's phrases. Nothing here is
// lifted from a real record.

const FLOOR: FragmentIdentity[] = [
  { category: 'subject', text: 'a lantern-keeper' },
  { category: 'style', text: 'ink wash' },
  { category: 'lighting', text: 'neon glare' },
]

/** A chat transport that answers with a fixed proposal and reports token usage. */
type FakeChat = { calls: number; sent: Array<Record<string, unknown>>; fetchImpl: FetchLike }
function fakeChat(answer: unknown, tokens = 100): FakeChat {
  const chat: FakeChat = {
    calls: 0,
    sent: [],
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '' }),
  }
  chat.fetchImpl = async (_url, init) => {
    chat.calls++
    chat.sent.push(JSON.parse(init.body) as Record<string, unknown>)
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(answer) } }],
      usage: { total_tokens: tokens },
    })
    return { ok: true, status: 200, text: async () => body }
  }
  return chat
}

const binding = (): ChatProviderBinding => ({ provider: OPENROUTER_PROVIDER, apiKey: 'test-key' })

const actum = (aditus: Record<string, unknown>, impetus = 10_000n): Actum =>
  ({ id: 'act-steer', aditus, impetus } as unknown as Actum)

const modus = (over: Partial<Modus> = {}): Modus => ({ ...MODUS_MUSE_STEER, ...over }) as Modus

const aditusFor = (instruction: string, floor: FragmentIdentity[] = FLOOR) => ({ instruction, floor })

/** Run one steer against a fixed answer and return the exitus record. */
async function steer(answer: unknown, over: Record<string, unknown> = {}) {
  const chat = fakeChat(answer)
  const cursor = new MuseSteerCursor({ providers: [binding()], fetchImpl: chat.fetchImpl })
  const result = await cursor.run(actum({ ...aditusFor('lose the neon'), ...over }))
  assert.equal(result.kind, 'sync')
  const exitus = (result as { exitus: { exitus: Record<string, unknown> } }).exitus.exitus
  return { chat, exitus, proposal: exitus.proposal as ReturnType<typeof validateProposal> }
}

// ── PROOF 1: an elimination the floor does not hold is dropped, and counted ──

test('an elimination naming a fragment the floor does not hold is dropped from the proposal, and the drop is counted', () => {
  // A proposal that names a fragment nobody has is a pill the user cannot honestly veto:
  // rejecting it changes nothing and accepting it changes nothing. Reverting the floor check
  // in `validateProposal` reds this.
  const validated = validateProposal(
    {
      eliminations: [
        { category: 'lighting', text: 'neon glare' },         // on the floor
        { category: 'lighting', text: 'a light nobody has' }, // not on the floor
        { category: 'lighting', text: 'neon glare' },         // the same change twice
        { category: 'subject', text: 'ink wash' },            // held text, wrong category
      ],
    },
    FLOOR,
  )

  assert.deepEqual(validated.eliminations, [{ category: 'lighting', text: 'neon glare' }])
  assert.equal(validated.dropped, 3, 'the unheld fragment, the repeat and the miscategorised one are counted')
  assert.equal(validated.additions.length, 0)
})

test('a fragment identity is matched by the taxonomy key rule, not by a second one invented here', () => {
  // `fragmentKey` is case- and whitespace-insensitive on the text. An elimination quoting a
  // held fragment with different casing IS the held fragment, and survives.
  const validated = validateProposal(
    { eliminations: [{ category: 'style', text: '  Ink Wash  ' }] },
    FLOOR,
  )
  assert.equal(validated.eliminations.length, 1)
  assert.equal(
    fragmentKey(validated.eliminations[0]),
    fragmentKey({ category: 'style', text: 'ink wash' }),
  )
  assert.equal(validated.dropped, 0)
})

// ── PROOF 2: an addition outside the taxonomy is dropped ─────────────────────

test('an addition whose category is outside the taxonomy is dropped', () => {
  // `CATEGORIES` in crystal/muse/taxonomy.ts is the only list. A fragment filed outside it
  // would sit on the floor, count towards its totals, and never be drawn — the sampler walks
  // the categories. Reverting the category check reds this.
  const validated = validateProposal(
    {
      additions: [
        { category: 'mood', text: 'hushed and expectant' }, // in the taxonomy
        { category: 'vibe', text: 'something else' },       // not a category
        { category: '', text: 'no category at all' },
        { category: 'palette', text: '   ' },               // blank text
        { category: 'style', text: 'ink wash' },            // already on the floor
      ],
    },
    FLOOR,
  )

  assert.deepEqual(
    validated.additions.map((f) => `${f.category}:${f.text}`),
    ['mood:hushed and expectant'],
  )
  assert.equal(validated.dropped, 4)
  for (const addition of validated.additions) {
    assert.ok(CATEGORIES.includes(addition.category), 'every addition is in the taxonomy')
    // Attribution is stated rather than inferred: a proposed fragment came from no moodboard
    // entry and binds no model, so its trigger is empty and `roll.ts` attaches nothing.
    assert.equal(addition.source, STEER_SOURCE)
    assert.equal(addition.trigger, '')
  }
})

test('a malformed or hallucinated answer is normal input: an empty proposal, never a throw', () => {
  // A throw here would bill the user for a run that produced nothing.
  assert.deepEqual(parseProposal('not json at all'), {})
  assert.deepEqual(parseProposal(JSON.stringify({ choices: [{ message: { content: 'nope' } }] })), {})

  const validated = validateProposal(
    { eliminations: 'not an array' as unknown, additions: [{ text: 42 }, null as unknown] },
    FLOOR,
  )
  assert.deepEqual(validated.eliminations, [])
  assert.deepEqual(validated.additions, [])
  assert.equal(validated.dropped, 2, 'the two unusable additions are counted, the bad list is not')
})

// ── PROOF 3 (cursor half): a steer performs no session write ─────────────────

test('the steer cursor holds no store and is never handed a resource id — there is nothing it can write', async () => {
  // The central property (S9): a steer PROPOSES and never applies. The route-level proof lives
  // in museSessionRoutes.test.ts against a recording session store; this is the structural half.
  // `MuseSteerCursorDeps` carries providers and knobs only, and the floor arrives inline as a
  // value — so the cursor cannot resolve a session even if a future author handed it an id.
  const { chat, proposal } = await steer({
    eliminations: [{ category: 'lighting', text: 'neon glare' }],
    additions: [{ category: 'lighting', text: 'dusk glow' }],
  })

  assert.equal(chat.calls, 1, 'one chat call, in process')
  assert.equal(proposal.eliminations.length, 1)
  assert.equal(proposal.additions.length, 1)

  // Nothing in the aditus this cursor reads names a session, and nothing it returns has been
  // applied: what comes back is a proposal, and the floor routes are what move a floor.
  const cursor = new MuseSteerCursor({ providers: [binding()] })
  assert.deepEqual(
    Object.keys(cursor as unknown as Record<string, unknown>),
    ['deps'],
    'the cursor holds its deps and nothing else',
  )
  const deps = (cursor as unknown as { deps: Record<string, unknown> }).deps
  assert.deepEqual(Object.keys(deps), ['providers'], 'no store of any kind is wired into a steer')
})

test('the exitus carries the honest counts and the typed proposal beside them', async () => {
  const { exitus, proposal } = await steer({
    eliminations: [
      { category: 'lighting', text: 'neon glare' },
      { category: 'lighting', text: 'a light nobody has' },
    ],
    additions: [{ category: 'lighting', text: 'dusk glow' }],
  })

  assert.equal(exitus.eliminations, 1)
  assert.equal(exitus.additions, 1)
  assert.equal(exitus.dropped, 1)
  assert.deepEqual(Object.keys(MODUS_MUSE_STEER.exitus).sort(), ['additions', 'dropped', 'eliminations'])
  // The proposal rides as an object rather than as JSON stuffed into a string port.
  assert.equal(typeof proposal, 'object')
  assert.deepEqual(proposal.eliminations, [{ category: 'lighting', text: 'neon glare' }])
})

test('the floor is rendered into the prompt in category order, and the instruction is quoted', async () => {
  const { chat } = await steer({}, aditusFor('lose the neon'))
  const sent = chat.sent[0] as { messages: Array<{ role: string; content: string }>; temperature: number; response_format: unknown }
  assert.equal(sent.messages[0].role, 'system')
  assert.match(sent.messages[1].content, /lose the neon/)
  assert.match(sent.messages[1].content, /lighting: neon glare/)
  assert.deepEqual(sent.response_format, { type: 'json_object' })
  assert.ok(sent.temperature <= 0.3, 'a low temperature, as the decomposer uses')

  // The same floor always renders the same prompt: a steer is a function of its inputs.
  assert.deepEqual(steerMessages('lose the neon', FLOOR), steerMessages('lose the neon', [...FLOOR]))
})

// ── PROOF 4: the caps are checked before the reservation and before the wire ─

test('an instruction or a floor above the cap is refused BEFORE the reservation and before the first provider call', async () => {
  const chat = fakeChat({})
  const cursor = new MuseSteerCursor({ providers: [binding()], fetchImpl: chat.fetchImpl })

  const longInstruction = 'x'.repeat(MAX_INSTRUCTION_CHARS + 1)
  await assert.rejects(
    () => cursor.reserve(modus(), aditusFor(longInstruction)),
    /above the \d+-character limit/,
    'reserve() refuses an oversized instruction, so nothing is ever locked for it',
  )
  await assert.rejects(() => cursor.run(actum(aditusFor(longInstruction))), /above the \d+-character limit/)

  const wideFloor = Array.from({ length: MAX_FLOOR_FRAGMENTS + 1 }, (_, i) => ({
    category: 'props' as const, text: `a prop numbered ${i}`,
  }))
  await assert.rejects(
    () => cursor.reserve(modus(), aditusFor('lose the neon', wideFloor)),
    /above the \d+-fragment per-steer cap/,
  )

  // An instruction exactly at the bound is accepted: the cap is a bound, not an off-by-one.
  await cursor.reserve(modus(), aditusFor('x'.repeat(MAX_INSTRUCTION_CHARS)))

  assert.equal(chat.calls, 0, 'no refusal reached the wire')
})

test('the bounds are real bounds, and the reservation scales with the floor', () => {
  assert.ok(MAX_INSTRUCTION_CHARS > 0 && Number.isFinite(MAX_INSTRUCTION_CHARS))
  assert.ok(MAX_FLOOR_FRAGMENTS > 0 && Number.isFinite(MAX_FLOOR_FRAGMENTS))
  const per1k = OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens
  assert.ok(DEFAULT_STEER_BASE_TOKENS > 0 && DEFAULT_TOKENS_PER_FLOOR_FRAGMENT > 0)
  // A wide floor reserves strictly more than a narrow one: the estimate is the floor's, not a
  // flat fee wearing a per-fragment name.
  assert.ok(
    chatImpetus(DEFAULT_STEER_BASE_TOKENS + MAX_FLOOR_FRAGMENTS * DEFAULT_TOKENS_PER_FLOOR_FRAGMENT, per1k) >
    chatImpetus(DEFAULT_STEER_BASE_TOKENS + DEFAULT_TOKENS_PER_FLOOR_FRAGMENT, per1k),
  )
})

test('a steer settles the real token cost, clamped to the reservation', async () => {
  const per1k = OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens
  const chat = fakeChat({}, 4_000)
  const cursor = new MuseSteerCursor({ providers: [binding()], fetchImpl: chat.fetchImpl })

  const settled = await cursor.run(actum(aditusFor('lose the neon'), 10_000_000n))
  assert.equal((settled as { exitus: { impetus: bigint } }).exitus.impetus, chatImpetus(4_000, per1k))

  // A reservation smaller than the real cost clamps rather than overcharging.
  const clamped = await cursor.run(actum(aditusFor('lose the neon'), 1n))
  assert.equal((clamped as { exitus: { impetus: bigint } }).exitus.impetus, 1n)
})

// ── PROOF 5: fail closed when no chat provider is registered ─────────────────

test('with no chat-capable provider registered, reserve() refuses by name rather than letting the run reach the wire', async () => {
  const chat = fakeChat({})
  const cursor = new MuseSteerCursor({ providers: [], fetchImpl: chat.fetchImpl })

  await assert.rejects(() => cursor.reserve(modus(), aditusFor('lose the neon')), /no chat-capable API provider/)
  await assert.rejects(() => cursor.run(actum(aditusFor('lose the neon'))), /no chat-capable API provider/)
  assert.equal(chat.calls, 0)
})

test('a provider registered without a usable key is not a usable provider, and a named one that is absent is refused', async () => {
  const noKey = new MuseSteerCursor({ providers: [{ provider: OPENROUTER_PROVIDER, apiKey: '' }] })
  await assert.rejects(() => noKey.reserve(modus(), aditusFor('lose the neon')), /no chat-capable API provider/)

  const cursor = new MuseSteerCursor({ providers: [binding()] })
  await assert.rejects(
    () => cursor.reserve(modus(), { ...aditusFor('lose the neon'), provider: 'not-registered' }),
    /no chat provider 'not-registered' is registered/,
  )
})

// ── the ministerium ─────────────────────────────────────────────────────────

test('registering the steer cursor leaves the ApiCursor registrations and the decomposer intact', () => {
  // `Cursorum` is a flat Map<ministerium, Cursor> whose register is a bare set. A steer cursor
  // registered under a provider id would replace that provider's ApiCursor and take over every
  // chat, image and image-edit dispatch; registered under 'musegarden' it would take over the
  // decomposer. Both with a green typecheck and a green suite. This is the assertion that notices.
  const cursorum = new SimpleCursorum()
  for (const provider of API_PROVIDERS) {
    cursorum.register(provider.id, new ApiCursor(provider, { apiKey: 'k', http: httpApiTransport }))
  }
  cursorum.register(
    MODUS_DATASET_DECOMPOSE.ministerium!,
    // Registration only — nothing here runs a pass, so the settlement rail the decomposer takes
    // (its own actum store and completor, since no webhook finishes a decompose) is never reached.
    new MuseDecomposeCursor({
      datasets: {} as never,
      providers: [binding()],
      actorum: {} as never,
      completor: () => ({} as never),
    }),
  )
  cursorum.register(MUSE_STEER_MINISTERIUM, new MuseSteerCursor({ providers: [binding()] }))

  for (const m of [MODUS_CHATGPT, MODUS_DALLE_III, MODUS_OPENROUTER_CHAT, MODUS_VENICE_CHAT]) {
    assert.ok(cursorum.resolve(m) instanceof ApiCursor, `${m.id} must still resolve to the ApiCursor`)
  }
  assert.ok(cursorum.resolve(MODUS_DATASET_DECOMPOSE) instanceof MuseDecomposeCursor)
  assert.ok(cursorum.resolve(MODUS_MUSE_STEER) instanceof MuseSteerCursor)

  assert.equal(MODUS_MUSE_STEER.ministerium, MUSE_STEER_MINISTERIUM)
  assert.notEqual(MUSE_STEER_MINISTERIUM, MODUS_DATASET_DECOMPOSE.ministerium)
  for (const provider of API_PROVIDERS) assert.notEqual(MUSE_STEER_MINISTERIUM, provider.id)
})

// ── the seed ────────────────────────────────────────────────────────────────

test('muse-steer is a canon sync job on its own ministerium, billed on usage', () => {
  assert.ok(CANONICAL_MODI.includes(MODUS_MUSE_STEER))
  assert.equal(MODUS_MUSE_STEER.genus, 'atomicus')
  assert.equal(MODUS_MUSE_STEER.deliveryMode, 'sync')
  assert.equal(MODUS_MUSE_STEER.canonica, true)
  // No fixed cost: the cursor reserves a ceiling and settles the real token cost.
  assert.equal(MODUS_MUSE_STEER.impetusFixum, undefined)
  assert.equal(MODUS_MUSE_STEER.aditus.instruction?.required, true)
  assert.equal(MODUS_MUSE_STEER.aditus.floor?.required, true)
  // The floor travels inline; a session id is not a port on this modus and must not become one.
  assert.equal('session' in MODUS_MUSE_STEER.aditus, false)
  assert.ok(MODUS_MUSE_STEER.contentHash.length > 0)

  // The verbum is an explicit override, and the cascade is why: the exitus is counts, so the
  // cascade finds no output modality and falls through to its `enhance` catch-all.
  assert.equal(MODUS_MUSE_STEER.verbum, 'chat')
  assert.equal(resolveCanonVerb({ ...MODUS_MUSE_STEER, verbum: undefined }), 'enhance')
  assert.equal(resolveCanonVerb(MODUS_MUSE_STEER), 'chat')
})
