// ConfidentialPodClient — the Azure confidential-CVM backend behind /v1/sessions/tee
// All ARM traffic goes through an
// injected fetch stub — pool claim, tag-then-start, idempotent retried deallocate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfidentialPodClient, type ConfidentialPodClientConfig } from '../../../src/crystal/ConfidentialPodClient.js'

const BASE_CONFIG: ConfidentialPodClientConfig = {
  tenantId: 'tenant', clientId: 'client', clientSecret: 'secret',
  subscriptionId: 'sub', resourceGroup: 'rg',
  vmNames: ['vm-a', 'vm-b'],
  platformCallback: 'https://staging.noema.art',
  costPerHrUsd: 3.5,
  startPollMs: 1, startTimeoutMs: 2_000, deallocateBackoffMs: 1,
}

/** In-memory ARM: per-VM power state + a call log. */
function makeAzure(states: Record<string, string>, opts: { deallocateStatus?: () => number; deallocateNoop?: boolean } = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  const tags: Record<string, Record<string, string>> = {}
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body
    calls.push({ method, url, body })

    if (url.includes('login.microsoftonline.com')) {
      return json({ access_token: 'tok', expires_in: 3600 })
    }
    const vm = url.match(/virtualMachines\/([^/?]+)/)?.[1]
    if (!vm) return new Response('bad url', { status: 400 })
    // Microsoft.Resources/tags merge endpoint — the only tag-write channel the client
    // may use (a VM-level PATCH would REPLACE the whole collection).
    if (url.includes('/providers/Microsoft.Resources/tags/default')) {
      const b = body as { operation: string; properties: { tags: Record<string, string> } }
      if (method !== 'PATCH' || b.operation !== 'Merge') return new Response('bad tags op', { status: 400 })
      tags[vm] = { ...(tags[vm] ?? {}), ...b.properties.tags }
      return json({})
    }
    if (url.includes('/instanceView')) {
      if (!(vm in states)) return new Response('gone', { status: 404 })
      return json({ statuses: [{ code: `PowerState/${states[vm]}` }] })
    }
    if (url.includes('/start')) {
      states[vm] = 'running'
      return new Response('', { status: 202 })
    }
    if (url.includes('/deallocate')) {
      const status = opts.deallocateStatus?.() ?? 202
      if (status === 202 && !opts.deallocateNoop) states[vm] = 'deallocated'
      return new Response('', { status })
    }
    return new Response('unhandled', { status: 500 })
  }) as typeof fetch
  return { fetchFn, calls, tags, states }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('provision: claims the free CVM, stamps session tags, starts it, returns pool cost', async () => {
  const azure = makeAzure({ 'vm-a': 'deallocated', 'vm-b': 'deallocated' })
  const client = new ConfidentialPodClient(BASE_CONFIG, azure.fetchFn)

  let createdAt: string | undefined
  const result = await client.provision('session-1', 'wg-client-pub', (podId) => { createdAt = podId }, 'runner-tok')

  assert.equal(result.podId, 'vm-a')
  assert.equal(result.costPerHrUsd, 3.5)
  assert.equal(createdAt, 'vm-a')
  // Session parameters ride as tags — the guest reads them from IMDS at boot.
  assert.deepEqual(azure.tags['vm-a'], {
    noemaSessionId: 'session-1',
    noemaPlatformCallback: 'https://staging.noema.art',
    noemaWgClientPubkey: 'wg-client-pub',
    noemaRunnerToken: 'runner-tok',
  })
  assert.equal(azure.states['vm-a'], 'running')
})

test('provision: skips a busy CVM and claims the next free one', async () => {
  const azure = makeAzure({ 'vm-a': 'running', 'vm-b': 'deallocated' })
  const client = new ConfidentialPodClient(BASE_CONFIG, azure.fetchFn)
  const result = await client.provision('session-2', 'wg-pub')
  assert.equal(result.podId, 'vm-b')
})

test('provision: all CVMs busy → clear no-sealed-capacity error, nothing started', async () => {
  const azure = makeAzure({ 'vm-a': 'running', 'vm-b': 'starting' })
  const client = new ConfidentialPodClient(BASE_CONFIG, azure.fetchFn)
  await assert.rejects(client.provision('session-3', 'wg-pub'), /No sealed capacity/)
  assert.ok(!azure.calls.some(c => c.url.includes('/start')))
})

