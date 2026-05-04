#!/usr/bin/env node
/**
 * benchmark-cold-start-baked.js — Benchmark VastAI cold start with a baked image
 *
 * Same E2E shape as benchmark-cold-start.js but skips the in-job install
 * and download steps because they're all baked into the Docker image.
 *
 * The new dominant cost is image pull time, which is included implicitly in
 * "SSH ready" since VastAI pulls the image as part of starting the container.
 * We compare SSH-ready time on baked vs unbaked to see how much pull cost the
 * larger image adds (or doesn't, on warm hosts).
 *
 * Usage:
 *   node scripts/vastai/benchmark-cold-start-baked.js \
 *     --image stationthis/flux-comfyui-runtime:v1 \
 *     --runs 5
 *
 *   node scripts/vastai/benchmark-cold-start-baked.js \
 *     --image ghcr.io/monygroupcorp/flux-comfyui-runtime:v1 \
 *     --runs 10 \
 *     --skip-generation
 *
 * Output: docs/benchmarks/vastai-baked-{timestamp}.json
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const { VastAIService } = require('../../src/core/services/vastai');
const { getVastAIConfig } = require('../../src/config/vastai');
const SshTransport = require('../../src/core/services/remote/SshTransport');

const COMFYUI_PORT = 8188;
const COMFYUI_PATH = '/workspace/ComfyUI';

class BakedBenchmark {
  constructor({ image, skipGeneration }) {
    if (!image) {
      throw new Error('--image is required');
    }
    this.image = image;
    this.skipGeneration = !!skipGeneration;

    this.logger = {
      info: (...a) => console.log(`[${new Date().toISOString()}] INFO:`, ...a),
      warn: (...a) => console.log(`[${new Date().toISOString()}] WARN:`, ...a),
      error: (...a) => console.error(`[${new Date().toISOString()}] ERROR:`, ...a),
    };

    this.vastaiConfig = getVastAIConfig();
    this.vastaiService = new VastAIService({
      logger: this.logger,
      config: this.vastaiConfig,
    });

    this.results = [];
  }

  async run(numRuns) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`VastAI Baked-Image Cold Start Benchmark — ${numRuns} runs`);
    console.log(`Image: ${this.image}`);
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
      image: this.image,
      instanceId: null,
      gpuType: null,
      sshHost: null,
      hourlyRate: null,
      // Timing (seconds)
      provisionTime: 0,
      sshReadyTime: 0,        // Includes Docker image pull on cold hosts
      comfyuiStartTime: 0,    // Time for ComfyUI to bind the API port
      modelLoadTime: 0,       // First /system_stats includes UNet load on first generation
      generationTime: 0,
      totalTime: 0,
    };

    const totalStart = Date.now();
    let ssh = null;
    let instanceId = null;

    try {
      // 1. Provision
      const provisionStart = Date.now();
      const offers = await this.vastaiService.searchOffers({
        minVramGb: 24,
        maxHourlyUsd: 1.00,
        requireFullGpu: true,
      });

      if (!offers?.length) throw new Error('No offers found');

      const offer = offers[0];
      timing.gpuType = offer.gpuType;
      timing.hourlyRate = offer.hourlyUsd;
      timing.offerId = offer.id;
      timing.datacenter = offer.region || 'unknown';
      timing.reliability = offer.reliability;

      const instance = await this.vastaiService.provisionInstance({
        offerId: offer.id,
        image: this.image,
        diskGb: 60, // Image is ~42GB, give it headroom
        runtimeType: 'ssh',
        label: `baked-bench-${runNumber}-${Date.now()}`,
      });

      instanceId = instance.instanceId;
      timing.instanceId = instanceId;
      timing.provisionTime = (Date.now() - provisionStart) / 1000;

      // 2. Wait for SSH (includes image pull on cold hosts — the new headline metric)
      const sshStart = Date.now();
      ssh = await this._waitForSsh(instanceId);
      timing.sshReadyTime = (Date.now() - sshStart) / 1000;

      const status = await this.vastaiService.getInstanceStatus(instanceId);
      timing.sshHost = status.sshHost || status.publicIp;

      // 3. Verify the baked filesystem looks right (cheap sanity check)
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

      // 4. Start ComfyUI in the background
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

      // 5. Wait for the API to come up
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

      // 6. Submit a minimal Flux Schnell workflow
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
          await this.vastaiService.terminateInstance(instanceId);
          this.logger.info(`Instance ${instanceId} terminated`);
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
    let sshKeyAttached = false;

    while (Date.now() - start < maxWait) {
      const status = await this.vastaiService.getInstanceStatus(instanceId);

      if (status.status === 'running' && (status.sshHost || status.publicIp)) {
        if (!sshKeyAttached) {
          try {
            await this.vastaiService.attachSshKey(instanceId);
          } catch (_) {}
          sshKeyAttached = true;
        }

        const host = status.sshHost || status.publicIp;
        const port = status.sshPort || 22;

        try {
          const ssh = new SshTransport({
            host, port,
            username: 'root',
            privateKeyPath: this.vastaiConfig.sshKeyPath,
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
    // Same workflow shape as benchmark-cold-start.js for direct comparison.
    // 512x512, 4 steps, fp8, no LoRA — generation time should be ~20s on RTX 3090.
    const seed = Math.floor(Math.random() * 1_000_000);
    return {
      "6":  { "class_type": "EmptyLatentImage",   "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
      "8":  { "class_type": "VAEDecode",          "inputs": { "samples": ["13", 0], "vae": ["10", 0] } },
      "9":  { "class_type": "SaveImage",          "inputs": { "filename_prefix": "baked-bench", "images": ["8", 0] } },
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
    console.log(`  GPU:           ${r.gpuType} @ $${r.hourlyRate?.toFixed(3)}/hr (reliability ${r.reliability?.toFixed(3) || '?'})`);
    console.log(`  SSH host:      ${r.sshHost}`);
    console.log(`  Instance:      ${r.instanceId} (${r.datacenter})`);
    console.log(`  Timing:`);
    console.log(`    Provision:        ${r.provisionTime.toFixed(1)}s`);
    console.log(`    SSH ready:        ${r.sshReadyTime.toFixed(1)}s   (incl. image pull on cold hosts)`);
    console.log(`    ComfyUI startup:  ${r.comfyuiStartTime.toFixed(1)}s`);
    console.log(`    Generation:       ${r.generationTime.toFixed(1)}s`);
    console.log(`    TOTAL:            ${r.totalTime.toFixed(1)}s (${(r.totalTime / 60).toFixed(1)} min)`);
  }

  printFinalReport() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('BAKED-IMAGE BENCHMARK SUMMARY');
    console.log('='.repeat(60));

    const successful = this.results.filter((r) => r.success);
    const failed = this.results.filter((r) => !r.success);
    console.log(`\nRuns: ${this.results.length} total, ${successful.length} successful, ${failed.length} failed`);

    if (!successful.length) {
      console.log('No successful runs to analyze.');
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
    console.log(`  Min:    ${sshStats.min.toFixed(1)}s   ← warm-cache hint`);
    console.log(`  Max:    ${sshStats.max.toFixed(1)}s   ← cold-pull hint`);
    console.log(`  Avg:    ${sshStats.avg.toFixed(1)}s`);

    console.log('\n--- ComfyUI startup time ---');
    console.log(`  Min/Avg/Max: ${startStats.min.toFixed(1)}s / ${startStats.avg.toFixed(1)}s / ${startStats.max.toFixed(1)}s`);

    console.log('\n--- Generation time (FLUX schnell, 512x512, 4 steps) ---');
    console.log(`  Min/Avg/Max: ${genStats.min.toFixed(1)}s / ${genStats.avg.toFixed(1)}s / ${genStats.max.toFixed(1)}s`);

    console.log('\n--- Comparison vs unbaked baseline (2026-05-04) ---');
    console.log(`  Unbaked total cold start (success): avg 11.0 min, median 11.5 min`);
    console.log(`  Baked total cold start (success):   avg ${(totalStats.avg / 60).toFixed(1)} min, median ${(totalStats.median / 60).toFixed(1)} min`);
    const delta = ((660 - totalStats.avg) / 660) * 100;
    console.log(`  Δ:  ${delta > 0 ? '↓' : '↑'} ${Math.abs(delta).toFixed(0)}% vs unbaked`);

    console.log('\n--- Conclusion ---');
    if (totalStats.avg <= 240) {
      console.log(`  Cold start ${(totalStats.avg / 60).toFixed(1)} min — viable for user-facing inference with concierge UX.`);
    } else if (totalStats.avg <= 480) {
      console.log(`  Cold start ${(totalStats.avg / 60).toFixed(1)} min — borderline. Add warm pool or parallel provisioning to ship.`);
    } else {
      console.log(`  Cold start ${(totalStats.avg / 60).toFixed(1)} min — image pull cost is dominating. Try smaller image or different registry.`);
    }
  }

  async saveResults() {
    const outDir = path.join(__dirname, '..', '..', 'docs', 'benchmarks');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `vastai-baked-${ts}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          benchmark: 'vastai-baked-cold-start',
          image: this.image,
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
  string: ['image'],
  boolean: ['skip-generation'],
  default: { runs: 5, image: null, 'skip-generation': false },
  alias: { i: 'image', n: 'runs' },
});

if (!args.image) {
  console.error('Usage: node scripts/vastai/benchmark-cold-start-baked.js --image <image:tag> [--runs N] [--skip-generation]');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/vastai/benchmark-cold-start-baked.js --image stationthis/flux-comfyui-runtime:v1 --runs 5');
  process.exit(1);
}

const bench = new BakedBenchmark({
  image: args.image,
  skipGeneration: args['skip-generation'],
});

bench.run(Number(args.runs))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Benchmark crashed:', err);
    process.exit(1);
  });
