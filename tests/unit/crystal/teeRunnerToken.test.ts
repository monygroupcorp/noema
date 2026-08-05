// TEE runner-callback authentication (hardware-path plan §"smaller hardening"):
// a per-session token is injected into the pod at provision; /runner/* callbacks
// that can move a live pod's billing must echo it or they're dropped. Also covers
// the provisioner-owned ingress (TeePodProvisioner.ingress) on the ready path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import type { TeePodProvisioner, TeeProvisionResult, TeeIngress } from '../../../src/crystal/TeePodProvisioner.js'

class FakeProvisioner implements TeePodProvisioner {
  captured: { sessionId?: string; runnerToken?: string } = {}
  ingressValue: TeeIngress | null = { proxyUrl: 'socks5+wss://vm-a.tee.example/?gost&insecureudp', endpoint: '127.0.0.1:51820' }
  terminated: string[] = []
  /** Shift()ed per probe call; empty → true. Seed [false, …] to simulate strip-Upgrade hosts. */
  probeQueue: boolean[] = []
  /** When true, provision() stalls until releaseProvision() — simulates a slow pod create. */
  manual = false
  private podCounter = 0
  private pending: Array<() => void> = []

  async provision(sessionId: string, _wg: string, onPodCreated?: (podId: string) => void, runnerToken?: string): Promise<TeeProvisionResult> {
    this.captured = { sessionId, runnerToken }
    const podId = `pod-${++this.podCounter}`
    if (this.manual) {
      return new Promise(resolve => this.pending.push(() => {
        onPodCreated?.(podId)
        resolve({ podId, costPerHrUsd: 1 })
      }))
    }
    onPodCreated?.(podId)
    return { podId, costPerHrUsd: 1 }
  }
  releaseProvision(): void { this.pending.shift()?.() }
  async probeWSUpgrade(): Promise<boolean> { return this.probeQueue.length ? this.probeQueue.shift()! : true }
  async terminate(podId: string): Promise<void> { this.terminated.push(podId) }
  ingress(): TeeIngress | null { return this.ingressValue }
}

async function makeApi() {
  const provisioner = new FakeProvisioner()
  const signorum = { balance: async () => 1_000_000n }
  const api = new CrystalApi({ signorum, teeProvisioner: provisioner } as unknown as CrystalApiDeps)
  const auctor = { animaId: 'anima-1' }
  const session = await api.provisionTeeSession(auctor, { wgClientPublicKey: 'wg-client-pub' })
  await new Promise(r => setImmediate(r))   // let the fire-and-forget provision settle
  const token = provisioner.captured.runnerToken!
  return { api, auctor, provisioner, sessionId: session.sessionId, token }
}

test('provision injects a per-session runner token; it never leaks onto the session view', async () => {
  const { api, auctor, sessionId, token } = await makeApi()
  assert.ok(token, 'a runner token is passed to the provisioner')
  const view = await api.getTeeSession(auctor, sessionId) as unknown as Record<string, unknown>
  assert.ok(!Object.values(view).includes(token), 'token must not surface on TeeSessionView')
})

test('runner ready with the right token → session ready with the provisioner-owned ingress', async () => {
  const { api, auctor, sessionId, token } = await makeApi()
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'srv-pub', runnerToken: token })
  const view = await api.getTeeSession(auctor, sessionId)
  assert.equal(view.status, 'ready')
  assert.equal(view.proxyUrl, 'socks5+wss://vm-a.tee.example/?gost&insecureudp')
  assert.equal(view.endpoint, '127.0.0.1:51820')
})

test('runner ready with a WRONG token is dropped — session stays provisioning', async () => {
  const { api, auctor, sessionId } = await makeApi()
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'evil', runnerToken: 'guess' })
  const view = await api.getTeeSession(auctor, sessionId)
  assert.equal(view.status, 'provisioning')
  assert.equal(view.serverPublicKey, undefined)
})

test('grace: a TOKENLESS ready is tolerated (legacy runner image predates the token)', async () => {
  const { api, auctor, sessionId } = await makeApi()
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'srv-pub' })
  assert.equal((await api.getTeeSession(auctor, sessionId)).status, 'ready')
})

test('ratchet: once the pod proves the token, tokenless callbacks are dropped', async () => {
  const { api, auctor, sessionId, token } = await makeApi()
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'srv-pub', runnerToken: token })
  // Legacy grace no longer applies — this session's pod knows the token.
  assert.deepEqual(await api.handleRunnerHeartbeat({ sessionId, gpuHours: 0, status: 'active' }), { continue: false })
  await api.handleRunnerEnded({ sessionId, gpuHours: 0, status: 'ended' })
  assert.equal((await api.getTeeSession(auctor, sessionId)).status, 'ready')
})

test('heartbeat with a wrong token is dropped ({continue:false}, no billing state touched)', async () => {
  const { api, auctor, sessionId, token } = await makeApi()
  assert.deepEqual(await api.handleRunnerHeartbeat({ sessionId, gpuHours: 9, status: 'active', runnerToken: 'guess' }), { continue: false })
  assert.equal((await api.getTeeSession(auctor, sessionId)).gpuHours, undefined)
  // The real pod keeps going.
  assert.deepEqual(await api.handleRunnerHeartbeat({ sessionId, gpuHours: 0, status: 'active', runnerToken: token }), { continue: true })
})

