import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSubsidySweep } from '../../../src/crystal/SubsidySweeper.js'
import { MemorySponsio } from '../../../src/crystal/MemorySponsio.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'

const WEEK_A = new Date('2026-07-01T12:00:00Z') // ISO week N
const WEEK_B = new Date('2026-07-08T12:00:00Z') // ISO week N+1

async function harness(fund: bigint) {
  const sponsiones = new MemorySponsio()
  const signorum = new MemorySignorum()
  if (fund > 0n) await signorum.issue({ animaId: 'sponsor', forma: 'minted', valor: fund, auctor: 'test' })
  return { sponsiones, signorum, deps: { sponsiones, signorum } }
}

async function pledge(sponsiones: MemorySponsio, over: Record<string, unknown> = {}) {
  return sponsiones.create({
    sponsor: { animaId: 'sponsor' },
    beneficiarius: { animaId: 'friend' },
    subsidia: { grant: 100n, cadence: 'weekly' },
    ...over,
  } as never)
}

test('drips the grant sponsor→beneficiary once per sweep', async () => {
  const { sponsiones, signorum, deps } = await harness(1000n)
  await pledge(sponsiones)
  const r = await runSubsidySweep(deps, WEEK_A)
  assert.deepEqual({ dripped: r.dripped, failed: r.failed }, { dripped: 1, failed: 0 })
  assert.equal(r.totalPoints, 100n)
  assert.equal(await signorum.balance({ animaId: 'friend' }), 100n)
  assert.equal(await signorum.balance({ animaId: 'sponsor' }), 900n)
})

test('idempotent within a cycle — a second sweep the same week does not double-drip', async () => {
  const { sponsiones, signorum, deps } = await harness(1000n)
  await pledge(sponsiones)
  await runSubsidySweep(deps, WEEK_A)
  const second = await runSubsidySweep(deps, WEEK_A)
  assert.equal(second.dripped, 0)
  assert.equal(second.skipped, 1)
  assert.equal(await signorum.balance({ animaId: 'friend' }), 100n, 'still only one drip')
})

test('drips again in the next cycle', async () => {
  const { sponsiones, signorum, deps } = await harness(1000n)
  await pledge(sponsiones)
  await runSubsidySweep(deps, WEEK_A)
  const next = await runSubsidySweep(deps, WEEK_B)
  assert.equal(next.dripped, 1)
  assert.equal(await signorum.balance({ animaId: 'friend' }), 200n)
})

test('capTotal clamps the final drip and exhausts the pledge', async () => {
  const { sponsiones, signorum, deps } = await harness(1000n)
  const s = await pledge(sponsiones, { capTotal: 250n })
  await runSubsidySweep(deps, new Date('2026-07-01T12:00:00Z')) // +100 → 100
  await runSubsidySweep(deps, new Date('2026-07-08T12:00:00Z')) // +100 → 200
  await runSubsidySweep(deps, new Date('2026-07-15T12:00:00Z')) // +50 (clamped) → 250, exhausted
  const final = await sponsiones.find(s.id)
  assert.equal(final?.drippedTotal, 250n)
  assert.equal(final?.status, 'exhausted')
  assert.equal(await signorum.balance({ animaId: 'friend' }), 250n)
  // A later sweep no longer sees it (not active).
  const after = await runSubsidySweep(deps, new Date('2026-07-22T12:00:00Z'))
  assert.equal(after.dripped, 0)
})

test('balanceCap clamps to the room and skips a full beneficiary', async () => {
  const { sponsiones, signorum, deps } = await harness(1000n)
  // Beneficiary already holds 120; cap is 150 → only 30 of room.
  await signorum.issue({ animaId: 'friend', forma: 'minted', valor: 120n, auctor: 'seed' })
  const s = await pledge(sponsiones, { subsidia: { grant: 100n, cadence: 'weekly', balanceCap: 150n } })
  const r = await runSubsidySweep(deps, WEEK_A)
  assert.equal(r.totalPoints, 30n, 'clamped to the room under the cap')
  assert.equal(await signorum.balance({ animaId: 'friend' }), 150n)
  // Next cycle: already at cap → skipped.
  const next = await runSubsidySweep(deps, WEEK_B)
  assert.equal(next.skipped, 1)
  assert.equal(next.dripped, 0)
  void s
})

test('fail-closed: an underfunded sponsor drips nothing and RELEASES the cycle for retry', async () => {
  const { sponsiones, signorum, deps } = await harness(0n) // sponsor broke
  const s = await pledge(sponsiones)
  const r = await runSubsidySweep(deps, WEEK_A)
  assert.equal(r.failed, 1)
  assert.equal(r.dripped, 0)
  assert.equal(await signorum.balance({ animaId: 'friend' }), 0n)
  // The cycle was released — after funding, a re-sweep the SAME week now drips.
  const reread = await sponsiones.find(s.id)
  assert.equal(reread?.lastDripCycle, undefined, 'claim released')
  await signorum.issue({ animaId: 'sponsor', forma: 'minted', valor: 500n, auctor: 'topup' })
  const retry = await runSubsidySweep(deps, WEEK_A)
  assert.equal(retry.dripped, 1)
  assert.equal(await signorum.balance({ animaId: 'friend' }), 100n)
})

test('paused pledges are not swept', async () => {
  const { sponsiones, deps } = await harness(1000n)
  const s = await pledge(sponsiones)
  await sponsiones.setStatus(s.id, 'paused')
  const r = await runSubsidySweep(deps, WEEK_A)
  assert.equal(r.dripped, 0)
})
