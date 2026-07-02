import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distributeOwnerReward } from '../../../src/crystal/ownerReward.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import type { AnimaStore } from '../../../src/types/anima.js'

const OWNER = '0x' + 'a'.repeat(40)

function animaeFake() {
  const byCustos = new Map<string, { id: string; nomen: string; custos?: string }>()
  let n = 0
  const created: string[] = []
  const animae: Pick<AnimaStore, 'findByCustos' | 'create'> = {
    async findByCustos(custos) {
      return (byCustos.get(custos) ?? null) as never
    },
    async create(input) {
      const a = { id: `anima-${++n}`, ...input }
      if (input.custos) byCustos.set(input.custos, a)
      created.push(a.id)
      return a as never
    },
  }
  return { animae, created, byCustos }
}

test('skims the default 5% and credits reward signa to a newly-minted owner Anima', async () => {
  const { animae, created } = animaeFake()
  const signorum = new MemorySignorum()
  const out = await distributeOwnerReward({ animae, signorum }, { ownerAddress: OWNER, grossImpetus: 1000n, agentId: 'camel42' })
  assert.equal(out.status, 'credited')
  if (out.status !== 'credited') return
  assert.equal(out.points, 50n) // 5% of 1000
  assert.equal(created.length, 1, 'owner Anima minted by custos')
  // The reward is real, spendable balance on the owner's Anima.
  assert.equal(await signorum.balance({ animaId: out.ownerAnimaId }), 50n)
})

test('reuses an existing owner Anima (found by custos) — no duplicate mint', async () => {
  const { animae, byCustos, created } = animaeFake()
  byCustos.set(OWNER, { id: 'existing-owner', nomen: 'me', custos: OWNER })
  const signorum = new MemorySignorum()
  const out = await distributeOwnerReward({ animae, signorum }, { ownerAddress: OWNER, grossImpetus: 2000n, revShareBps: 1000, agentId: 'camel42' })
  assert.equal(out.status, 'credited')
  if (out.status !== 'credited') return
  assert.equal(out.ownerAnimaId, 'existing-owner')
  assert.equal(out.points, 200n) // 10% of 2000
  assert.equal(created.length, 0, 'no new Anima created')
})

test('skips a zero skim and an invalid owner address', async () => {
  const { animae } = animaeFake()
  const signorum = new MemorySignorum()
  assert.equal((await distributeOwnerReward({ animae, signorum }, { ownerAddress: OWNER, grossImpetus: 5n, agentId: 'a' })).status, 'skipped', '5% of 5 = 0')
  assert.equal((await distributeOwnerReward({ animae, signorum }, { ownerAddress: 'not-an-address', grossImpetus: 1000n, agentId: 'a' })).status, 'skipped')
})
