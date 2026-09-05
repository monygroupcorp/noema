import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toRun, toRunDetail, toCollection } from '../../../../src/allocutio/api/runProjection.js'
import type { Actum, ActumStatus } from '../../../../src/types/actum.js'
import type { Collectio } from '../../../../src/types/collectio.js'
import { classifyError } from '../../../../src/lib/classifyError.js'

function makeActum(over: Partial<Actum>): Actum {
  return {
    id: 'actum-1',
    modusId: 'modus-1',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: {},
    status: 'nascens',
    inceptum: new Date('2026-06-09T00:00:00.000Z'),
    expirat: new Date('2026-06-09T01:00:00.000Z'),
    ...over,
  }
}

test('status maps each ActumStatus to the public RunStatus', () => {
  const cases: Array<[ActumStatus, string]> = [
    ['nascens', 'pending'],
    ['agens', 'running'],
    ['completus', 'complete'],
    ['fractus', 'failed'],
  ]
  for (const [status, expected] of cases) {
    const run = toRun(makeActum({ status }))
    assert.equal(run.status, expected, `${status} → ${expected}`)
  }
})

test('fractus actum surfaces failure with execution_error code and CLASSIFIED copy', () => {
  // The stored `error` is operator text — pod ids, elapsed milliseconds, the recovery the
  // platform was already attempting. It goes through `classifyError` on the way out, so the
  // public surface says what the chat surfaces already say and carries no internals.
  const raw = 'Pod pod-7 abandoned after 128476ms as an ip-less host — retrying on a fresh pod'
  const run = toRun(makeActum({ status: 'fractus', error: raw }))
  assert.equal(run.status, 'failed')
  assert.ok(run.failure)
  assert.equal(run.failure?.code, 'run.execution_error')
  assert.equal(run.failure?.message, classifyError(raw))
  assert.ok(!/pod-7|128476/.test(run.failure?.message ?? ''), 'raw internal detail must not reach the caller')
})

test('a recognised failure class keeps its own copy rather than the generic line', () => {
  const raw = 'RunPod pod provision failed: no capacity'
  const run = toRun(makeActum({ status: 'fractus', error: raw }))
  assert.equal(run.failure?.message, classifyError(raw))
  assert.notEqual(classifyError(raw), classifyError('a failure nobody classified'), 'the case is vacuous unless the classes differ')
})

test('fractus without error falls back to classified copy for the default message', () => {
  const run = toRun(makeActum({ status: 'fractus' }))
  assert.equal(run.failure?.message, classifyError('run failed'))
})

// ===========================================================================
// noema-390 — a failed run tells its owner where it died
// ===========================================================================
//
// Three production runs on the MiniMax H3 bring-up returned the identical body
// {"code":"run.execution_error","message":"Something went wrong. Please try again."}
// while the server log named a different cause each time. Two of them cost a full
// failed run (~20 min, ~$0.17 of pod time) to diagnose by inference.
//
// The projection now carries `failure.stage` — a closed enum, no free text, safe for
// every caller — and, on the OWNER-scoped projection only, `failure.detail`: the
// recorded text verbatim.

/** The three bring-up failures, verbatim, plus the fourth that already worked. */
const BRINGUP_FAILURES: Array<[label: string, raw: string, stage: string | undefined]> = [
  ['a full-disk failure — a full disk during the weight download',
   'model download failed: wget https://…/model.safetensors returned non-zero exit status 3',
   'download'],
  ['an sshd failure — the pod never reached sshd',
   'Training pod launch exhausted 3 attempts without reaching an SSH-reachable host — abandoned pod-a, pod-b, pod-c',
   'ssh'],
  ['a runner-readiness failure — the runner never came up',
   'comfyrunner did not become ready within timeout',
   'bootstrap'],
  ['a job timeout — a job timeout, which already read well',
   'Actum expired — pod never reported back',
   undefined],
]

test('an actum failed at each stage projects DISTINGUISHABLY — the three bring-up runs', () => {
  const seen = new Map<string, string[]>()
  for (const [label, raw, stage] of BRINGUP_FAILURES) {
    const run = toRun(makeActum({ status: 'fractus', error: raw }))
    assert.equal(run.failure?.stage, stage, label)
    const key = `${run.failure?.stage ?? '<none>'}|${run.failure?.message}`
    seen.set(key, [...(seen.get(key) ?? []), label])
  }
  // The point of the item: these four failures are four different answers, not one.
  for (const [key, labels] of seen) {
    assert.equal(labels.length, 1, `${labels.join(' and ')} are still indistinguishable (${key})`)
  }
})

test('every stage in the lifecycle projects its own value', () => {
  const cases: Array<[string, string]> = [
    ['RunPod pod provision failed: no capacity for the requested GPU class', 'provision'],
    ['Pod pod-3 SSH not ready within 300000ms — no successful status read in 40 polls', 'ssh'],
    ['comfyrunner not reachable on the pod', 'bootstrap'],
    ['model download failed: No space left on device', 'download'],
    ['comfyrunner job failed: CUDA out of memory', 'execute'],
  ]
  const stages = new Set<string>()
  for (const [raw, stage] of cases) {
    const run = toRun(makeActum({ status: 'fractus', error: raw }))
    assert.equal(run.failure?.stage, stage, raw)
    stages.add(stage)
  }
  assert.equal(stages.size, 5, 'all five stages are exercised')
})

