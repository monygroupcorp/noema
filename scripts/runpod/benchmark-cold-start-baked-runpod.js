#!/usr/bin/env node
/**
 * benchmark-cold-start-baked-runpod.js — RunPod equivalent of the VastAI
 * baked-image cold-start benchmark.
 *
 * Provider shootout: same baked image, same per-run sequence as
 * scripts/vastai/benchmark-cold-start-baked.js, so the JSON outputs are
 * directly comparable. We're trying to decide between RunPod and VastAI as
 * the ComfyUI Deploy replacement.
 *
 * Per-run sequence (mirrors the VastAI benchmark):
 *   1. Search RunPod GPU types, pick best offer
 *   2. Provision pod with the baked image + PUBLIC_KEY env
 *   3. Wait for SSH ready (this includes Docker pull on cold hosts)
 *   4. Verify baked filesystem
 *   5. Start ComfyUI in background
 *   6. Wait for ComfyUI's API
 *   7. Submit minimal FLUX Schnell workflow
 *   8. Poll /history until image appears
 *   9. Terminate pod
 *
 * Usage:
 *   node scripts/runpod/benchmark-cold-start-baked-runpod.js \
 *     --image stationthis/flux-comfyui-runtime:v1 \
 *     --runs 3
 *
 *   node scripts/runpod/benchmark-cold-start-baked-runpod.js \
 *     --image stationthis/flux-comfyui-runtime:v1 \
 *     --runs 3 \
 *     --cloud SECURE \
 *     --skip-generation
 *
 * Output: docs/benchmarks/runpod-baked-{timestamp}.json
 *
 * IMPORTANT — image SSH compatibility:
 *   The baked flux-comfyui-runtime image does NOT include openssh-server.
 *   RunPod injects PUBLIC_KEY into the env, but expects the image to start
 *   sshd itself. We work around this with a --bootstrap-ssh flag that runs
 *   an apt-install + sshd command via dockerArgs at pod start. This adds
 *   ~20-40s of cold-start overhead vs an image that has sshd baked in. Note
 *   it in the result JSON (`bootstrapSshOverhead: true`).
 *
 *   For the cleanest comparison vs VastAI in the long run, rebuild the image
 *   with openssh-server preinstalled and drop the bootstrap flag.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const { RunPodPodService } = require('../../src/core/services/runpod');
const { getRunPodPodConfig } = require('../../src/config/runpodPod');
const SshTransport = require('../../src/core/services/remote/SshTransport');

const COMFYUI_PORT = 8188;
const COMFYUI_PATH = '/workspace/ComfyUI';

// dockerStartCmd override that installs+starts sshd, then sleeps. Used when
// the baked image lacks openssh-server. Keeps the container alive so we can
// SSH in. Per /v1/openapi.json, dockerStartCmd is a string[] (CMD override).
const SSH_BOOTSTRAP_CMD = [
  'bash',
  '-c',
  'apt-get update -qq && apt-get install -y -qq openssh-server >/dev/null && '
    + 'mkdir -p /run/sshd /root/.ssh && '
    + 'echo "$PUBLIC_KEY" > /root/.ssh/authorized_keys && '
    + 'chmod 600 /root/.ssh/authorized_keys && '
    + '/usr/sbin/sshd && '
    + 'sleep infinity',
];

class RunPodBakedBenchmark {
  constructor({ image, skipGeneration, cloudType, bootstrapSsh }) {
    if (!image) {
      throw new Error('--image is required');
    }
    this.image = image;
    this.skipGeneration = !!skipGeneration;
    this.cloudType = (cloudType || 'COMMUNITY').toUpperCase();
    this.bootstrapSsh = bootstrapSsh !== false; // default true since the baked image lacks sshd

    this.logger = {
      info: (...a) => console.log(`[${new Date().toISOString()}] INFO:`, ...a),
      warn: (...a) => console.log(`[${new Date().toISOString()}] WARN:`, ...a),
      error: (...a) => console.error(`[${new Date().toISOString()}] ERROR:`, ...a),
    };

    this.runpodConfig = getRunPodPodConfig();
    this.runpodService = new RunPodPodService({
      logger: this.logger,
      config: this.runpodConfig,
    });

    this.results = [];
  }

  async run(numRuns) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`RunPod Baked-Image Cold Start Benchmark — ${numRuns} runs`);
    console.log(`Image:           ${this.image}`);
    console.log(`Cloud type:      ${this.cloudType}`);
    console.log(`Bootstrap SSH:   ${this.bootstrapSsh}`);
    console.log(`Skip generation: ${this.skipGeneration}`);
    console.log('='.repeat(60));

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
      image: this.image,
      cloudType: this.cloudType,
      bootstrapSshOverhead: this.bootstrapSsh,
      instanceId: null,
      gpuType: null,
      sshHost: null,
      hourlyRate: null,
      // Timing (seconds) — same field shape as the VastAI baked benchmark
      provisionTime: 0,
      sshReadyTime: 0,
      comfyuiStartTime: 0,
      modelLoadTime: 0,
      generationTime: 0,
      totalTime: 0,
    };

    const totalStart = Date.now();
    let ssh = null;
    let instanceId = null;

    try {
      // 1. Pick offer (priority list — RunPod's gpuTypePriority="availability"
      //    picks the first GPU type in our list that's actually rentable).
      const provisionStart = Date.now();
      const offers = await this.runpodService.searchOffers({
        cloudType: this.cloudType,
      });
      if (!offers?.length) throw new Error('No RunPod GPU offers configured');

      const offer = offers[0];
      timing.gpuType = offer.gpuType;
      timing.hourlyRate = offer.hourlyUsd;
      timing.offerId = offer.id;
      timing.datacenter = offer.cloudType;
      timing.reliability = offer.reliability;

      // 2. Provision — pass the full priority list as gpuTypeIds.
      const provisionContext = {
        gpuTypeIds: offers.map((o) => o.id),
        image: this.image,
        diskGb: 60,
        label: `runpod-baked-bench-${runNumber}-${Date.now()}`,
        cloudType: this.cloudType,
        ports: ['22/tcp', '8188/http'],
      };
      if (this.bootstrapSsh) {
        provisionContext.dockerStartCmd = SSH_BOOTSTRAP_CMD;
      }

      const instance = await this.runpodService.provisionInstance(provisionContext);
      instanceId = instance.instanceId;
      timing.instanceId = instanceId;
      timing.provisionTime = (Date.now() - provisionStart) / 1000;

      // 3. Wait for SSH (includes Docker pull on cold hosts — the headline metric)
      const sshStart = Date.now();
      ssh = await this._waitForSsh(instanceId);
      timing.sshReadyTime = (Date.now() - sshStart) / 1000;

      const status = await this.runpodService.getInstanceStatus(instanceId);
      timing.sshHost = status.sshHost || status.publicIp;

      // 4. Verify baked filesystem
      const lsOutput = await ssh.exec(
        `ls -1 ${COMFYUI_PATH}/models/unet/ ${COMFYUI_PATH}/models/vae/ ${COMFYUI_PATH}/models/clip/ 2>&1`,
        { timeout: 15000, stdio: 'pipe' }
      );
      if (!lsOutput.includes('flux1-schnell.safetensors')
          || !lsOutput.includes('ae.safetensors')
          || !lsOutput.includes('t5xxl_fp16.safetensors')
          || !lsOutput.includes('clip_l.safetensors')) {
        throw new Error(`Baked image missing expected models. Saw: ${lsOutput.slice(0, 500)}`);
      }

      // 5. Start ComfyUI in the background
      const comfyStart = Date.now();
      const startScript = [
        '#!/bin/bash',
        `cd ${COMFYUI_PATH}`,
        `python main.py --listen 0.0.0.0 --port ${COMFYUI_PORT} >> /tmp/comfyui.log 2>&1 &`,
        'echo $! > /tmp/comfyui.pid',
      ].join('\n');
      await ssh.exec(
        `echo '${startScript}' > /tmp/start_comfy.sh && chmod +x /tmp/start_comfy.sh`
      );
      await ssh.exec('setsid /tmp/start_comfy.sh </dev/null >/dev/null 2>&1 &', { timeout: 5000 })
        .catch(() => {}); // expected to "fail" since the process detaches

      // 6. Wait for the API to come up
      let apiReady = false;
      for (let i = 0; i < 60; i++) {
        try {
          const check = await ssh.exec(
            `curl -sf http://localhost:${COMFYUI_PORT}/system_stats`,
            { timeout: 5000, stdio: 'pipe' }
          );
          if (check && check.includes('system')) {
            apiReady = true;
            break;
          }
        } catch (_) {}
        await this._wait(2000);
      }
      if (!apiReady) {
        const tail = await ssh.exec('tail -50 /tmp/comfyui.log 2>/dev/null', { stdio: 'pipe' })
          .catch(() => 'no log');
        throw new Error(`ComfyUI API never came up. Log tail:\n${tail}`);
      }
      timing.comfyuiStartTime = (Date.now() - comfyStart) / 1000;

      // 7. Submit minimal FLUX Schnell workflow
      if (!this.skipGeneration) {
        const genStart = Date.now();
        const workflow = this._minimalFluxWorkflow();
        const payload = JSON.stringify({ prompt: workflow }).replace(/'/g, "'\\''");
        await ssh.exec(
          `curl -sf -X POST http://localhost:${COMFYUI_PORT}/prompt -H "Content-Type: application/json" -d '${payload}'`,
          { timeout: 15000 }
        );

        // Poll /history until an image appears
        let imageReady = false;
        for (let i = 0; i < 90; i++) {
          try {
            const history = await ssh.exec(
              `curl -s http://localhost:${COMFYUI_PORT}/history`,
              { timeout: 5000, stdio: 'pipe' }
            );
            const parsed = JSON.parse(history);
            const hasOutput = Object.values(parsed).some((e) =>
              e.outputs && Object.values(e.outputs).some((o) => o.images?.length > 0)
            );
            if (hasOutput) {
              imageReady = true;
              break;
            }
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
          await this.runpodService.terminateInstance(instanceId);
          this.logger.info(`Pod ${instanceId} terminated`);
        } catch (err) {
          this.logger.error(`Failed to terminate ${instanceId}:`, err.message);
        }
      }
      if (ssh && typeof ssh.close === 'function') {
        try { await ssh.close(); } catch (_) {}
      }
    }

    return timing;
  }

  async _waitForSsh(instanceId) {
    const maxWait = 600000; // 10 min — image pull on cold hosts can take a while
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const status = await this.runpodService.getInstanceStatus(instanceId);

      if (status.status === 'running' && status.sshHost && status.sshPort) {
        try {
          const ssh = new SshTransport({
            host: status.sshHost,
            port: status.sshPort,
            username: 'root',
            privateKeyPath: this.runpodConfig.sshKeyPath,
            logger: this.logger,
          });
          await ssh.exec('echo OK', { timeout: 15000, stdio: 'pipe' });
          return ssh;
        } catch (_) {}
      }

      await this._wait(10000);
    }

    throw new Error('SSH did not become ready (10 min cap)');
  }

  _minimalFluxWorkflow() {
    // Identical workflow shape to scripts/vastai/benchmark-cold-start-baked.js
    // so generation timing is directly comparable.
    const seed = Math.floor(Math.random() * 1_000_000);
    return {
      "6":  { "class_type": "EmptyLatentImage",   "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
      "8":  { "class_type": "VAEDecode",          "inputs": { "samples": ["13", 0], "vae": ["10", 0] } },
      "9":  { "class_type": "SaveImage",          "inputs": { "filename_prefix": "runpod-baked-bench", "images": ["8", 0] } },
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
    console.log(`  GPU:           ${r.gpuType} @ $${r.hourlyRate?.toFixed(3)}/hr (cloud ${r.datacenter})`);
    console.log(`  SSH host:      ${r.sshHost}`);
    console.log(`  Pod:           ${r.instanceId}`);
    console.log(`  Timing:`);
    console.log(`    Provision:        ${r.provisionTime.toFixed(1)}s`);
    console.log(`    SSH ready:        ${r.sshReadyTime.toFixed(1)}s   (incl. image pull on cold hosts)`);
    console.log(`    ComfyUI startup:  ${r.comfyuiStartTime.toFixed(1)}s`);
    console.log(`    Generation:       ${r.generationTime.toFixed(1)}s`);
    console.log(`    TOTAL:            ${r.totalTime.toFixed(1)}s (${(r.totalTime / 60).toFixed(1)} min)`);
  }

  printFinalReport() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('RUNPOD BAKED-IMAGE BENCHMARK SUMMARY');
    console.log('='.repeat(60));

    const successful = this.results.filter((r) => r.success);
    const failed = this.results.filter((r) => !r.success);
    console.log(`\nRuns: ${this.results.length} total, ${successful.length} successful, ${failed.length} failed`);

    if (!successful.length) {
      console.log('No successful runs to analyze.');
      this._printComparisonHeader();
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
    const sshTimes = successful.map((r) => r.sshReadyTime);
    const startTimes = successful.map((r) => r.comfyuiStartTime);
    const genTimes = successful.map((r) => r.generationTime);

    const totalStats = stats(totals);
    const sshStats = stats(sshTimes);
    const startStats = stats(startTimes);
    const genStats = stats(genTimes);

    console.log('\n--- Total cold start (success only) ---');
    console.log(`  Min:    ${totalStats.min.toFixed(1)}s (${(totalStats.min / 60).toFixed(1)} min)`);
    console.log(`  Max:    ${totalStats.max.toFixed(1)}s (${(totalStats.max / 60).toFixed(1)} min)`);
    console.log(`  Avg:    ${totalStats.avg.toFixed(1)}s (${(totalStats.avg / 60).toFixed(1)} min)`);
    console.log(`  Median: ${totalStats.median.toFixed(1)}s (${(totalStats.median / 60).toFixed(1)} min)`);

    console.log('\n--- SSH ready time (proxy for image pull cost) ---');
    console.log(`  Min:    ${sshStats.min.toFixed(1)}s`);
    console.log(`  Max:    ${sshStats.max.toFixed(1)}s`);
    console.log(`  Avg:    ${sshStats.avg.toFixed(1)}s`);

    console.log('\n--- ComfyUI startup time ---');
    console.log(`  Min/Avg/Max: ${startStats.min.toFixed(1)}s / ${startStats.avg.toFixed(1)}s / ${startStats.max.toFixed(1)}s`);

    console.log('\n--- Generation time (FLUX schnell, 512x512, 4 steps) ---');
    console.log(`  Min/Avg/Max: ${genStats.min.toFixed(1)}s / ${genStats.avg.toFixed(1)}s / ${genStats.max.toFixed(1)}s`);

    this._printProviderComparison(totalStats);
  }

  _printComparisonHeader() {
    console.log('\n--- Comparison targets ---');
    console.log('  Unbaked VastAI baseline (2026-05-04): avg 11.0 min, 40% per-attempt success');
    const latestBaked = this._findLatestVastaiBaked();
    if (latestBaked) {
      console.log(`  Baked VastAI (latest): see ${latestBaked}`);
    } else {
      console.log('  Baked VastAI: not yet measured');
    }
  }

  _findLatestVastaiBaked() {
    const dir = path.join(__dirname, '..', '..', 'docs', 'benchmarks');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('vastai-baked-')).sort();
    return files.length ? path.join(dir, files[files.length - 1]) : null;
  }

  _printProviderComparison(totalStats) {
    console.log('\n--- Comparison vs VastAI ---');
    console.log(`  Unbaked VastAI baseline: avg 11.0 min, 40% per-attempt success`);

    const latestBakedPath = this._findLatestVastaiBaked();
    if (latestBakedPath) {
      try {
        const data = JSON.parse(fs.readFileSync(latestBakedPath, 'utf8'));
        const ok = (data.results || []).filter((r) => r.success);
        if (ok.length) {
          const avg = ok.reduce((a, r) => a + r.totalTime, 0) / ok.length;
          const successRate = (ok.length / data.results.length) * 100;
          console.log(`  Baked VastAI (${path.basename(latestBakedPath)}):`);
          console.log(`    avg total: ${(avg / 60).toFixed(1)} min, success rate ${successRate.toFixed(0)}%`);
          const delta = ((avg - totalStats.avg) / avg) * 100;
          console.log(`  RunPod vs baked VastAI: ${delta > 0 ? '↓' : '↑'} ${Math.abs(delta).toFixed(0)}%`);
        } else {
          console.log(`  Baked VastAI (${path.basename(latestBakedPath)}): no successful runs to compare`);
        }
      } catch (err) {
        console.log(`  Baked VastAI: failed to read ${latestBakedPath} (${err.message})`);
      }
    } else {
      console.log('  Baked VastAI: not yet measured');
    }

    const successful = this.results.filter((r) => r.success);
    const successRate = (successful.length / this.results.length) * 100;
    console.log(`  RunPod baked: avg ${(totalStats.avg / 60).toFixed(1)} min, success rate ${successRate.toFixed(0)}%`);
  }

  async saveResults() {
    const outDir = path.join(__dirname, '..', '..', 'docs', 'benchmarks');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `runpod-baked-${ts}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          benchmark: 'runpod-baked-cold-start',
          provider: 'runpod',
          image: this.image,
          cloudType: this.cloudType,
          bootstrapSsh: this.bootstrapSsh,
          startedAt: this.results[0]?.timestamp,
          finishedAt: new Date().toISOString(),
          results: this.results,
        },
        null,
        2
      )
    );
    console.log(`\nResults saved to: ${outPath}`);
  }

  _wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// CLI
const args = minimist(process.argv.slice(2), {
  string: ['image', 'cloud'],
  boolean: ['skip-generation', 'bootstrap-ssh'],
  default: {
    runs: 3,
    image: null,
    cloud: 'COMMUNITY',
    'skip-generation': false,
    'bootstrap-ssh': true,
  },
  alias: { i: 'image', n: 'runs', c: 'cloud' },
});

if (!args.image) {
  console.error('Usage: node scripts/runpod/benchmark-cold-start-baked-runpod.js --image <image:tag> [--runs N] [--cloud COMMUNITY|SECURE] [--skip-generation] [--no-bootstrap-ssh]');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/runpod/benchmark-cold-start-baked-runpod.js --image stationthis/flux-comfyui-runtime:v1 --runs 3');
  process.exit(1);
}

const bench = new RunPodBakedBenchmark({
  image: args.image,
  skipGeneration: args['skip-generation'],
  cloudType: args.cloud,
  bootstrapSsh: args['bootstrap-ssh'],
});

bench.run(Number(args.runs))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Benchmark crashed:', err);
    process.exit(1);
  });