test('provision: concurrent sessions never double-claim one CVM', async () => {
  const azure = makeAzure({ 'vm-a': 'deallocated', 'vm-b': 'deallocated' })
  const client = new ConfidentialPodClient(BASE_CONFIG, azure.fetchFn)
  const [r1, r2] = await Promise.all([
    client.provision('session-4', 'wg-pub'),
    client.provision('session-5', 'wg-pub'),
  ])
  assert.notEqual(r1.podId, r2.podId)
})

test('terminate: deallocates and frees the CVM for the next session', async () => {
  const azure = makeAzure({ 'vm-a': 'deallocated', 'vm-b': 'running' })
  const client = new ConfidentialPodClient(BASE_CONFIG, azure.fetchFn)
  const { podId } = await client.provision('session-6', 'wg-pub')
  await client.terminate(podId)
  assert.equal(azure.states['vm-a'], 'deallocated')
  // Pool slot is free again — the same CVM serves the next session.
  const again = await client.provision('session-7', 'wg-pub')
  assert.equal(again.podId, 'vm-a')
})

test('terminate: "already deallocated" (409 + deallocated state) is success, not an error', async () => {
  const azure = makeAzure({ 'vm-a': 'deallocated' }, { deallocateStatus: () => 409 })
  const client = new ConfidentialPodClient({ ...BASE_CONFIG, vmNames: ['vm-a'] }, azure.fetchFn)
  await client.terminate('vm-a')   // resolves — idempotent
})

test('terminate: a 202-accepted deallocate whose LRO never completes throws loudly (H100 still billing)', async () => {
  const azure = makeAzure({ 'vm-a': 'running' }, { deallocateNoop: true })   // Azure accepts but never deallocates
  const client = new ConfidentialPodClient(
    { ...BASE_CONFIG, vmNames: ['vm-a'], deallocateConfirmMs: 5 }, azure.fetchFn)
  await assert.rejects(client.terminate('vm-a'), /deallocate failed/)
})

test('provision: session tags MERGE — pre-existing operator tags survive', async () => {
  const azure = makeAzure({ 'vm-a': 'deallocated' })
  azure.tags['vm-a'] = { costCenter: 'ops', environment: 'prod' }
  const client = new ConfidentialPodClient({ ...BASE_CONFIG, vmNames: ['vm-a'] }, azure.fetchFn)
  await client.provision('session-8', 'wg-pub')
  assert.equal(azure.tags['vm-a'].costCenter, 'ops')
  assert.equal(azure.tags['vm-a'].environment, 'prod')
  assert.equal(azure.tags['vm-a'].noemaSessionId, 'session-8')
})

test('terminate: persistent ARM failure throws after retries (an orphaned H100 must be loud)', async () => {
  const azure = makeAzure({ 'vm-a': 'running' }, { deallocateStatus: () => 500 })
  const client = new ConfidentialPodClient({ ...BASE_CONFIG, vmNames: ['vm-a'] }, azure.fetchFn)
  await assert.rejects(client.terminate('vm-a'), /deallocate failed/)
})

test('ingress: template maps the CVM name; absent template → null (runner self-reports)', async () => {
  const withTemplate = new ConfidentialPodClient({
    ...BASE_CONFIG, ingressProxyUrlTemplate: 'socks5+wss://{vm}.tee.noema.art/?gost&insecureudp',
  }, makeAzure({}).fetchFn)
  assert.deepEqual(withTemplate.ingress('vm-a'), {
    proxyUrl: 'socks5+wss://vm-a.tee.noema.art/?gost&insecureudp',
    endpoint: '127.0.0.1:51820',
  })
  const without = new ConfidentialPodClient(BASE_CONFIG, makeAzure({}).fetchFn)
  assert.equal(without.ingress('vm-a'), null)
})

test('probeWSUpgrade: always true — we own the WSS ingress', async () => {
  const client = new ConfidentialPodClient(BASE_CONFIG, makeAzure({}).fetchFn)
  assert.equal(await client.probeWSUpgrade('vm-a'), true)
})