test('stage is ABSENT when the recorded cause does not say where — the field never guesses', () => {
  const run = toRun(makeActum({ status: 'fractus', error: 'a brand new failure nobody has classified' }))
  assert.ok(run.failure, 'the run still reports a failure')
  assert.equal(run.failure?.stage, undefined, 'an unplaceable failure gets no stage rather than a plausible one')
  assert.equal(run.failure?.message, 'Something went wrong. Please try again.')
})

test('stage carries NO free text — nothing from the raw message can ride out on it', () => {
  // The whole reason `stage` is safe for a non-owner. Asserted against a raw string
  // stuffed with the things the original comment was right to keep in: a pod id, a
  // duration, a URL, a path.
  const raw = 'model download failed on pod-7f3a after 128476ms: wget https://weights.example/secret/model.safetensors -O /workspace/models/unet/x.safetensors returned non-zero exit status 3'
  const run = toRun(makeActum({ status: 'fractus', error: raw }))
  assert.equal(run.failure?.stage, 'download')
  const publicText = JSON.stringify(run)
  assert.ok(!/pod-7f3a|128476|weights\.example|\/workspace/.test(publicText),
    'a non-owner projection leaked raw internal detail')
})

test('a NON-OWNER gets the classified sentence and nothing else — no detail, ever', () => {
  // `toRun` is the projection with no ownership behind it. The raw text is an operator
  // artefact; only the owner-scoped projection may carry it.
  for (const [, raw] of BRINGUP_FAILURES.map(([l, r]) => [l, r] as const)) {
    const run = toRun(makeActum({ status: 'fractus', error: raw }))
    assert.equal(run.failure?.detail, undefined, `toRun must never carry detail (${raw})`)
    assert.ok(!JSON.stringify(run).includes(raw), 'the raw recorded text reached a non-owner')
  }
})

test('the OWNER gets the raw recorded text verbatim, alongside the classified sentence', () => {
  const raw = 'model download failed: wget https://…/model.safetensors returned non-zero exit status 3'
  const detail = toRunDetail(makeActum({ status: 'fractus', error: raw }))
  assert.equal(detail.failure?.detail, raw, 'verbatim — not truncated, not reworded')
  assert.equal(detail.failure?.message, classifyError(raw), 'the sentence is still the classified one')
  assert.equal(detail.failure?.stage, 'download')
})

test('the owner can tell the three bring-up failures apart WITHOUT reading a server log', () => {
  // Deliverable 1, stated as the operator would experience it.
  const details = BRINGUP_FAILURES.slice(0, 3).map(([, raw]) =>
    toRunDetail(makeActum({ status: 'fractus', error: raw })).failure?.detail)
  assert.equal(new Set(details).size, 3, 'three failures, three distinct causes on the run itself')
  assert.ok(details.every(d => typeof d === 'string' && d.length > 0))
})

test('toRunDetail adds no detail when the actum recorded no error', () => {
  const detail = toRunDetail(makeActum({ status: 'fractus' }))
  assert.equal(detail.failure?.detail, undefined)
  assert.equal(detail.failure?.message, classifyError('run failed'))
})

test('a successful run carries no failure on either projection', () => {
  assert.equal(toRun(makeActum({ status: 'completus' })).failure, undefined)
  assert.equal(toRunDetail(makeActum({ status: 'completus', error: 'stale' })).failure, undefined)
})

test('cost is the impetus bigint serialised as a string', () => {
  const run = toRun(makeActum({ impetus: 12345n }))
  assert.equal(run.cost, '12345')
  assert.equal(typeof run.cost, 'string')
})

test('createdAt is the inceptum as an ISO string', () => {
  const run = toRun(makeActum({ inceptum: new Date('2026-06-09T00:00:00.000Z') }))
  assert.equal(run.createdAt, '2026-06-09T00:00:00.000Z')
})

test('completus actum surfaces exitus', () => {
  const run = toRun(makeActum({ status: 'completus', exitus: { image: 'http://x/y.png' } }))
  assert.equal(run.status, 'complete')
  assert.deepEqual(run.exitus, { image: 'http://x/y.png' })
})

test('no failure on non-fractus runs', () => {
  const run = toRun(makeActum({ status: 'completus' }))
  assert.equal(run.failure, undefined)
})

test('toRun does not surface aditus, pinnedModels, or modusVersion', () => {
  const run = toRun(makeActum({
    aditus: { prompt: 'a cat' },
    pinnedModels: [{ role: 'checkpoint', modelId: 'sd15' } as any],
  }))
  assert.equal((run as any).aditus, undefined)
  assert.equal((run as any).pinnedModels, undefined)
  assert.equal((run as any).modusVersion, undefined)
})

