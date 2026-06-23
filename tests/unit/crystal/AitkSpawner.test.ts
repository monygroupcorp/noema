// Build #5 (live shell) — the docker run arg vector is pure + verifiable in CI (only the
// actual spawn isn't). Pins the flags that matter: detached --rm, --gpus, the --shm-size
// PyTorch's DataLoader needs (its absence killed the first bomhat run with a Bus error),
// env, mounts, workdir, and the run.py command.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAitkDockerArgs, buildAitkChmodArgs } from '../../../src/crystal/AitkSpawner.js'

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

test('buildAitkDockerArgs: detached, named, gpu-pinned, with a default 8g shm', () => {
  const args = buildAitkDockerArgs({ jobId: 'bomhat_klein4b', image: 'stationthis-klein:1', configPath: 'config/bomhat.yaml' })
  assert.ok(args.slice(0, 3).join(' ') === 'run -d --rm')
  assert.equal(flagValue(args, '--name'), 'aitk-bomhat_klein4b')
  assert.equal(flagValue(args, '--gpus'), 'device=0')
  assert.equal(flagValue(args, '--shm-size'), '8g')          // the DataLoader fix — default
  assert.equal(flagValue(args, '-w'), '/aitk')
  // the trailing command runs run.py against the (container-relative) config.
  assert.deepEqual(args.slice(-4), [ 'stationthis-klein:1', 'bash', '-lc', "python -u run.py 'config/bomhat.yaml'" ])
})

test('buildAitkDockerArgs: honours overrides — gpuId, shmSize, mounts, env', () => {
  const args = buildAitkDockerArgs({
    jobId: 'j', image: 'img:1', configPath: 'c.yaml', gpuId: '1', shmSize: '16g',
    mounts: [{ host: '/h/aitk', container: '/aitk' }, { host: '/data/x', container: '/data/x' }],
    env: { HF_HUB_ENABLE_HF_TRANSFER: '0' },
  })
  assert.equal(flagValue(args, '--gpus'), 'device=1')
  assert.equal(flagValue(args, '--shm-size'), '16g')
  // both mounts present, in order.
  const vs = args.reduce<string[]>((acc, a, i) => (a === '-v' ? [...acc, args[i + 1]] : acc), [])
  assert.deepEqual(vs, ['/h/aitk:/aitk', '/data/x:/data/x'])
  // AITK_JOB_ID + AITK_DB always set; extra env appended.
  assert.equal(flagValue(args, '-e'), 'AITK_JOB_ID=j')
  assert.ok(args.includes('AITK_DB=/aitk/aitk_db.db'))
  assert.ok(args.includes('HF_HUB_ENABLE_HF_TRANSFER=0'))
})

test('buildAitkChmodArgs: a fast root chmod of <workdir>/output (no entrypoint, mounts passed)', () => {
  const args = buildAitkChmodArgs({
    image: 'img:1', workdir: '/aitk',
    mounts: [{ host: '/h/aitk', container: '/aitk' }],
  })
  // skips the image's nvidia entrypoint → just chmod
  assert.deepEqual(args.slice(0, 4), ['run', '--rm', '--entrypoint', 'chmod'])
  assert.ok(args.includes('-v') && args.includes('/h/aitk:/aitk'))
  // recursive, group/other read + dir-traverse, on the output dir
  assert.deepEqual(args.slice(-4), ['img:1', '-R', 'a+rX', '/aitk/output'])
})
