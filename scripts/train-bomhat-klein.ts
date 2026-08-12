/**
 * Live end-to-end verify of build #5 — train the "bomhat" klein-4b LoRA through the CRYSTAL
 * training runner, not the standalone harness.
 *
 * Wires exactly what container.ts/index.ts wire in prod: AitoolkitTrainingCursor +
 * SqliteAitkJobStore + DockerAitkSpawner, with CrystalApi.recordProgressus as the registered
 * recorder (so the §6c Progressus timeline persists on a real Actum, coalesced + rolled up).
 * The only thing bypassed is the dispatch ceremony (Modus/signa/inceptor) — orthogonal to the
 * runner. Run:  npx tsx scripts/train-bomhat-klein.ts
 */
import { homedir } from 'node:os'
import { AitoolkitTrainingCursor } from '../src/crystal/AitoolkitTrainingCursor.js'
import { SqliteAitkJobStore } from '../src/crystal/AitkJobStore.js'
import { DockerAitkSpawner } from '../src/crystal/AitkSpawner.js'
import { MemoryActorum } from '../src/execution/MemoryActorum.js'
import { CrystalApi, type CrystalApiDeps } from '../src/allocutio/api/CrystalApi.js'
import { registerProgressusRecorder } from '../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../src/lib/trace.js'
import { bus } from '../src/lib/bus.js'

const AITK_DIR = process.env.AITK_DIR ?? `${homedir()}/projects/ai/training/ai-toolkit-klein`
const DATASET  = '/mnt/data/datasets/bomhat'
const HF_CACHE = process.env.HF_HOME ?? `${homedir()}/.cache/huggingface`
const JOB_ID   = 'bomhat_klein4b'
const STEPS    = 4000

const ts = (): string => new Date().toISOString().slice(11, 19)

async function main(): Promise<void> {
  const actorum = new MemoryActorum()
  const api = new CrystalApi({ actorum } as unknown as CrystalApiDeps)
  registerProgressusRecorder((id, p) => api.recordProgressus(id, p))

  // Live phase log — every Progressus the runner emits (the moving-bar channel).
  bus.on('actum.progressus', ({ progressus: p }) => {
    const prog = p.progress ? ` ${p.progress.done}${p.progress.total != null ? '/' + p.progress.total : ''} ${p.progress.unit}` : ''
    const eta = p.etaMs != null ? ` eta=${Math.round(p.etaMs / 1000)}s` : ''
    const msg = p.message ? `  — ${p.message}` : ''
    console.log(`[${ts()}] ${p.phase}${p.target ? '/' + p.target : ''}${prog}${eta}${msg}`)
  })

  const cursor = new AitoolkitTrainingCursor({
    store: new SqliteAitkJobStore(`${AITK_DIR}/aitk_db.db`),
    spawner: new DockerAitkSpawner(),
    image: 'stationthis-klein:1',
    mounts: [
      { host: AITK_DIR, container: '/aitk' },
      { host: DATASET, container: DATASET },
      { host: HF_CACHE, container: '/root/.cache/huggingface' },
    ],
    shmSize: '8g',                   // PyTorch DataLoader workers need >64MB /dev/shm
    pollIntervalMs: 5000,
    timeoutMs: 6 * 60 * 60 * 1000,   // 6h cap
  })

  const actum = await actorum.create({
    id: `act-${JOB_ID}`,
    modusId: 'm.train.bomhat', modusVersiono: '1',
    impetus: 0n, signaConsumed: [],
    aditus: { jobId: JOB_ID, steps: STEPS, configPath: 'config/bomhat_klein4b.yaml', gpuId: '0' },
    status: 'agens',
    expirat: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  })

  console.log(`[${ts()}] dispatching ${JOB_ID} (${STEPS} steps) through AitoolkitTrainingCursor — Actum ${actum.id}`)

  try {
    const result = await withTrace(makeTraceContext({ actumId: actum.id }), () => cursor.run(actum))
    const final = await actorum.findById(actum.id)
    console.log(`\n[${ts()}] === COMPLETED ===`)
    console.log('exitus:', JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    console.log('persisted timeline:', final?.progressus?.map(p => (p.target ? `${p.phase}/${p.target}` : p.phase)).join(' → '))
    console.log('phaseDurations (ms):', JSON.stringify(final?.phaseDurations))
    process.exit(0)
  } catch (err) {
    const final = await actorum.findById(actum.id)
    console.error(`\n[${ts()}] === FAILED ===`, err instanceof Error ? err.message : err)
    console.error('timeline:', final?.progressus?.map(p => (p.target ? `${p.phase}/${p.target}` : p.phase)).join(' → '))
    process.exit(1)
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
