#!/usr/bin/env -S npx tsx
// =============================================================================
// clip-pod — bring up the CLIP embedding service on a CPU pod, behind a job token
// =============================================================================
//
// The embedding service is CPU-only by design (`clip_service/Dockerfile` installs the
// CPU torch wheel precisely so the image stays small), so it runs on a CPU pod and
// pays CPU rates. On RunPod that pod is reachable at a public proxy hostname, which
// is why the service takes a job token: without one, every embed route on it is an
// open inference endpoint that will also fetch any URL it is handed.
//
// This script provisions the pod, mints the token, and does not print anything until
// it has SEEN the service refuse an unauthenticated embed (`bootstrapClipService`).
// A pod that fails either check is terminated rather than left running.
//
// Run:
//   RUNPOD_API_KEY=… CLIP_POD_IMAGE=<registry>/noema-clip:<tag> npx tsx scripts/clip-pod.ts
//
// It prints the two lines the deployment needs. Nothing is written to any file: the
// token is a credential, and where a credential is kept is a property of the machine
// running the platform, not of this repository.
// =============================================================================

import { randomBytes } from 'node:crypto'
import {
  SecurePodClient,
  makeSecurePodSshFactory,
  DEFAULT_CPU_INSTANCE_IDS,
} from '../src/crystal/SecurePodClient.js'

const API_KEY = process.env.RUNPOD_API_KEY
const IMAGE = process.env.CLIP_POD_IMAGE
const INSTANCE_IDS = process.env.CLIP_POD_INSTANCE_IDS?.split(',').map(s => s.trim()).filter(Boolean)

async function main(): Promise<void> {
  if (!API_KEY) throw new Error('RUNPOD_API_KEY is not set')
  if (!IMAGE) throw new Error('CLIP_POD_IMAGE is not set (the published clip_service image ref)')

  // 32 bytes of randomness, hex — long enough that the proxy hostname being guessable
  // buys nothing, and it never leaves this process except to the pod and stdout.
  const jobToken = randomBytes(32).toString('hex')

  const client = new SecurePodClient(
    // The CPU path uses neither SSH nor a key, but the config shape asks for a path;
    // the ssh factory below is never called for a pod provisioned this way.
    { apiKey: API_KEY, sshKeyPath: process.env.RUNPOD_SSH_KEY_PATH ?? '/dev/null' },
    makeSecurePodSshFactory(process.env.RUNPOD_SSH_KEY_PATH ?? '/dev/null'),
    globalThis.fetch,
  )

  console.log(`provisioning a CPU pod (${(INSTANCE_IDS ?? DEFAULT_CPU_INSTANCE_IDS).join(', ')}) for ${IMAGE}…`)
  const { podId, baseUrl } = await client.bootstrapClipService({
    jobToken,
    imageName: IMAGE,
    ...(INSTANCE_IDS ? { instanceIds: INSTANCE_IDS } : {}),
  })

  console.log(`\npod ${podId} is up, embed routes token-gated. Set these on the platform:\n`)
  console.log(`CLIP_SERVICE_URL=${baseUrl}`)
  console.log(`CLIP_JOB_TOKEN=${jobToken}`)
}

main().catch((err: unknown) => {
  console.error(String((err as Error)?.message ?? err))
  process.exit(1)
})
