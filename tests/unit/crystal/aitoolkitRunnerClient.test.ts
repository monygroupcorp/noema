// Build #5 (runner) — awaitViaPoll drives ai-toolkit's SQLite Job row to terminal and
// records the projected Progressus timeline onto the trace's Actum, via the same recorder
// seam comfyrunner uses. This covers the POLL LOOP (dedup, terminal detection, timeout,
// no-Actum no-op) over a scripted reader — no real DB/GPU. The event→phase MAPPING is
// covered in aitkProgressus.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awaitViaPoll, type AitkJobReader } from '../../../src/crystal/aitoolkitRunnerClient.js'
import { registerProgressusRecorder } from '../../../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import type { Progressus } from '../../../src/types/progressus.js'

type Row = { status: string; step: number; info?: string }

/** A reader that yields one scripted row per poll, holding on the last forever. */
function scriptedReader(rows: Array<Row | undefined>): AitkJobReader {
  let i = 0
  return async () => {
    const r = i < rows.length ? rows[i] : rows[rows.length - 1]
    if (i < rows.length - 1) i++
    return r === undefined ? undefined : { ...r }
  }
}

async function withRecorder(actumId: string, body: (seen: Progressus[]) => Promise<void>): Promise<void> {
  const seen: Progressus[] = []
  registerProgressusRecorder(async (_id, p) => { seen.push(p) })
  try {
    await withTrace(makeTraceContext({ actumId }), () => body(seen))
  } finally {
    registerProgressusRecorder(async () => {})
  }
}

const noSleep = async (): Promise<void> => {}

test('awaitViaPoll: records the real klein timeline and returns completed', async () => {
  const rows: Row[] = [
    { status: 'queued',    step: 0,  info: 'seeded' },
    { status: 'running',   step: 0,  info: 'Loading model' },
    { status: 'running',   step: 0,  info: 'Loading dataset' },
    { status: 'running',   step: 0,  info: 'Generating baseline' },
    { status: 'running',   step: 30, info: 'Training' },
    { status: 'running',   step: 60, info: 'Training' },
    { status: 'completed', step: 60, info: 'Training completed' },
  ]
  await withRecorder('act-train', async (seen) => {
    const outcome = await awaitViaPoll(scriptedReader(rows), { jobId: 'j1', cfgSteps: 60, sleep: noSleep })
    assert.deepEqual(outcome, { status: 'completed', lastStep: 60 })
    assert.deepEqual(seen.map(p => p.phase), [
      'queued', 'loading', 'downloading', 'warming', 'executing', 'executing', 'done',
    ])
    // executing carries real step/total progress.
    assert.deepEqual(seen.find(p => p.phase === 'executing')?.progress, { done: 30, total: 60, unit: 'steps' })
  })
})

test('awaitViaPoll: an unchanged (status,step,info) signature is NOT re-recorded', async () => {
  // Three identical "Training step 30" polls between two distinct steps → one record each.
  const rows: Row[] = [
    { status: 'running',   step: 30, info: 'Training' },
    { status: 'running',   step: 30, info: 'Training' },   // same sig → skipped
    { status: 'running',   step: 30, info: 'Training' },   // same sig → skipped
    { status: 'running',   step: 31, info: 'Training' },   // step changed → recorded
    { status: 'completed', step: 31, info: 'Training completed' },
  ]
  await withRecorder('act-dedup', async (seen) => {
    await awaitViaPoll(scriptedReader(rows), { jobId: 'j1', cfgSteps: 100, sleep: noSleep })
    const exec = seen.filter(p => p.phase === 'executing')
    assert.deepEqual(exec.map(p => p.progress?.done), [30, 31])   // not [30,30,30,31]
  })
})

test('awaitViaPoll: error status records failed and returns the error outcome (no throw)', async () => {
  const rows: Row[] = [
    { status: 'running', step: 5, info: 'Training' },
    { status: 'error',   step: 5, info: 'CUDA out of memory' },
  ]
  await withRecorder('act-err', async (seen) => {
    const outcome = await awaitViaPoll(scriptedReader(rows), { jobId: 'j1', cfgSteps: 100, sleep: noSleep })
    assert.deepEqual(outcome, { status: 'error', lastStep: 5, message: 'CUDA out of memory' })
    assert.equal(seen.at(-1)?.phase, 'failed')
    assert.equal(seen.at(-1)?.message, 'CUDA out of memory')
  })
})

test('awaitViaPoll: stopped status returns the stopped outcome', async () => {
  const rows: Row[] = [
    { status: 'running', step: 5, info: 'Training' },
    { status: 'stopped', step: 5, info: 'Job stopped (remote)' },
  ]
  await withRecorder('act-stop', async (seen) => {
    const outcome = await awaitViaPoll(scriptedReader(rows), { jobId: 'j1', cfgSteps: 100, sleep: noSleep })
    assert.deepEqual(outcome, { status: 'stopped', lastStep: 5, message: 'Job stopped (remote)' })
    assert.equal(seen.at(-1)?.phase, 'cancelling')
  })
})

test('awaitViaPoll: waits through an un-seeded (undefined) row, then proceeds', async () => {
  const rows: Array<Row | undefined> = [
    undefined,                                            // not seeded yet
    undefined,
    { status: 'running',   step: 1,  info: 'Training' },
    { status: 'completed', step: 1,  info: 'Training completed' },
  ]
  await withRecorder('act-wait', async (seen) => {
    const outcome = await awaitViaPoll(scriptedReader(rows), { jobId: 'j1', cfgSteps: 10, sleep: noSleep })
    assert.equal(outcome.status, 'completed')
    assert.deepEqual(seen.map(p => p.phase), ['executing', 'done'])   // nothing recorded for the undefined polls
  })
})

test('awaitViaPoll: a hung job hits the timeout, records a synthetic failed terminal', async () => {
  // A clock that advances 1s per read; the reader never reaches terminal.
  let t = 1_700_000_000_000
  const now = (): Date => new Date(t)
  const reader: AitkJobReader = async () => { t += 1000; return { status: 'running', step: 7, info: 'Training' } }
  await withRecorder('act-hang', async (seen) => {
    const outcome = await awaitViaPoll(reader, { jobId: 'j1', cfgSteps: 100, timeoutMs: 5000, now, sleep: noSleep })
    assert.equal(outcome.status, 'error')
    assert.equal(outcome.message, 'training poll timeout')
    assert.equal(seen.at(-1)?.phase, 'failed')
    assert.equal(seen.at(-1)?.message, 'training poll timeout')
  })
})

test('awaitViaPoll: no Actum in the trace → records nothing, still polls to terminal', async () => {
  const seen: Progressus[] = []
  registerProgressusRecorder(async (_id, p) => { seen.push(p) })
  try {
    const rows: Row[] = [
      { status: 'running',   step: 1, info: 'Training' },
      { status: 'completed', step: 1, info: 'Training completed' },
    ]
    const outcome = await withTrace(makeTraceContext({}), () =>   // no actumId
      awaitViaPoll(scriptedReader(rows), { jobId: 'j1', cfgSteps: 10, sleep: noSleep }))
    assert.equal(outcome.status, 'completed')
    assert.equal(seen.length, 0)
  } finally {
    registerProgressusRecorder(async () => {})
  }
})
