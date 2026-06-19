#!/usr/bin/env node
// Verify the canonical `make-upscale` compositus (spell) end-to-end on staging.
//
//   node scripts/verify-make-upscale.mjs <commitment> [prompt]
//
// Anon path (ADR-0008/0009 + project_api_allocutio_live): the commitment funds the run.
// Fund one first with scripts/seed-test-commitment.mjs (guards against prod). The run
// dispatches SD1.5 → upscale; the second step should REUSE the hot pod (no cold boot),
// and the final exitus carries `image` (the schema-keyed output, ADR-0009).

const BASE = process.env.STAGING_BASE ?? 'https://staging.noema.art'
const commitment = process.argv[2]
const prompt = process.argv[3] ?? 'a monumental marble lion, golden hour, ultra detailed'

if (!commitment) {
  console.error('usage: node scripts/verify-make-upscale.mjs <commitment> [prompt]')
  process.exit(1)
}

const j = (r) => r.json()
const log = (...a) => console.log(...a)

async function main() {
  // 1. Discover — confirm the spell is registered (it lists among canonical flows).
  const flows = await fetch(`${BASE}/v1/flows`).then(j)
  const spell = (flows.flows ?? []).find((f) => f.id === 'make-upscale')
  log('1. discover  →', spell ? `found '${spell.nomen}' (${spell.id}@${spell.versio})` : '❌ make-upscale NOT in /v1/flows')
  if (!spell) process.exit(2)

  // 2. Quote — should SUM both steps' estimates (compositus-aware _estimate).
  const quote = await fetch(`${BASE}/v1/runs/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modusId: 'make-upscale', aditus: { prompt }, commitment }),
  }).then(j)
  log('2. quote     →', JSON.stringify(quote))

  // 3. Invoke — dispatch the spell.
  const run = await fetch(`${BASE}/v1/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modusId: 'make-upscale', aditus: { prompt }, commitment }),
  }).then(j)
  const runId = run.run?.id ?? run.id
  log('3. invoke    →', runId ? `run ${runId} (${run.run?.status ?? run.status})` : `❌ ${JSON.stringify(run)}`)
  if (!runId) process.exit(3)

  // 4. Observe — poll the PARENT run until terminal. The chain advances across the
  //    async step boundary via the webhook (compositusRouter); the parent walks
  //    nascens/agens → completus and its exitus = the upscale step's image.
  const deadline = Date.now() + 12 * 60_000
  let last = ''
  while (Date.now() < deadline) {
    const got = await fetch(`${BASE}/v1/runs/${runId}`, { headers: { 'x-commitment': commitment } }).then(j)
    const r = got.run ?? got
    if (r.status !== last) { log(`   …${r.status}`); last = r.status }
    if (r.status === 'completus' || r.status === 'completed') {
      log('4. DONE      → exitus:', JSON.stringify(r.exitus))
      const img = r.exitus?.image
      log(img ? `✅ upscaled image: ${img}` : '⚠️  no `image` in exitus — check the exitus-key contract')
      return
    }
    if (r.status === 'fractus' || r.status === 'failed') {
      log('4. FAILED    →', r.error ?? JSON.stringify(r)); process.exit(4)
    }
    await new Promise((res) => setTimeout(res, 3000))
  }
  log('⏱  timed out waiting for completion'); process.exit(5)
}

main().catch((e) => { console.error(e); process.exit(1) })
