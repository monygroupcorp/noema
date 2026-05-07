#!/usr/bin/env node
/**
 * benchmark-warm-queue.js
 *
 * Provisions ONE pod, sets it up cold, then fires two FLUX-schnell jobs
 * back-to-back on the same machine to capture:
 *
 *   cold_total  = provision + SSH + setup + models + inference_1
 *   warm_total  = inference_2 only (ComfyUI running, models already in VRAM)
 *
 * Output: docs/benchmarks/runpod-warm-queue-{timestamp}.json
 *
 * Usage:
 *   node scripts/runpod/benchmark-warm-queue.js
 *   node scripts/runpod/benchmark-warm-queue.js --cloud SECURE
 *   node scripts/runpod/benchmark-warm-queue.js --prompt "a purple fox"
 */
'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const { RunPodPodService } = require('../../src/core/services/runpod');
const { getRunPodPodConfig } = require('../../src/config/runpodPod');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const { Compiler, WorkflowTemplateRegistry } = require('../../src/core/services/runpod');
const { ToolRegistry } = require('../../src/core/tools/ToolRegistry');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(f) { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; }

const CLOUD_TYPE   = (argVal('--cloud') || 'SECURE').toUpperCase();
const PROMPT       = argVal('--prompt') || 'a neon cat in a space station, cinematic';
const COMFYUI_PORT = 8188;

const logger = {
  info:  (...a) => console.log(`[${ts()}] INFO:`,  ...a),
  warn:  (...a) => console.log(`[${ts()}] WARN:`,  ...a),
  error: (...a) => console.error(`[${ts()}] ERR:`, ...a),
  debug: () => {},
};

function ts() { return new Date().toISOString().slice(11, 23); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Build Compiler + tool once
// ---------------------------------------------------------------------------
const toolRegistry = ToolRegistry.getInstance();
toolRegistry.loadStaticTools();
const tool = toolRegistry.getToolById('runmake');
if (!tool) { console.error('FAIL: runmake not in ToolRegistry'); process.exit(1); }

const workflowTemplates = new WorkflowTemplateRegistry({ logger });
const compiler = new Compiler({ workflowTemplates, logger });

// ---------------------------------------------------------------------------
// SSH helpers
// ---------------------------------------------------------------------------
async function waitForSsh(service, config, instanceId, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    let st;
    try {
      st = await service.getInstanceStatus(instanceId);
    } catch (e) {
      logger.warn(`getInstanceStatus failed (${e.message}), retrying...`);
      await wait(10000);
      continue;
    }
    if (st.status === 'running' && st.sshHost && st.sshPort && st.sshUser) {
      const transport = new SshTransport({
        host: st.sshHost, port: st.sshPort, username: st.sshUser,
        privateKeyPath: config.sshKeyPath, logger,
      });
      try {
        await transport.exec('echo OK', { timeout: 15000, stdio: 'pipe' });
        return { transport, instance: st };
      } catch (_) {}
    }
    await wait(8000);
  }
  throw new Error('SSH did not become ready within deadline');
}

async function waitForComfyApi(ssh, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const out = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/system_stats`, { stdio: 'pipe', timeout: 5000 });
      if (out && out.includes('system')) return;
    } catch (_) {}
    await wait(2000);
  }
  throw new Error('ComfyUI API never came up');
}

async function submitWorkflow(ssh, payload) {
  const body = JSON.stringify({ prompt: payload }).replace(/'/g, "'\\''");
  const out = await ssh.exec(
    `curl -sf -X POST http://localhost:${COMFYUI_PORT}/prompt -H "Content-Type: application/json" -d '${body}'`,
    { stdio: 'pipe', timeout: 15000 }
  );
  return JSON.parse(out || '{}').prompt_id || null;
}

