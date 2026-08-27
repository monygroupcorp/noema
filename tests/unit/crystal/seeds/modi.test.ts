import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_MODI,
  MODUS_CHATGPT,
  MODUS_DALLE_III,
  MODUS_GPT_IMAGE,
  MODUS_GPT_IMAGE_EDIT,
  MODUS_OPENROUTER_CHAT,
  MODUS_VENICE_CHAT,
  MODUS_LAYER_COMPOSITE,
  MODUS_FRAMES_TO_VIDEO,
  MODUS_AITOOLKIT_TRAINING,
  MODUS_DATASET_CAPTION,
  MODUS_DATASET_DECOMPOSE,
  MODUS_MUSE_STEER,
} from '../../../../src/crystal/seeds/modi.js'

test('CANONICAL_MODI contains twelve entries', () => {
  assert.equal(CANONICAL_MODI.length, 12)
})

test('no canonical modus is still on the dropped huggingface ministerium', () => {
  for (const m of CANONICAL_MODI) {
    assert.notEqual(m.ministerium, 'huggingface', `${m.id} must not dangle on huggingface`)
  }
})

test('aitoolkit-training modus is a canon training flow (ministerium aitoolkit, sync, duration-billed)', () => {
  assert.equal(MODUS_AITOOLKIT_TRAINING.ministerium, 'aitoolkit')
  assert.equal(MODUS_AITOOLKIT_TRAINING.genus, 'atomicus')
  assert.equal(MODUS_AITOOLKIT_TRAINING.deliveryMode, 'sync')
  assert.equal(MODUS_AITOOLKIT_TRAINING.canonica, true)
  // No fixed cost: local self-hosted charges 0n via `?? 0n`; remote bills pod-seconds (Slice E).
  assert.equal(MODUS_AITOOLKIT_TRAINING.impetusFixum, undefined)
  // The user-facing required inputs (a dataset + knobs; the modus synthesises the config).
  for (const k of ['dataset', 'steps', 'triggerWord', 'baseModel']) {
    assert.equal(MODUS_AITOOLKIT_TRAINING.aditus[k]?.required, true, `${k} should be required`)
  }
  assert.equal('configPath' in MODUS_AITOOLKIT_TRAINING.aditus, false, 'configPath is internal, not a user port')
  // Exitus matches the finalizer's return (Slice B): { trained, steps, loraId, loraUrl }.
  assert.deepEqual(Object.keys(MODUS_AITOOLKIT_TRAINING.exitus).sort(), ['loraId', 'loraUrl', 'steps', 'trained'])
  assert.ok(MODUS_AITOOLKIT_TRAINING.contentHash.length > 0)
})

test('dataset-caption modus is a canon caption job on its OWN ministerium (async, duration-billed)', () => {
  // The ministerium assertion is the point of this block, and it sits beside the training modus'
  // on purpose. `Cursorum` is a flat Map<ministerium, Cursor> whose `register` is a bare set, so
  // if these two shared a key the second registration would replace the first and every training
  // dispatch would land in the caption cursor — with a green typecheck and a green suite.
  assert.equal(MODUS_DATASET_CAPTION.ministerium, 'aitkcaption')
  assert.notEqual(MODUS_DATASET_CAPTION.ministerium, MODUS_AITOOLKIT_TRAINING.ministerium)
  assert.equal(MODUS_DATASET_CAPTION.genus, 'atomicus')
  // The pod reports at the completion webhook — the run is dispatched, not awaited.
  assert.equal(MODUS_DATASET_CAPTION.deliveryMode, 'async')
  assert.equal(MODUS_DATASET_CAPTION.canonica, true)
  // Image → text: an explicit override, the same call COMPOSITUS_IMAGE_CAPTION makes, because
  // every port here is text/int and the cascade would otherwise land on a chat-ish verb.
  assert.equal(MODUS_DATASET_CAPTION.verbum, 'describe')
  // No fixed cost: a pod tool billed on runtime duration. The cursor reserves a pod-seconds cap
  // and the completion webhook settles it to the real duration — metered like any other run.
  assert.equal(MODUS_DATASET_CAPTION.impetusFixum, undefined)
  assert.equal(MODUS_DATASET_CAPTION.aditus.dataset?.required, true)
  // Exitus matches the caption finalizer's return.
  assert.deepEqual(Object.keys(MODUS_DATASET_CAPTION.exitus).sort(), ['captioned', 'captionsetId', 'coverage'])
  assert.ok(MODUS_DATASET_CAPTION.contentHash.length > 0)
})

