#!/usr/bin/env node
/**
 * benchmark-cold-start-runpod.js — RunPod equivalent of the unbaked VastAI
 * cold-start benchmark (scripts/vastai/benchmark-cold-start.js).
 *
 * Same per-run sequence so output JSON is directly comparable:
 *   1. Provision pod
 *   2. Wait for SSH
 *   3. Git clone ComfyUI
 *   4. Upgrade PyTorch (cu121)
 *   5. Pip install ComfyUI requirements
 *   6. Start ComfyUI in background
 *   7. Download 5 models from R2 in parallel (~33GB)
 *   8. Wait for ComfyUI API
 *   9. Run minimal FLUX-schnell generation
 *
 * Image choice: `runpod/pytorch:2.1.0-py3.10-cuda12.1.1-devel-ubuntu22.04`.
 * RunPod's official PyTorch image has sshd pre-installed and honors
 * PUBLIC_KEY at boot — no bootstrap overhead. VastAI's flow uses
 * `pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime` because VastAI overlays
 * its own SSHd on any image. Each provider gets the image that fits its
 * native deploy model — the workload (clone + pip + downloads + run) is
 * what we're actually measuring.
 *
 * Usage:
 *   node scripts/runpod/benchmark-cold-start-runpod.js
 *   node scripts/runpod/benchmark-cold-start-runpod.js --runs 3
 *   node scripts/runpod/benchmark-cold-start-runpod.js --runs 1 --skip-generation
 *   node scripts/runpod/benchmark-cold-start-runpod.js --runs 2 --cloud SECURE
 *
 * Output: docs/benchmarks/runpod-cold-start-{timestamp}.json
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { RunPodPodService } = require('../../src/core/services/runpod');
const { getRunPodPodConfig } = require('../../src/config/runpodPod');
const SshTransport = require('../../src/core/services/remote/SshTransport');

const DOCKER_IMAGE = 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04';
const COMFYUI_PORT = 8188;
const R2_BASE = 'https://models.miladystation2.net';

// Same five models as the VastAI benchmark — matches scripts/vastai/benchmark-cold-start.js
const MODELS = {
  unet:   { url: `${R2_BASE}/unet/flux1-schnell.safetensors`, dest: 'unet/flux1-schnell.safetensors', size: '23GB' },
  vae:    { url: `${R2_BASE}/vae/ae.safetensors`,             dest: 'vae/ae.safetensors',             size: '320MB' },
  t5xxl:  { url: `${R2_BASE}/clip/t5xxl_fp16.safetensors`,    dest: 'clip/t5xxl_fp16.safetensors',    size: '9.2GB' },
  clip_l: { url: `${R2_BASE}/clip/clip_l.safetensors`,        dest: 'clip/clip_l.safetensors',        size: '235MB' },
  lora:   { url: `${R2_BASE}/loras/b0throps.safetensors`,     dest: 'loras/b0throps.safetensors',     size: '328MB' },
};

class RunPodColdStartBenchmark {
  constructor({ skipGeneration, cloudType }) {
    this.skipGeneration = !!skipGeneration;
    this.cloudType = (cloudType || 'COMMUNITY').toUpperCase();

    this.logger = {
      info: (...a) => console.log(`[${new Date().toISOString()}] INFO:`, ...a),
      warn: (...a) => console.log(`[${new Date().toISOString()}] WARN:`, ...a),
      error: (...a) => console.error(`[${new Date().toISOString()}] ERROR:`, ...a),
    };

    this.config = getRunPodPodConfig();
    this.service = new RunPodPodService({ logger: this.logger, config: this.config });
    this.results = [];
    this.activeInstanceId = null; // tracked so a signal handler can clean it up

    // SIGINT/SIGTERM cleanup — ensures Ctrl-C / TaskStop doesn't leak a pod.
    // The per-run finally{} clears activeInstanceId; if a signal arrives mid-run,
    // we synchronously fire-and-forget a terminate request before exiting.
    const shutdown = (sig) => {
      if (!this.activeInstanceId) {
        process.exit(130);
      }
      const id = this.activeInstanceId;
      this.activeInstanceId = null;
      console.error(`\n[${sig}] terminating active pod ${id} before exit...`);
      this.service.terminateInstance(id)
        .then(() => { console.error(`[${sig}] pod ${id} terminated.`); process.exit(130); })
        .catch((err) => { console.error(`[${sig}] terminate failed: ${err.message}. CHECK DASHBOARD.`); process.exit(130); });
      // Hard-fail if termination hangs > 10s
      setTimeout(() => { console.error(`[${sig}] terminate timed out after 10s. CHECK DASHBOARD for pod ${id}.`); process.exit(130); }, 10000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  async runBenchmark(numRuns) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`RunPod Cold Start Benchmark — ${numRuns} runs`);
    console.log('='.repeat(60));
    console.log(`Image:           ${DOCKER_IMAGE}`);
    console.log(`Cloud:           ${this.cloudType}`);
    console.log(`Skip generation: ${this.skipGeneration}`);

    for (let i = 0; i < numRuns; i++) {
      console.log(`\n--- Run ${i + 1}/${numRuns} ---\n`);
      try {
        const result = await this.runSingleTest(i + 1);
        this.results.push(result);
        this.printRunSummary(result);
      } catch (err) {
        this.logger.error(`Run ${i + 1} failed:`, err.message);
        this.results.push({
          run: i + 1,
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }

      if (i < numRuns - 1) {
        console.log('\nPausing 10s before next run...');
        await this._wait(10000);
      }
    }

    this.printFinalReport();
    await this.saveResults();
  }

  async runSingleTest(runNumber) {
    const timing = {
      run: runNumber,
      success: true,
      timestamp: new Date().toISOString(),
      provider: 'runpod',
      cloudType: this.cloudType,
      image: DOCKER_IMAGE,
      instanceId: null,
      gpuType: null,
      sshHost: null,
      hourlyRate: null,
      // Match VastAI benchmark field shape exactly so result JSON diffs are easy
      provisionTime: 0,
      sshReadyTime: 0,
      gitCloneTime: 0,
      pytorchUpgradeTime: 0,
      requirementsTime: 0,
      downloadTime: 0,
      downloadDetails: {},
      comfyuiStartTime: 0,
      generationTime: 0,
      totalTime: 0,
    };

    const totalStart = Date.now();
    let ssh = null;
    let instanceId = null;

    try {
      // 1. Provision — pass priority list of GPU types, RunPod picks first available
      const provisionStart = Date.now();
      const offers = await this.service.searchOffers({ cloudType: this.cloudType });
      if (!offers?.length) throw new Error('No RunPod offers configured');

      // Curated GPU trio that test-ssh.js verified working on COMMUNITY today.
      // Wider lists let RunPod's "availability" picker fall back to GPU types
      // that report available but then hit a 500 at the per-host level.
      const gpuTypeIds = [
        'NVIDIA RTX A4000',
        'NVIDIA GeForce RTX 3090',
        'NVIDIA RTX A4500',
      ];
      timing.gpuType = gpuTypeIds[0];
      timing.offerId = gpuTypeIds[0];
      timing.datacenter = this.cloudType;

      const instance = await this.service.provisionInstance({
        gpuTypeIds,
        image: DOCKER_IMAGE,
        diskGb: 45,
        label: `runpod-bench-${runNumber}-${Date.now()}`,
        cloudType: this.cloudType,
        ports: ['22/tcp', '8188/http'],
      });
      instanceId = instance.instanceId;
      this.activeInstanceId = instanceId; // signal handler will clean this up if interrupted
      timing.instanceId = instanceId;
      timing.provisionTime = (Date.now() - provisionStart) / 1000;

      // 2. Wait for SSH (image pull happens here on cold hosts)
      const sshStart = Date.now();
      ssh = await this._waitForSsh(instanceId);
      timing.sshReadyTime = (Date.now() - sshStart) / 1000;

      const status = await this.service.getInstanceStatus(instanceId);
      timing.sshHost = status.publicIp || status.sshHost;
      timing.gpuType = status.gpuType || timing.gpuType;
      timing.hourlyRate = status.hourlyUsd ?? timing.hourlyRate;

      // 3. Git clone ComfyUI
      const gitStart = Date.now();
      await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120000 });
      await ssh.exec('cd /root && rm -rf ComfyUI && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git', { timeout: 120000 });
      timing.gitCloneTime = (Date.now() - gitStart) / 1000;

      // 4. PyTorch upgrade — image is already torch 2.4 + cu124, no upgrade needed
      const pytorchStart = Date.now();
      await ssh.exec('python -c "import torch; print(torch.__version__, torch.cuda.is_available())"', { timeout: 30000 });
      timing.pytorchUpgradeTime = (Date.now() - pytorchStart) / 1000;

      // 5. Requirements
      const reqStart = Date.now();
      await ssh.exec('cd /root/ComfyUI && pip install -r requirements.txt -q', { timeout: 300000 });
      timing.requirementsTime = (Date.now() - reqStart) / 1000;

      // 6. Start ComfyUI in background
      const comfyStart = Date.now();
      await ssh.exec('mkdir -p /root/ComfyUI/models/unet /root/ComfyUI/models/vae /root/ComfyUI/models/clip /root/ComfyUI/models/loras');
      const scriptLines = [
        '#!/bin/bash',
        'cd /root/ComfyUI',
        `python main.py --listen 0.0.0.0 --port ${COMFYUI_PORT} >> /tmp/comfyui.log 2>&1 &`,
        'echo $! > /tmp/comfyui.pid',
      ];
      await ssh.exec(`echo '${scriptLines.join('\n')}' > /tmp/start_comfy.sh && chmod +x /tmp/start_comfy.sh`);
      await ssh.exec('setsid /tmp/start_comfy.sh </dev/null >/dev/null 2>&1 &', { timeout: 5000 }).catch(() => {});
      await this._wait(15000);
      timing.comfyuiStartTime = (Date.now() - comfyStart) / 1000;

      // 7. Download models in parallel (R2 CDN)
      const downloadStart = Date.now();
      await Promise.all(Object.entries(MODELS).map(async ([name, cfg]) => {
        const destPath = `/root/ComfyUI/models/${cfg.dest}`;
        const start = Date.now();
        await ssh.exec(`wget -q "${cfg.url}" -O ${destPath}`, { timeout: 900000 });
        timing.downloadDetails[name] = (Date.now() - start) / 1000;
      }));
      timing.downloadTime = (Date.now() - downloadStart) / 1000;

      // 8. Wait for ComfyUI API
      let apiReady = false;
      for (let i = 0; i < 30; i++) {
        try {
          const check = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/system_stats`, { stdio: 'pipe', timeout: 5000 });
          if (check && check.includes('system')) { apiReady = true; break; }
        } catch (_) {}
        await this._wait(2000);
      }
      if (!apiReady) {
        const tail = await ssh.exec('tail -50 /tmp/comfyui.log 2>/dev/null', { stdio: 'pipe' }).catch(() => 'no log');
        throw new Error(`ComfyUI API never came up. Log tail:\n${tail}`);
      }

      // 9. Generation (optional)
      if (!this.skipGeneration) {
        const genStart = Date.now();
        const workflow = this._minimalWorkflow();
        const payload = JSON.stringify({ prompt: workflow }).replace(/'/g, "'\\''");
        await ssh.exec(
          `curl -sf -X POST http://localhost:${COMFYUI_PORT}/prompt -H "Content-Type: application/json" -d '${payload}'`,
          { timeout: 15000 }
        );
        let imageReady = false;
        for (let i = 0; i < 90; i++) {
          try {
            const history = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/history`, { stdio: 'pipe', timeout: 5000 });
            const parsed = JSON.parse(history);
            const hasOutput = Object.values(parsed).some((e) =>
              e.outputs && Object.values(e.outputs).some((o) => o.images?.length > 0)
            );
            if (hasOutput) { imageReady = true; break; }
          } catch (_) {}
          await this._wait(2000);
        }
        if (!imageReady) throw new Error('Workflow submitted but no image appeared in /history');
        timing.generationTime = (Date.now() - genStart) / 1000;
      }

      timing.totalTime = (Date.now() - totalStart) / 1000;
    } finally {
      if (instanceId) {
        try {
          await this.service.terminateInstance(instanceId);
          this.logger.info(`Pod ${instanceId} terminated`);
        } catch (err) {
          this.logger.error(`Failed to terminate ${instanceId}:`, err.message);
        }
        this.activeInstanceId = null;
      }
      if (ssh && ssh.close) {
        try { await ssh.close(); } catch (_) {}
      }
    }

    return timing;
  }

  async _waitForSsh(instanceId) {
    const maxWait = 600000; // 10 min — image pull can take a while on cold hosts
    const start = Date.now();
    let attempts = 0;
    let lastError = null;
    while (Date.now() - start < maxWait) {
      const status = await this.service.getInstanceStatus(instanceId);
      if (status.status === 'running' && status.sshHost && status.sshPort && status.sshUser) {
        try {
          const ssh = new SshTransport({
            host: status.sshHost,
            port: status.sshPort,
            username: status.sshUser,
            privateKeyPath: this.config.sshKeyPath,
            logger: this.logger,
          });
          await ssh.exec('echo OK', { timeout: 15000, stdio: 'pipe' });
          return ssh;
        } catch (e) {
          lastError = e;
          attempts += 1;
          if (attempts <= 3 || attempts % 10 === 0) {
            const stderr = (e.stderr || '').slice(-200).replace(/\s+/g, ' ');
            this.logger.warn(`ssh probe ${attempts} (${status.sshHost}:${status.sshPort}) failed: code=${e.code} ${stderr || e.message}`);
          }
        }
      }
      await this._wait(8000);
    }
    const ctx = lastError ? ` (last: code=${lastError.code} ${(lastError.stderr || lastError.message || '').slice(0, 150)})` : '';
    throw new Error(`SSH did not become ready (10 min cap, ${attempts} probes)${ctx}`);
  }

  _minimalWorkflow() {
    // Identical to scripts/vastai/benchmark-cold-start.js for direct comparison
    const seed = Math.floor(Math.random() * 1_000_000);
    return {
      "6":  { "class_type": "EmptyLatentImage",   "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
      "8":  { "class_type": "VAEDecode",          "inputs": { "samples": ["13", 0], "vae": ["10", 0] } },
      "9":  { "class_type": "SaveImage",          "inputs": { "filename_prefix": "runpod-bench", "images": ["8", 0] } },
      "10": { "class_type": "VAELoader",          "inputs": { "vae_name": "ae.safetensors" } },
      "11": { "class_type": "DualCLIPLoader",     "inputs": { "clip_name1": "t5xxl_fp16.safetensors", "clip_name2": "clip_l.safetensors", "type": "flux" } },
      "12": { "class_type": "UNETLoader",         "inputs": { "unet_name": "flux1-schnell.safetensors", "weight_dtype": "fp8_e4m3fn" } },
      "13": { "class_type": "KSampler",           "inputs": { "seed": seed, "steps": 4, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1, "model": ["12", 0], "positive": ["22", 0], "negative": ["22", 0], "latent_image": ["6", 0] } },
      "22": { "class_type": "CLIPTextEncodeFlux", "inputs": { "clip": ["11", 0], "clip_l": "test", "t5xxl": "test", "guidance": 3.5 } },
    };
  }

  printRunSummary(r) {
    if (!r.success) {
      console.log(`  FAILED: ${r.error}`);
      return;
    }
    console.log(`  GPU:           ${r.gpuType} @ $${(r.hourlyRate ?? 0).toFixed(3)}/hr`);
    console.log(`  SSH host:      ${r.sshHost}`);
    console.log(`  Pod:           ${r.instanceId} (${r.datacenter})`);
    console.log(`  Timing:`);
    console.log(`    Provision:        ${r.provisionTime.toFixed(1)}s`);
    console.log(`    SSH ready:        ${r.sshReadyTime.toFixed(1)}s   (incl. image pull on cold hosts)`);
    console.log(`    Git clone:        ${r.gitCloneTime.toFixed(1)}s`);
    console.log(`    PyTorch upgrade:  ${r.pytorchUpgradeTime.toFixed(1)}s`);
    console.log(`    Requirements:     ${r.requirementsTime.toFixed(1)}s`);
    console.log(`    Downloads:        ${r.downloadTime.toFixed(1)}s (parallel from R2)`);
    for (const [n, t] of Object.entries(r.downloadDetails)) {
      console.log(`      - ${n.padEnd(8)} ${t.toFixed(1)}s`);
    }
    console.log(`    ComfyUI start:    ${r.comfyuiStartTime.toFixed(1)}s`);
    console.log(`    Generation:       ${r.generationTime.toFixed(1)}s`);
    console.log(`    TOTAL:            ${r.totalTime.toFixed(1)}s (${(r.totalTime / 60).toFixed(1)} min)`);
  }

  printFinalReport() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('RUNPOD COLD START BENCHMARK SUMMARY');
    console.log('='.repeat(60));

    const successful = this.results.filter((r) => r.success);
    const failed = this.results.filter((r) => !r.success);
    console.log(`\nRuns: ${this.results.length} total, ${successful.length} successful, ${failed.length} failed`);

    if (!successful.length) {
      console.log('No successful runs to analyze.');
      this._printVsVastai(null);
      return;
    }

    const stats = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return {
        min: Math.min(...arr),
        max: Math.max(...arr),
        avg: arr.reduce((a, b) => a + b, 0) / arr.length,
        median: sorted[Math.floor(sorted.length / 2)],
      };
    };

    const totals = successful.map((r) => r.totalTime);
    const downloads = successful.map((r) => r.downloadTime);
    const ssh = successful.map((r) => r.sshReadyTime);
    const setup = successful.map((r) => r.gitCloneTime + r.pytorchUpgradeTime + r.requirementsTime);

    const totalStats = stats(totals);
    const downloadStats = stats(downloads);
    const sshStats = stats(ssh);
    const setupStats = stats(setup);

    console.log('\n--- Total cold start (success only) ---');
    console.log(`  Min:    ${totalStats.min.toFixed(1)}s (${(totalStats.min / 60).toFixed(1)} min)`);
    console.log(`  Max:    ${totalStats.max.toFixed(1)}s (${(totalStats.max / 60).toFixed(1)} min)`);
    console.log(`  Avg:    ${totalStats.avg.toFixed(1)}s (${(totalStats.avg / 60).toFixed(1)} min)`);
    console.log(`  Median: ${totalStats.median.toFixed(1)}s (${(totalStats.median / 60).toFixed(1)} min)`);
    console.log('\n--- Download time (parallel, R2 CDN) ---');
    console.log(`  Min/Avg/Max: ${downloadStats.min.toFixed(1)}s / ${downloadStats.avg.toFixed(1)}s / ${downloadStats.max.toFixed(1)}s`);
    console.log('\n--- SSH ready time (incl. image pull) ---');
    console.log(`  Min/Avg/Max: ${sshStats.min.toFixed(1)}s / ${sshStats.avg.toFixed(1)}s / ${sshStats.max.toFixed(1)}s`);
    console.log('\n--- Setup time (git + pytorch + requirements) ---');
    console.log(`  Min/Avg/Max: ${setupStats.min.toFixed(1)}s / ${setupStats.avg.toFixed(1)}s / ${setupStats.max.toFixed(1)}s`);

    this._printVsVastai(totalStats);
  }

  _printVsVastai(totalStats) {
    console.log('\n--- Comparison vs VastAI baseline (2026-05-04 re-baseline) ---');
    console.log('  Unbaked VastAI: avg 11.0 min, 40% per-attempt success');

    const successful = this.results.filter((r) => r.success);
    const successRate = (successful.length / this.results.length) * 100;
    if (totalStats) {
      console.log(`  Unbaked RunPod: avg ${(totalStats.avg / 60).toFixed(1)} min, success rate ${successRate.toFixed(0)}% (n=${this.results.length})`);
      const delta = ((660 - totalStats.avg) / 660) * 100;
      console.log(`  Δ total time:   ${delta > 0 ? '↓' : '↑'} ${Math.abs(delta).toFixed(0)}% vs VastAI`);
    } else {
      console.log(`  Unbaked RunPod: ${successRate.toFixed(0)}% success rate (n=${this.results.length}), no successful runs`);
    }
  }

  async saveResults() {
    const outDir = path.join(__dirname, '..', '..', 'docs', 'benchmarks');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = path.join(outDir, `runpod-cold-start-${ts}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({
        benchmark: 'runpod-unbaked-cold-start',
        provider: 'runpod',
        image: DOCKER_IMAGE,
        cloudType: this.cloudType,
        startedAt: this.results[0]?.timestamp,
        finishedAt: new Date().toISOString(),
        results: this.results,
      }, null, 2)
    );
    console.log(`\nResults saved to: ${outPath}`);
  }

  _wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

// CLI
const args = process.argv.slice(2);
const runsIdx = args.indexOf('--runs');
const cloudIdx = args.indexOf('--cloud');
const numRuns = runsIdx >= 0 ? parseInt(args[runsIdx + 1], 10) || 2 : 2;
const cloud = cloudIdx >= 0 ? args[cloudIdx + 1] : 'COMMUNITY';
const skipGeneration = args.includes('--skip-generation');

if (args.includes('--help')) {
  console.log(`
RunPod Cold Start Benchmark (unbaked)

Usage:
  node scripts/runpod/benchmark-cold-start-runpod.js [options]

Options:
  --runs N           Number of test runs (default: 2)
  --cloud TYPE       COMMUNITY | SECURE (default: COMMUNITY)
  --skip-generation  Skip the image generation step
  --help             Show this help
`);
  process.exit(0);
}

const bench = new RunPodColdStartBenchmark({ skipGeneration, cloudType: cloud });
bench.runBenchmark(numRuns).catch((err) => {
  console.error('Benchmark crashed:', err);
  process.exit(1);
});
