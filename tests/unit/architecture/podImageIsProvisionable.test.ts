import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_ESSENTIAE } from '../../../src/crystal/seeds/essentiae.js'

// A pod-dispatched substrate is provisioned REMOTELY and bootstrapped over SSH:
// `SecurePodClient._waitForSshd` must reach an sshd running inside the container before
// `_bootstrap` can clone anything. An image that is perfect for the workload but ships no
// sshd therefore fails at provision time, ~10 minutes in (`sshReadyTimeoutMs`), with no pod
// record ever attached — a failure that looks like capacity trouble and is not.
//
// This is easy to get wrong in exactly one way: copying the image a local rig builds FROM.
// A rig runs its image under local docker, where nothing needs SSH. The platform does not.
// noema-372 shipped `pytorch/pytorch:2.13.0-cuda13.0-cudnn9-runtime` for that reason and its
// first live run died waiting for sshd; the fix was the runpod/* image carrying the same
// CUDA and torch.
//
// So: every fundament reachable from a `ministerium: 'runpod'` flow must ride an image from a
// provider namespace known to ship sshd, or say why it does not.

/** Image namespaces whose images ship an sshd the pod bootstrap can reach. */
const PROVISIONABLE_NAMESPACES = ['runpod/']

/** Fundamenta on a runpod flow that deliberately ride something else. Each states why. */
const EXEMPT: Record<string, string> = {}

function runpodFundamentumIds(): Set<string> {
  const ids = new Set<string>()
  for (const e of CANONICAL_ESSENTIAE) {
    if (e.ministerium !== 'runpod' || !e.fundamentumId) continue
    ids.add(e.fundamentumId)
  }
  return ids
}

test('the walk finds runpod-dispatched fundamenta at all (guard is not vacuous)', () => {
  assert.ok(runpodFundamentumIds().size > 0, 'expected at least one runpod-dispatched flow')
})

test('every pod-dispatched fundament rides an image that ships sshd', () => {
  const reachable = runpodFundamentumIds()
  const offenders: string[] = []
  for (const f of CANONICAL_FUNDAMENTA) {
    if (!reachable.has(f.id) || f.id in EXEMPT) continue
    if (!PROVISIONABLE_NAMESPACES.some(ns => f.imageId.startsWith(ns))) {
      offenders.push(`${f.id} → ${f.imageId}:${f.imageVersion}`)
    }
  }
  assert.deepEqual(
    offenders, [],
    'each fundament above is provisioned over SSH but rides an image outside a namespace known ' +
    'to ship sshd. A local rig\'s base image is not automatically a pod image. Pick the ' +
    'runpod/* tag carrying the same CUDA + torch, or add an EXEMPT entry saying how sshd gets ' +
    'into this one.',
  )
})

test('no EXEMPT entry is stale', () => {
  const reachable = runpodFundamentumIds()
  for (const id of Object.keys(EXEMPT)) {
    assert.ok(reachable.has(id), `EXEMPT names '${id}', which no runpod flow reaches any more`)
  }
})