test('the caption modus declares every key its cursor and finalizer read', () => {
  // `validateAditus` builds its result by iterating the SCHEMA, so a key the modus does not
  // declare is not copied forward — an undeclared port survives only on the routes that skip
  // that validation. `captionset` is the key `DatasetCaptionCursor` (staging + the launch
  // aditus it echoes) and `captionFinalizer` (the extend path) both read, so it is declared.
  // Undeclared, an extending pass would silently become a whole-set pass on any route that
  // validates: a fresh captionset, and every image captioned again at pod cost.
  assert.equal('captionset' in MODUS_DATASET_CAPTION.aditus, true, 'captionset must be a declared port')
  assert.equal(MODUS_DATASET_CAPTION.aditus.captionset?.required, false)
  // 'text' is what both readers parse — `typeof aditus.captionset === 'string'`, then trimmed.
  assert.equal(MODUS_DATASET_CAPTION.aditus.captionset?.type, 'text')
  // Optional and with no default: `validateAditus` omits an absent optional port that has no
  // default, which is exactly the "mint a fresh captionset" path. A default here would make
  // every pass an extending pass of one hard-coded set.
  assert.equal(MODUS_DATASET_CAPTION.aditus.captionset?.default, undefined)
  // The descriptio is user-facing contract text — it must not still promise a whole-set pass.
  assert.match(MODUS_DATASET_CAPTION.descriptio ?? '', /EXTENDS/)
})

test('frames-to-video modus is host-side (ministerium ffmpeg, sync, video out)', () => {
  assert.equal(MODUS_FRAMES_TO_VIDEO.ministerium, 'ffmpeg')
  assert.equal(MODUS_FRAMES_TO_VIDEO.deliveryMode, 'sync')
  assert.equal(MODUS_FRAMES_TO_VIDEO.aditus.frames?.type, 'text')
  assert.equal(MODUS_FRAMES_TO_VIDEO.exitus.video?.type, 'video')
})

test('layer-composite modus is host-side (ministerium composite, sync, no fixed cost)', () => {
  assert.equal(MODUS_LAYER_COMPOSITE.ministerium, 'composite')
  assert.equal(MODUS_LAYER_COMPOSITE.deliveryMode, 'sync')
  assert.equal(MODUS_LAYER_COMPOSITE.impetusFixum, undefined)
  assert.equal(MODUS_LAYER_COMPOSITE.aditus.layers?.type, 'text')
  assert.equal(MODUS_LAYER_COMPOSITE.exitus.image?.type, 'image')
})

test('chatgpt modus has ministerium openai and deliveryMode sync', () => {
  assert.equal(MODUS_CHATGPT.ministerium, 'openai')
  assert.equal(MODUS_CHATGPT.deliveryMode, 'sync')
})

test('dalle modus has ministerium openai and impetusFixum 50n', () => {
  assert.equal(MODUS_DALLE_III.ministerium, 'openai')
  assert.equal(MODUS_DALLE_III.impetusFixum, 50n)
})

test('chatgpt / dalle declare their ApiCursor capability via __capability', () => {
  assert.equal(MODUS_CHATGPT.aditus.__capability?.default, 'chat')
  assert.equal(MODUS_DALLE_III.aditus.__capability?.default, 'image')
})

test('gpt-image modus is the canon openai image lane (prompt in, image out, flat 50n)', () => {
  assert.equal(MODUS_GPT_IMAGE.id, 'modus.gpt-image')
  assert.equal(MODUS_GPT_IMAGE.ministerium, 'openai')
  assert.equal(MODUS_GPT_IMAGE.genus, 'atomicus')
  assert.equal(MODUS_GPT_IMAGE.deliveryMode, 'sync')
  assert.equal(MODUS_GPT_IMAGE.canonica, true)
  assert.equal(MODUS_GPT_IMAGE.impetusFixum, 50n)
  assert.equal(MODUS_GPT_IMAGE.aditus.__capability?.default, 'image')
  assert.equal(MODUS_GPT_IMAGE.aditus.prompt?.required, true)
  assert.equal(MODUS_GPT_IMAGE.exitus.image?.type, 'image')
  assert.ok(MODUS_GPT_IMAGE.contentHash.length > 0)
  // The model is the provider's, not the seed's: a `model` port here would pin the lane to a
  // string that the provider descriptor can no longer move.
  assert.equal('model' in MODUS_GPT_IMAGE.aditus, false)
  // `quality` must carry a value the image model actually accepts, or every default-quality run
  // is rejected at the vendor.
  assert.ok(
    ['low', 'medium', 'high', 'auto'].includes(String(MODUS_GPT_IMAGE.aditus.quality?.default)),
    'quality default must be one of low/medium/high/auto',
  )
})