test('toRunDetail includes everything toRun does', () => {
  const detail = toRunDetail(makeActum({ status: 'completus', impetus: 12345n }))
  const run = toRun(makeActum({ status: 'completus', impetus: 12345n }))
  assert.equal(detail.id, run.id)
  assert.equal(detail.status, run.status)
  assert.equal(detail.modusId, run.modusId)
  assert.equal(detail.cost, run.cost)
})

test('toRunDetail echoes aditus verbatim, including an unresolved shuffle sentinel', () => {
  const detail = toRunDetail(makeActum({ aditus: { prompt: 'a cat', seed: 'shuffle' } }))
  assert.deepEqual(detail.aditus, { prompt: 'a cat', seed: 'shuffle' })
})

test('toRunDetail surfaces pinnedModels when present', () => {
  const pinnedModels = [{ role: 'checkpoint', modelId: 'sd15' } as any]
  const detail = toRunDetail(makeActum({ pinnedModels }))
  assert.deepEqual(detail.pinnedModels, pinnedModels)
})

test('toRunDetail is absent pinnedModels when the Actum has none', () => {
  const detail = toRunDetail(makeActum({}))
  assert.equal(detail.pinnedModels, undefined)
})

test('toRunDetail surfaces the cast-time modus version under the plain name', () => {
  const detail = toRunDetail(makeActum({ modusVersiono: '2.3.1' }))
  assert.equal(detail.modusVersion, '2.3.1')
})

function makeCollectio(over: Partial<Collectio> = {}): Collectio {
  return {
    id: 'col-1',
    modusId: 'modus-1',
    aditusBase: {},
    tractus: [],
    numerus: 3,
    provenanceHash: 'sha256:test',
    by: { animaId: 'anima-1' },
    acta: [],
    completae: 0,
    fractae: 0,
    pendentes: 0,
    reiectae: 0,
    concurrentia: 2,
    impetusTotal: 0n,
    status: 'agens',
    natum: new Date('2026-06-09T00:00:00.000Z'),
    ...over,
  }
}

test('toCollection: paused is absent when pausatum is unset (running normally)', () => {
  const col = toCollection(makeCollectio())
  assert.equal(col.paused, undefined)
})

test('toCollection: paused is true when pausatum is set', () => {
  const col = toCollection(makeCollectio({ pausatum: new Date('2026-07-10T00:00:00.000Z') }))
  assert.equal(col.paused, true)
})

// The piece counters are the collection's own bookkeeping, projected verbatim, so a caller
// polling the run reads the same numbers the collection records. `completed` is "generated
// and accepted"; `pendingReview` is "generated, awaiting a decision" — a run holding real
// work is distinguishable from one that produced nothing (noema-376).
test('toCollection: projects the held-for-review count alongside the other piece counters', () => {
  const col = toCollection(makeCollectio({ numerus: 24, completae: 2, pendentes: 9, fractae: 1, reiectae: 3 }))
  assert.equal(col.completed, 2)
  assert.equal(col.pendingReview, 9)
  assert.equal(col.failed, 1)
  assert.equal(col.rejected, 3)
  assert.equal(col.total, 24)
})

test('toCollection: a run with everything still held reports its work, not zero', () => {
  const col = toCollection(makeCollectio({ numerus: 24, pendentes: 9 }))
  assert.equal(col.completed, 0, 'nothing is accepted yet')
  assert.equal(col.pendingReview, 9, 'but nine pieces exist and the record says so')
})

// The base prompt is half the trait→prompt rule: a base prompt carrying `{{porta}}` has that
// token REPLACED by the winning value's prompt fragment (TraitMixer's token mode), and one
// carrying no token has fragments APPENDED instead. The authoring screens explain which of the
// two an axis does, and cannot tell them apart without it — so it is projected, and only it:
// the rest of the base aditus stays server-side.

test('toCollection: projects the base prompt the author wrote', () => {
  const col = toCollection(makeCollectio({ aditusBase: { _basePrompt: 'a lighthouse, {{style}}' } }))
  assert.equal(col.basePrompt, 'a lighthouse, {{style}}')
})

test('toCollection: a collection with no base prompt carries no basePrompt field', () => {
  assert.equal(toCollection(makeCollectio({ aditusBase: {} })).basePrompt, undefined)
})

test('toCollection: the rest of the base aditus is not projected', () => {
  const col = toCollection(makeCollectio({
    aditusBase: { _basePrompt: 'a lighthouse', steps: 30, negative: 'blurry', checkpointRef: 'private-model-id' },
  }))
  assert.equal(col.basePrompt, 'a lighthouse')
  assert.deepEqual(
    Object.keys(col).filter((k) => ['steps', 'negative', 'checkpointRef', 'aditusBase'].includes(k)),
    [],
    'only the base prompt crosses the projection',
  )
})

test('toCollection: a non-string base prompt is dropped rather than projected raw', () => {
  const col = toCollection(makeCollectio({ aditusBase: { _basePrompt: { nested: 'object' } } }))
  assert.equal(col.basePrompt, undefined)
})