async function awaitCompletion(ssh, promptId, jobMs) {
  const deadline = Date.now() + jobMs;
  while (Date.now() < deadline) {
    try {
      const out = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/history`, { stdio: 'pipe', timeout: 5000 });
      const parsed = JSON.parse(out || '{}');
      const entry = promptId ? parsed[promptId] : Object.values(parsed)[0];
      if (entry && entry.outputs) {
        const images = Object.values(entry.outputs).flatMap(n => n.images || []);
        if (images.length) return { images };
      }
    } catch (_) {}
    await wait(2000);
  }
  throw new Error('Workflow did not complete within jobMs');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const config  = getRunPodPodConfig();
  const service = new RunPodPodService({ logger, config });
  let podId = null;
  let ssh   = null;

  const runStart = Date.now();
  const result   = {
    timestamp: new Date().toISOString(),
    cloudType:  CLOUD_TYPE,
    prompt: PROMPT,
    phases: {},
    jobs: [],
    gpuTypeId: null,
    hourlyUsd: null,
  };

  const cleanup = async () => {
    if (podId) {
      try { await service.terminateInstance(podId); logger.info(`Pod ${podId} terminated`); }
      catch (e) { logger.warn(`Terminate failed: ${e.message}`); }
    }
    if (ssh && typeof ssh.close === 'function') {
      try { await ssh.close(); } catch (_) {}
    }
  };

  process.on('SIGINT',  async () => { await cleanup(); process.exit(130); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });

  try {
    // ------------------------------------------------------------------
    // 1. Compile deployment (same payload used for both jobs, different seed)
    // ------------------------------------------------------------------
    const dep1 = await compiler.compile({ tool, inputs: { prompt: PROMPT, input_seed: 100 }, accountContext: { masterAccountId: 'benchmark' } });
    const dep2 = await compiler.compile({ tool, inputs: { prompt: PROMPT, input_seed: 200 }, accountContext: { masterAccountId: 'benchmark' } });
    logger.info(`Compiled: hash1=${dep1.hash.slice(7, 21)}… hash2=${dep2.hash.slice(7, 21)}…`);

    // ------------------------------------------------------------------
    // 2. Provision
    // ------------------------------------------------------------------
    const provStart = Date.now();
    logger.info(`Provisioning ${CLOUD_TYPE} pod...`);
    const gpuTypeIds = ['NVIDIA GeForce RTX 3090', 'NVIDIA RTX A4000', 'NVIDIA GeForce RTX 4090', 'NVIDIA A40'];

    const instance = await service.provisionInstance({
      gpuTypeIds,
      cloudType: CLOUD_TYPE,
      image: dep1.spec.image.ociRef,
      diskGb: 45,
      label: `warmq-${Date.now()}`,
      ports: ['22/tcp', `${COMFYUI_PORT}/http`],
    });
    podId = instance.instanceId;
    logger.info(`Pod ${podId} provisioned (${instance.gpuType || '?'})`);

    // ------------------------------------------------------------------
    // 3. Wait for SSH
    // ------------------------------------------------------------------
    const sshResult = await waitForSsh(service, config, podId, 12 * 60 * 1000);
    ssh = sshResult.transport;
    const status = await service.getInstanceStatus(podId);
    result.gpuTypeId  = status.gpuType  || instance.gpuType  || null;
    result.hourlyUsd  = status.hourlyUsd ?? null;
    result.phases.provisionMs = Date.now() - provStart;
    logger.info(`SSH ready in ${result.phases.provisionMs}ms; gpu=${result.gpuTypeId} $${result.hourlyUsd}/hr`);

    // ------------------------------------------------------------------
    // 4. Setup (clone, pip, mkdir)
    // ------------------------------------------------------------------
    const setupStart = Date.now();
    logger.info('Setting up ComfyUI...');
    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120000 });
    await ssh.exec('cd /root && rm -rf ComfyUI && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git', { timeout: 120000 });
    await ssh.exec('cd /root/ComfyUI && pip install -r requirements.txt -q', { timeout: 300000 });
    await ssh.exec('mkdir -p /root/ComfyUI/models/unet /root/ComfyUI/models/vae /root/ComfyUI/models/clip /root/ComfyUI/models/loras /root/ComfyUI/output');
    result.phases.setupMs = Date.now() - setupStart;
    logger.info(`Setup done in ${result.phases.setupMs}ms`);

    // ------------------------------------------------------------------
    // 5. Start ComfyUI
    // ------------------------------------------------------------------
    const comfyStart = Date.now();
    const scriptLines = [
      '#!/bin/bash', 'cd /root/ComfyUI',
      `python main.py --listen 0.0.0.0 --port ${COMFYUI_PORT} >> /tmp/comfyui.log 2>&1 &`,
      'echo $! > /tmp/comfyui.pid',
    ];
    await ssh.exec(`echo '${scriptLines.join('\n')}' > /tmp/start_comfy.sh && chmod +x /tmp/start_comfy.sh`);
    await ssh.exec('setsid /tmp/start_comfy.sh </dev/null >/dev/null 2>&1 &', { timeout: 5000 }).catch(() => {});

    // ------------------------------------------------------------------
    // 6. Download models (parallel)
    // ------------------------------------------------------------------
    const modelsStart = Date.now();
    logger.info(`Downloading ${dep1.spec.models.length} models in parallel...`);
    await Promise.all(dep1.spec.models.map(async (m) => {
      const dest = `/root/ComfyUI/models/${m.dest}`;
      await ssh.exec(`mkdir -p $(dirname ${dest}) && wget -q "${m.url}" -O ${dest}`, { timeout: 900000 });
      logger.info(`  Downloaded ${m.id}`);
    }));
    result.phases.modelsMs = Date.now() - modelsStart;
    logger.info(`Models done in ${result.phases.modelsMs}ms`);

    // ------------------------------------------------------------------
    // 7. Wait for ComfyUI API (overlaps with model download start)
    // ------------------------------------------------------------------
    await waitForComfyApi(ssh, 5 * 60 * 1000);
    result.phases.comfyReadyMs = Date.now() - comfyStart;
    logger.info(`ComfyUI API ready in ${result.phases.comfyReadyMs}ms`);

    // ------------------------------------------------------------------
    // 8. Job 1 — first inference (cold VRAM load)
    // ------------------------------------------------------------------
    logger.info('\n=== JOB 1 (first inference, cold VRAM) ===');
    const job1Start = Date.now();
    const promptId1 = await submitWorkflow(ssh, dep1.spec.workflow.comfyApiPayload);
    logger.info(`  Submitted prompt_id=${promptId1}`);
    const comp1 = await awaitCompletion(ssh, promptId1, 10 * 60 * 1000);
    const job1Ms = Date.now() - job1Start;
    result.jobs.push({ label: 'cold_inference', seed: 100, promptId: promptId1, inferenceMs: job1Ms, images: comp1.images });
    logger.info(`  Done in ${job1Ms}ms — ${comp1.images.length} image(s)`);

    // ------------------------------------------------------------------
    // 9. Job 2 — second inference (warm VRAM, models cached)
    // ------------------------------------------------------------------
    logger.info('\n=== JOB 2 (second inference, warm VRAM) ===');
    const job2Start = Date.now();
    const promptId2 = await submitWorkflow(ssh, dep2.spec.workflow.comfyApiPayload);
    logger.info(`  Submitted prompt_id=${promptId2}`);
    const comp2 = await awaitCompletion(ssh, promptId2, 5 * 60 * 1000);
    const job2Ms = Date.now() - job2Start;
    result.jobs.push({ label: 'warm_inference', seed: 200, promptId: promptId2, inferenceMs: job2Ms, images: comp2.images });
    logger.info(`  Done in ${job2Ms}ms — ${comp2.images.length} image(s)`);

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------
    result.totalMs = Date.now() - runStart;
    const hourlyUsd = result.hourlyUsd || 0;
    result.totalCostUsd = Number(((hourlyUsd / 3600) * (result.totalMs / 1000)).toFixed(5));

    const coldTotal = result.phases.provisionMs + result.phases.setupMs + result.phases.modelsMs + result.jobs[0].inferenceMs;

    console.log('\n=== RESULTS ===');
    console.log(`GPU:             ${result.gpuTypeId}`);
    console.log(`Rate:            $${result.hourlyUsd}/hr`);
    console.log(`Provision:       ${(result.phases.provisionMs / 1000).toFixed(1)}s`);
    console.log(`Setup (ComfyUI): ${(result.phases.setupMs / 1000).toFixed(1)}s`);
    console.log(`Models DL:       ${(result.phases.modelsMs / 1000).toFixed(1)}s`);
    console.log(`Job 1 inference: ${(result.jobs[0].inferenceMs / 1000).toFixed(1)}s  (cold VRAM)`);
    console.log(`Job 2 inference: ${(result.jobs[1].inferenceMs / 1000).toFixed(1)}s  (warm VRAM)`);
    console.log(`─────────────────────────────────────`);
    console.log(`Cold total:      ${(coldTotal / 1000).toFixed(1)}s`);
    console.log(`Warm total:      ${(result.jobs[1].inferenceMs / 1000).toFixed(1)}s`);
    console.log(`Speedup:         ${(coldTotal / result.jobs[1].inferenceMs).toFixed(1)}x`);
    console.log(`Total wall:      ${(result.totalMs / 1000).toFixed(1)}s`);
    console.log(`Total cost:      $${result.totalCostUsd}`);

  } finally {
    await cleanup();
    podId = null;

    // Write JSON
    const outDir  = path.resolve(__dirname, '../../docs/benchmarks');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `runpod-warm-queue-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 22)}Z.json`);
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    logger.info(`Wrote ${outFile}`);
  }
})().catch(err => {
  console.error('FAIL:', err.stack || err);
  process.exit(1);
});