test('the canon image modus is gpt-image, and dalle is retained but de-canonised', () => {
  const canonImage = CANONICAL_MODI.filter(
    m => m.canonica && m.aditus.__capability?.default === 'image',
  )
  assert.deepEqual(canonImage.map(m => m.id), ['modus.gpt-image'])
  assert.equal(MODUS_DALLE_III.canonica, false)
  assert.ok(
    CANONICAL_MODI.some(m => m.id === MODUS_DALLE_III.id),
    'modus.dalle-iii must still be seeded — historical actus reference its contentHash',
  )
  assert.ok(MODUS_DALLE_III.contentHash.length > 0)
})

test('gpt-image-edit modus is openai imageEdit with image+prompt in, image out', () => {
  assert.equal(MODUS_GPT_IMAGE_EDIT.ministerium, 'openai')
  assert.equal(MODUS_GPT_IMAGE_EDIT.aditus.__capability?.default, 'imageEdit')
  assert.equal(MODUS_GPT_IMAGE_EDIT.aditus.image?.required, true)
  assert.equal(MODUS_GPT_IMAGE_EDIT.aditus.prompt?.required, true)
  assert.equal(MODUS_GPT_IMAGE_EDIT.exitus.image?.type, 'image')
})

test('openrouter chat modus proves the descriptor generalizes (new ministerium, chat capability)', () => {
  assert.equal(MODUS_OPENROUTER_CHAT.ministerium, 'openrouter')
  assert.equal(MODUS_OPENROUTER_CHAT.aditus.__capability?.default, 'chat')
  assert.equal(MODUS_OPENROUTER_CHAT.exitus.response?.type, 'text')
})

// CANONICAL_MODI is the SEED set, not the canonical set: a modus stays here so its document keeps
// being written (historical Actum rows reference its contentHash) even once it is de-canonised and
// therefore no longer surfaced by `modorum.list({ canonica: true })`.
test('every seeded modus is canonica true except the ones deliberately retired', () => {
  const retired = new Set([MODUS_CHATGPT.id, MODUS_DALLE_III.id])
  for (const m of CANONICAL_MODI) {
    if (retired.has(m.id)) continue
    assert.equal(m.canonica, true, `${m.id} should have canonica true`)
  }
})

test('modus.chatgpt is retained but de-canonised, and still hashes', () => {
  assert.equal(MODUS_CHATGPT.canonica, false)
  assert.ok(
    CANONICAL_MODI.some(m => m.id === MODUS_CHATGPT.id),
    'modus.chatgpt must still be seeded — historical actus reference its contentHash',
  )
  assert.ok(MODUS_CHATGPT.contentHash.length > 0)
})

test('dataset-decompose modus is a canon decompose job on its OWN ministerium (async, usage-billed)', () => {
  // Same assertion the caption modus carries, and for the same reason: `Cursorum` is a flat
  // Map<ministerium, Cursor> whose `register` is a bare set, so sharing a key with a hosted-API
  // provider would replace that provider's ApiCursor and send every chat/image dispatch into the
  // decomposer — with a green typecheck and a green suite.
  assert.equal(MODUS_DATASET_DECOMPOSE.ministerium, 'musegarden')
  for (const other of [MODUS_CHATGPT, MODUS_OPENROUTER_CHAT, MODUS_GPT_IMAGE, MODUS_GPT_IMAGE_EDIT]) {
    assert.notEqual(MODUS_DATASET_DECOMPOSE.ministerium, other.ministerium)
  }
  assert.equal(MODUS_DATASET_DECOMPOSE.genus, 'atomicus')
  // The cursor dispatches, then keeps running off-request; it settles its own run at the end
  // of the pass (noema-338).
  assert.equal(MODUS_DATASET_DECOMPOSE.deliveryMode, 'async')
  assert.equal(MODUS_DATASET_DECOMPOSE.canonica, true)
  // No fixed cost: the cursor reserves a ceiling from the caption count and settles the summed
  // real token cost — metered like any other run, with no free lane.
  assert.equal(MODUS_DATASET_DECOMPOSE.impetusFixum, undefined)
  // Text in, text out would cascade to `chat`, which this is not — an explicit override, the
  // same call the caption modus makes.
  assert.equal(MODUS_DATASET_DECOMPOSE.verbum, 'describe')
  // A decompose is scoped to ONE captionset on ONE dataset; both ids are required.
  assert.equal(MODUS_DATASET_DECOMPOSE.aditus.dataset?.required, true)
  assert.equal(MODUS_DATASET_DECOMPOSE.aditus.captionset?.required, true)
  assert.deepEqual(Object.keys(MODUS_DATASET_DECOMPOSE.exitus).sort(), ['decomposed', 'fragments'])
  assert.ok(MODUS_DATASET_DECOMPOSE.contentHash.length > 0)
})