test('runner ended with a wrong token is dropped — pod is not terminated, session stays live', async () => {
  const { api, auctor, provisioner, sessionId, token } = await makeApi()
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'srv-pub', runnerToken: token })
  await api.handleRunnerEnded({ sessionId, gpuHours: 0, status: 'ended', runnerToken: 'guess' })
  assert.equal((await api.getTeeSession(auctor, sessionId)).status, 'ready')
  assert.deepEqual(provisioner.terminated, [])
})

test('sessionId-bound status report with a wrong token does not move the session phase', async () => {
  const { api, auctor, sessionId, token } = await makeApi()
  await api.reportProgressus({ sessionId, progressus: { phase: 'loading' }, runnerToken: 'guess' })
  assert.equal((await api.getTeeSession(auctor, sessionId)).phase, 'provisioning')
  await api.reportProgressus({ sessionId, progressus: { phase: 'loading' }, runnerToken: token })
  assert.equal((await api.getTeeSession(auctor, sessionId)).phase, 'loading')
})

test('probe-kill race: the dying pod\'s clean ended is ignored while the re-provision is in flight', async () => {
  const { api, auctor, provisioner, sessionId, token } = await makeApi()
  provisioner.probeQueue = [false, true]   // first host strips Upgrade, replacement is good

  // Ready from pod-1 → probe fails → pod-1 killed, replacement (pod-2) provisioning.
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'pk1', runnerToken: token })
  assert.deepEqual(provisioner.terminated, ['pod-1'])
  assert.equal((await api.getTeeSession(auctor, sessionId)).status, 'provisioning')

  // The corpse posts a clean 'ended' on its way down (seen live 2026-07-03) —
  // it must NOT kill the session out from under the transparent retry.
  await api.handleRunnerEnded({ sessionId, gpuHours: 0, status: 'ended', runnerToken: token })
  assert.equal((await api.getTeeSession(auctor, sessionId)).status, 'provisioning')

  // Replacement comes up, probe passes → session ready.
  await new Promise(r => setImmediate(r))
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'pk2', runnerToken: token })
  assert.equal((await api.getTeeSession(auctor, sessionId)).status, 'ready')
})

test('ready on an ended session does not resurrect it; the live pod is killed', async () => {
  const { api, auctor, provisioner, sessionId, token } = await makeApi()
  await api.endTeeSession(auctor, sessionId)
  await api.handleRunnerReady({ sessionId, endpoint: '1.2.3.4:51820', wgPublicKey: 'pk', runnerToken: token })
  const view = await api.getTeeSession(auctor, sessionId)
  assert.equal(view.status, 'ended')
  assert.equal(view.serverPublicKey, undefined)
  assert.ok(provisioner.terminated.includes('pod-1'))
})

test('provision resolving after the session ended terminates the fresh pod (no orphan)', async () => {
  const provisioner = new FakeProvisioner()
  provisioner.manual = true
  const signorum = { balance: async () => 1_000_000n }
  const api = new CrystalApi({ signorum, teeProvisioner: provisioner } as unknown as CrystalApiDeps)
  const auctor = { animaId: 'anima-orphan' }
  const session = await api.provisionTeeSession(auctor, { wgClientPublicKey: 'wg-pub' })

  await api.endTeeSession(auctor, session.sessionId)   // podId not set yet — nothing to terminate
  assert.deepEqual(provisioner.terminated, [])

  provisioner.releaseProvision()                       // pod create finally completes
  await new Promise(r => setImmediate(r))
  assert.deepEqual(provisioner.terminated, ['pod-1'])  // fresh pod killed, not orphaned
})

test('ready watchdog: a session that never becomes ready is failed and its pod terminated', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const provisioner = new FakeProvisioner()
  const signorum = { balance: async () => 1_000_000n }
  const api = new CrystalApi({ signorum, teeProvisioner: provisioner } as unknown as CrystalApiDeps)
  const auctor = { animaId: 'anima-watchdog' }
  const session = await api.provisionTeeSession(auctor, { wgClientPublicKey: 'wg-pub' })
  await new Promise(r => setImmediate(r))   // let provision settle (podId set)

  t.mock.timers.tick(21 * 60_000)   // past TEE_READY_WATCHDOG_MS with no /runner/ready
  const view = await api.getTeeSession(auctor, session.sessionId)
  assert.equal(view.status, 'ended')
  assert.match(view.error ?? '', /never became ready/)
  await new Promise(r => setImmediate(r))   // let the fire-and-forget terminate land
  assert.deepEqual(provisioner.terminated, ['pod-1'])
})

test('local dev (no provisioner) issues no token and accepts bare callbacks', async () => {
  const signorum = { balance: async () => 1_000_000n }
  const api = new CrystalApi({ signorum } as unknown as CrystalApiDeps)
  const auctor = { animaId: 'anima-2' }
  const session = await api.provisionTeeSession(auctor, { wgClientPublicKey: 'wg-pub' })
  await api.handleRunnerReady({ sessionId: session.sessionId, endpoint: '127.0.0.1:51820', wgPublicKey: 'srv-pub' })
  assert.equal((await api.getTeeSession(auctor, session.sessionId)).status, 'ready')
})
