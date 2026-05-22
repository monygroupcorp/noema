#!/usr/bin/env node
/**
 * probe-rest-status.js — Provision a SECURE pod via REST API v1 and dump the
 * full raw status response on every poll so we can see exactly what fields
 * are present (publicIp, runtime.ports, portMappings, etc).
 */
require('dotenv').config()

const API_KEY = process.env.RUNPOD_API_KEY
if (!API_KEY) { console.error('RUNPOD_API_KEY not set'); process.exit(1) }

const BASE = 'https://rest.runpod.io/v1'
const IMAGE = 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04'
const GPU_TYPE_IDS = [
  'NVIDIA GeForce RTX 3090',
  'NVIDIA RTX A4000',
  'NVIDIA L4',
  'NVIDIA RTX A4500',
  'NVIDIA GeForce RTX 4090',
]

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a)
const wait = ms => new Promise(r => setTimeout(r, ms))

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text, json: () => JSON.parse(text) }
}

async function main() {
  log('Provisioning SECURE pod...')
  const create = await api('/pods', {
    method: 'POST',
    body: JSON.stringify({
      name: `probe-${Date.now()}`,
      imageName: IMAGE,
      gpuTypeIds: GPU_TYPE_IDS,
      gpuCount: 1,
      cloudType: 'SECURE',
      containerDiskInGb: 20,
      ports: ['22/tcp', '8188/http'],
      supportPublicIp: true,
    }),
  })

  if (!create.ok) { log('Provision failed:', create.body); process.exit(1) }
  const pod = create.json()
  const podId = pod.id
  log(`Pod created: ${podId}`)

  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return; cleaned = true
    log(`Stopping pod ${podId}...`)
    const r = await api(`/pods/${podId}/stop`, { method: 'POST' })
    log('stop response:', r.body)
  }
  process.on('SIGINT', () => cleanup().then(() => process.exit(130)))
  process.on('SIGTERM', () => cleanup().then(() => process.exit(143)))

  const deadline = Date.now() + 8 * 60 * 1000
  let attempt = 0
  try {
    while (Date.now() < deadline) {
      attempt++
      const poll = await api(`/pods/${podId}`)
      if (!poll.ok) { log(`poll ${attempt}: HTTP ${poll.status}`, poll.body); await wait(10000); continue }

      const data = poll.json()
      log(`\n--- poll ${attempt} ---`)
      console.log(JSON.stringify(data, null, 2))

      // Check if SSH is available
      const ports = data.runtime?.ports ?? []
      const ssh = ports.find(p => p.privatePort === 22 && p.type === 'tcp')
      if (ssh) {
        log(`SSH ready: ${ssh.ip}:${ssh.publicPort}`)
        break
      }

      await wait(10000)
    }
  } finally {
    await cleanup()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