test('the decompose modus declares every key its cursor reads', () => {
  // Same rule as the caption modus above: `validateAditus` iterates the schema, so an
  // undeclared key is dropped wherever that validation runs. `redo` is the whole-set rebuild
  // opt-in `MuseDecomposeCursor.resolveWork` reads; undeclared, a deliberate rebuild would
  // silently become an incremental pass that skips everything already decomposed.
  assert.equal('redo' in MODUS_DATASET_DECOMPOSE.aditus, true, 'redo must be a declared port')
  assert.equal(MODUS_DATASET_DECOMPOSE.aditus.redo?.required, false)
  // 'text' is the type that survives the round trip. `isRedo` accepts a real `true` or one of
  // 'true' | '1' | 'yes'; a declared 'text' port is coerced with `String(value)`, which maps
  // `true` to 'true' and `false` to 'false' — both read the same way as the raw value. The
  // strictness lives in `isRedo`, and the declared type must not undo it.
  assert.equal(MODUS_DATASET_DECOMPOSE.aditus.redo?.type, 'text')
  // No default: an absent optional port with no default is omitted, which is the incremental
  // path. A default of any accepted string would make every decompose the expensive one.
  assert.equal(MODUS_DATASET_DECOMPOSE.aditus.redo?.default, undefined)
  // The descriptio is user-facing contract text — it must say the pass is incremental.
  assert.match(MODUS_DATASET_DECOMPOSE.descriptio ?? '', /INCREMENTAL/)
})

test("the decompose modus' exitus matches what the cursor actually returns", () => {
  // `MuseDecomposeCursor.run` returns `exitus: { decomposed, fragments }` and nothing else.
  // Pinned in both directions: a port the cursor does not populate is as misleading as a key
  // the cursor returns and the modus never declares.
  assert.deepEqual(Object.keys(MODUS_DATASET_DECOMPOSE.exitus).sort(), ['decomposed', 'fragments'])
  assert.equal('skipped' in MODUS_DATASET_DECOMPOSE.exitus, false, 'the cursor does not return a skipped count')
  assert.equal(MODUS_DATASET_DECOMPOSE.exitus.decomposed?.type, 'int')
  assert.equal(MODUS_DATASET_DECOMPOSE.exitus.fragments?.type, 'int')
})

test('all modi have non-empty id, nomen, versio', () => {
  for (const m of CANONICAL_MODI) {
    assert.ok(m.id.length > 0, `${m.id} id should be non-empty`)
    assert.ok(m.nomen.length > 0, `${m.id} nomen should be non-empty`)
    assert.ok(m.versio.length > 0, `${m.id} versio should be non-empty`)
  }
})

test('muse-steer modus is a canon steer job on its OWN ministerium (sync, usage-billed)', () => {
  // The same assertion the caption and decompose modi carry, and for the same reason: `Cursorum`
  // is a flat Map<ministerium, Cursor> whose `register` is a bare set, so sharing a key with a
  // hosted-API provider would replace that provider's ApiCursor, and sharing the decomposer's key
  // would replace the decomposer — with a green typecheck and a green suite.
  assert.equal(MODUS_MUSE_STEER.ministerium, 'musesteer')
  assert.notEqual(MODUS_MUSE_STEER.ministerium, MODUS_DATASET_DECOMPOSE.ministerium)
  for (const other of [MODUS_CHATGPT, MODUS_OPENROUTER_CHAT, MODUS_GPT_IMAGE, MODUS_GPT_IMAGE_EDIT]) {
    assert.notEqual(MODUS_MUSE_STEER.ministerium, other.ministerium)
  }
  assert.equal(MODUS_MUSE_STEER.genus, 'atomicus')
  // One chat call in process, returning when the proposal is validated.
  assert.equal(MODUS_MUSE_STEER.deliveryMode, 'sync')
  assert.equal(MODUS_MUSE_STEER.canonica, true)
  // No fixed cost: the cursor reserves a ceiling from the floor size and settles the real token
  // cost of the one call.
  assert.equal(MODUS_MUSE_STEER.impetusFixum, undefined)
  // The exitus is counts, so the cascade finds no output modality and falls to `enhance`; an
  // instruction in and a proposal out is text in, text out, which is `chat`.
  assert.equal(MODUS_MUSE_STEER.verbum, 'chat')
  // The floor travels inline; a session id is not a port here and must not become one — a cursor
  // cannot resolve an owner, so a cursor reading a resource named in its aditus is unscoped.
  assert.equal(MODUS_MUSE_STEER.aditus.instruction?.required, true)
  assert.equal(MODUS_MUSE_STEER.aditus.floor?.required, true)
  assert.equal('session' in MODUS_MUSE_STEER.aditus, false)
  assert.deepEqual(Object.keys(MODUS_MUSE_STEER.exitus).sort(), ['additions', 'dropped', 'eliminations'])
  assert.ok(MODUS_MUSE_STEER.contentHash.length > 0)
})

// ---------------------------------------------------------------------------
// Declared-vs-consumed: a port a cursor reads must be a port the modus declares
// ---------------------------------------------------------------------------
//
// `validateAditus` builds its result by iterating the SCHEMA, so a key the modus does not declare
// is not copied forward. An undeclared-but-consumed port therefore works only on the routes that
// skip that validation, and stops working the moment one of them starts validating. These tests
// pin the declaration for every such port found by a sweep of the `aditus.` reads across the
// cursors, so the boundary can be closed without taking working behaviour with it.

test('the training modus declares the caption opt-out its remote cursor reads', () => {
  const porta = MODUS_AITOOLKIT_TRAINING.aditus.autocaption
  assert.ok(porta, 'autocaption must be a declared port')
  assert.equal(porta.required, false)
  // Optional with NO default: `RemoteAitoolkitTrainingCursor` reads `aditus.autocaption !== false`,
  // so absent means on. A default here would write the flag into every run's aditus.
  assert.equal(porta.default, undefined)
  // 'bool', not 'text'. A 'text' declaration is coerced with `String(value)`, which maps `false` to
  // the string 'false' — and 'false' `!== false`, so the opt-out would validate and read as ON.
  assert.equal(porta.type, 'bool')
})

test('the chat modi declare the conversation-history port their shared cursor reads', () => {
  // All three reach the one `ApiCursor.runChat`, which gates on `Array.isArray(aditus.messages)`
  // and otherwise builds a single turn from `prompt`. `ExecuteFlow.enter` routes on the same key.
  for (const m of [MODUS_CHATGPT, MODUS_OPENROUTER_CHAT, MODUS_VENICE_CHAT]) {
    const porta = m.aditus.messages
    assert.ok(porta, `${m.id} must declare messages`)
    assert.equal(porta.required, false, `${m.id}: messages is optional — prompt is the single-turn path`)
    assert.equal(porta.default, undefined, `${m.id}: a default history would prepend itself to every run`)
    // 'text' is the one declared type whose coercion passes an Array through untouched.
    assert.equal(porta.type, 'text', `${m.id}: messages must stay Array-transparent`)
  }
})

test('the caption modus declares the run knobs its cursor reads', () => {
  // `DatasetCaptionCursor` reads both, exactly as the training cursor reads its own pair.
  for (const k of ['gpuId', 'jobId']) {
    const porta = MODUS_DATASET_CAPTION.aditus[k]
    assert.ok(porta, `${k} must be a declared port on the caption modus`)
    assert.equal(porta.type, 'text', `${k} is read as a string`)
    assert.equal(porta.required, false, `${k} has a cursor-side fallback`)
    assert.equal(porta.default, undefined, `${k} must stay absent when unsupplied`)
  }
})

test('declaring the consumed ports did not disturb the ports that were already declared', () => {
  // The rule this item works under: it ADDS reality-matching declarations and removes or renames
  // nothing. Pinned as the exact key set of each modus whose aditus this touched.
  assert.deepEqual(Object.keys(MODUS_CHATGPT.aditus).sort(),
    ['__capability', 'messages', 'model', 'prompt', 'temperature'])
  assert.deepEqual(Object.keys(MODUS_OPENROUTER_CHAT.aditus).sort(),
    ['__capability', 'messages', 'model', 'prompt', 'temperature'])
  assert.deepEqual(Object.keys(MODUS_VENICE_CHAT.aditus).sort(),
    ['__capability', 'messages', 'model', 'prompt', 'temperature'])
  assert.deepEqual(Object.keys(MODUS_DATASET_CAPTION.aditus).sort(),
    ['captionPrompt', 'captionset', 'dataset', 'gpuId', 'jobId', 'maxNewTokens', 'name'])
  // The training modus keeps the internal escape hatch OUT of its schema — the assertion above
  // in this file, restated here so the sweep is not read as licence to declare it.
  assert.equal('configPath' in MODUS_AITOOLKIT_TRAINING.aditus, false)
})
