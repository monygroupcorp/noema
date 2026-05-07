/**
 * GenerationRunner — orchestrates the full RunPod cold-start generation loop.
 *
 * Wires together GPUScheduler + RunPodPodService + StallDetector + OutputUploader
 * into a single provision -> SSH -> setup -> run -> collect -> terminate flow.
 * The reference sequence is scripts/runpod/benchmark-cold-start-runpod.js — this
 * class lifts that benchmark into a reusable library function.
 *
 * Always-terminate semantics: the pod is torn down on every exit path
 * (success, failure, stall, exception) via a try/finally. Mirrors the
 * benchmark's per-run finally block, plus a SIGINT/SIGTERM safety net is the
 * caller's responsibility.
 *
 * SSH bridging: RunPodPodService surfaces a plain endpoint descriptor
 * (sshHost/sshPort/sshUser). We construct a single SshTransport from
 * config.sshKeyPath and reuse it for setup, workload exec, and the
 * OutputUploader.uploadFromPod download phase (which duck-types
 * sshConnection.download(remotePath, localPath, opts)).
 */

const SshTransport = require('../remote/SshTransport');
const { getRunPodPodConfig } = require('../../../config/runpodPod');
const RunPodPodService = require('./RunPodPodService');
const GPUScheduler = require('./GPUScheduler');
const StallDetector = require('./StallDetector');
const OutputUploader = require('./OutputUploader');

const DEFAULT_TIMEOUTS = {
  provisionMs: 5 * 60 * 1000,
  sshMs: 10 * 60 * 1000,
  jobMs: 15 * 60 * 1000,
  stallMs: 120 * 1000,
};

const DEFAULT_IMAGE = 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04';
const COMFYUI_PORT = 8188;

class GenerationRunner {
  constructor({
    logger,
    config,
    service,
    scheduler,
    uploader,
    stallDetectorFactory,
    sshTransportFactory,
    image,
  } = {}) {
    this.logger = logger || console;
    this.config = config || (service ? service.config : getRunPodPodConfig());
    this.service = service || new RunPodPodService({ logger: this.logger, config: this.config });
    this.scheduler = scheduler || new GPUScheduler();
    this.uploader = uploader || new OutputUploader({ logger: this.logger });
    this.stallDetectorFactory = stallDetectorFactory || ((opts) => new StallDetector(opts));
    this.sshTransportFactory = sshTransportFactory || ((opts) => new SshTransport(opts));
    this.image = image || DEFAULT_IMAGE;
  }

  async run({
    accountId,
    jobId,
    workload = {},
    workflow = {},
    timeouts = {},
  } = {}) {
    if (!accountId) throw new Error('GenerationRunner.run requires accountId');
    if (!jobId) throw new Error('GenerationRunner.run requires jobId');
    if (!workflow.comfyApiPayload) throw new Error('GenerationRunner.run requires workflow.comfyApiPayload');

    const t = { ...DEFAULT_TIMEOUTS, ...timeouts };
    const totalStart = Date.now();
    const timings = { provisionMs: 0, sshMs: 0, jobMs: 0, totalMs: 0 };

    const gpuTypeIds = this.scheduler.planGpuTypeIds(workload);
    if (!gpuTypeIds.length) {
      return this._fail({
        code: 'NO_GPU_PLAN',
        message: `No GPU types match workload (vramGb=${workload.vramGb}, maxPricePerHr=${workload.maxPricePerHr})`,
        timings: { ...timings, totalMs: Date.now() - totalStart },
      });
    }
    const cloudType = (workload.cloudPreference || 'SECURE').toUpperCase();

    let instance = null;
    let podId = null;
    let ssh = null;
    let stallDetector = null;
    let stalled = false;
    let stallReason = null;

    try {
      const provisionStart = Date.now();
      const sshProbe = async (inst) => {
        const transport = this.sshTransportFactory({
          host: inst.sshHost,
          port: inst.sshPort,
          username: inst.sshUser,
          privateKeyPath: this.config.sshKeyPath,
          logger: this.logger,
        });
        await transport.exec('echo OK', { timeout: 15000, stdio: 'pipe' });
        return transport;
      };

      const probeWithReadiness = async (inst) => {
        const deadline = Date.now() + t.sshMs;
        let lastErr = null;
        while (Date.now() < deadline) {
          const status = await this.service.getInstanceStatus(inst.instanceId);
          if (status.status === 'running' && status.sshHost && status.sshPort && status.sshUser) {
            try {
              return await sshProbe(status);
            } catch (err) {
              lastErr = err;
            }
          }
          await wait(8000);
        }
        throw lastErr || new Error(`SSH did not become ready within ${t.sshMs}ms`);
      };

      const { instance: provisioned } = await this.service.provisionInstanceWithRetry(
        {
          gpuTypeIds,
          cloudType,
          image: this.image,
          jobId,
          ports: ['22/tcp', `${COMFYUI_PORT}/http`],
          maxJobCostUsd: workload.maxJobCostUsd,
        },
        {
          maxAttempts: gpuTypeIds.length,
          perAttemptDeadlineMs: t.sshMs,
          sshProbe: async (inst) => {
            ssh = await probeWithReadiness(inst);
            return ssh;
          },
        }
      );

      instance = provisioned;
      podId = instance.instanceId;
      timings.provisionMs = Date.now() - provisionStart;

      const sshStart = Date.now();
      // ssh is set by sshProbe above; nothing else to do here.
      timings.sshMs = Date.now() - sshStart;

      const status = await this.service.getInstanceStatus(podId);
      const hourlyUsd = status.hourlyUsd ?? null;

      const jobStart = Date.now();

      await this._runSetup(ssh, workflow);
      await this._startComfyUi(ssh);
      await this._waitForComfyApi(ssh, t.jobMs);
      await this._downloadModels(ssh, workflow.modelManifest || []);
      if (workflow.scriptHooks?.afterModels) {
        await workflow.scriptHooks.afterModels(ssh);
      }

      stallDetector = this.stallDetectorFactory({
        podId,
        sshConnection: ssh,
        comfyUiHost: '127.0.0.1',
        comfyUiPort: COMFYUI_PORT,
        expectedSteps: workload.expectedSteps,
        stallTimeoutMs: t.stallMs,
        httpFetch: makeSshHttpFetch(ssh, COMFYUI_PORT),
      });

      stallDetector.on('stalled', ({ reason }) => {
        stalled = true;
        stallReason = reason;
        this.logger.warn(`[GenerationRunner] Pod ${podId} stalled: ${reason}`);
      });
      stallDetector.start();

      const promptId = await this._submitWorkflow(ssh, workflow.comfyApiPayload);

      const completion = await this._awaitCompletion(ssh, promptId, {
        jobMs: t.jobMs,
        isStalled: () => stalled,
      });

      timings.jobMs = Date.now() - jobStart;
      stallDetector.stop();

      if (stalled) {
        timings.totalMs = Date.now() - totalStart;
        return {
          status: 'stalled',
          podId,
          gpuTypeId: instance.gpuType || gpuTypeIds[0],
          cloudType,
          timings,
          cost: buildCost(hourlyUsd, timings.totalMs),
          outputs: [],
          error: { code: 'STALLED', message: stallReason || 'StallDetector tripped' },
        };
      }

      const remotePaths = completion.remotePaths;
      const outputs = remotePaths.length
        ? await this.uploader.uploadFromPod({
            sshConnection: ssh,
            accountId,
            jobId,
            remotePaths,
          })
        : [];

      timings.totalMs = Date.now() - totalStart;
      return {
        status: 'completed',
        podId,
        gpuTypeId: instance.gpuType || gpuTypeIds[0],
        cloudType,
        timings,
        cost: buildCost(hourlyUsd, timings.totalMs),
        outputs,
      };
    } catch (err) {
      timings.totalMs = Date.now() - totalStart;
      if (stallDetector) {
        try { stallDetector.stop(); } catch (_) {}
      }
      return {
        status: stalled ? 'stalled' : 'failed',
        podId,
        gpuTypeId: instance?.gpuType || gpuTypeIds[0] || null,
        cloudType,
        timings,
        cost: buildCost(instance?.hourlyUsd ?? null, timings.totalMs),
        outputs: [],
        error: {
          code: err.code || (stalled ? 'STALLED' : 'RUN_FAILED'),
          message: err.message || String(err),
        },
      };
    } finally {
      if (podId) {
        try {
          await this.service.terminateInstance(podId);
          this.logger.info(`[GenerationRunner] Pod ${podId} terminated`);
        } catch (termErr) {
          this.logger.error(`[GenerationRunner] Failed to terminate ${podId}: ${termErr.message}`);
        }
      }
      if (ssh && typeof ssh.close === 'function') {
        try { await ssh.close(); } catch (_) {}
      }
    }
  }

  async runDeployment({ deployment, accountId, jobId, timeouts = {} } = {}) {
    if (!deployment || !deployment.spec) throw new Error('runDeployment requires deployment.spec');
    if (!accountId) throw new Error('runDeployment requires accountId');
    if (!jobId) throw new Error('runDeployment requires jobId');

    const { spec } = deployment;

    const runner = new GenerationRunner({
      logger: this.logger,
      config: this.config,
      service: this.service,
      scheduler: this.scheduler,
      uploader: this.uploader,
      stallDetectorFactory: this.stallDetectorFactory,
      sshTransportFactory: this.sshTransportFactory,
      image: spec.image.ociRef,
    });

    return runner.run({
      accountId,
      jobId,
      workload: {
        vramGb: spec.cookFlags.vramGb ?? 24,
        cloudPreference: spec.cookFlags.cloudPreference ?? 'SECURE',
        maxPricePerHr: spec.cookFlags.maxPricePerHr ?? 1.0,
        expectedSteps: spec.cookFlags.expectedSteps ?? 4,
        maxJobCostUsd: spec.cookFlags.maxJobCostUsd,
      },
      workflow: {
        comfyApiPayload: spec.workflow.comfyApiPayload,
        modelManifest: spec.models,
      },
      timeouts,
    });
  }

  async _runSetup(ssh, workflow) {
    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120000 });
    await ssh.exec('cd /root && rm -rf ComfyUI && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git', { timeout: 120000 });
    await ssh.exec('cd /root/ComfyUI && pip install -r requirements.txt -q', { timeout: 300000 });
    await ssh.exec('mkdir -p /root/ComfyUI/models/unet /root/ComfyUI/models/vae /root/ComfyUI/models/clip /root/ComfyUI/models/loras /root/ComfyUI/output');
    if (workflow.scriptHooks?.afterSetup) {
      await workflow.scriptHooks.afterSetup(ssh);
    }
  }

  async _startComfyUi(ssh) {
    const scriptLines = [
      '#!/bin/bash',
      'cd /root/ComfyUI',
      `python main.py --listen 0.0.0.0 --port ${COMFYUI_PORT} >> /tmp/comfyui.log 2>&1 &`,
      'echo $! > /tmp/comfyui.pid',
    ];
    await ssh.exec(`echo '${scriptLines.join('\n')}' > /tmp/start_comfy.sh && chmod +x /tmp/start_comfy.sh`);
    await ssh.exec('setsid /tmp/start_comfy.sh </dev/null >/dev/null 2>&1 &', { timeout: 5000 }).catch(() => {});
  }

  async _waitForComfyApi(ssh, jobMs) {
    const deadline = Date.now() + Math.min(jobMs, 5 * 60 * 1000);
    while (Date.now() < deadline) {
      try {
        const out = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/system_stats`, { stdio: 'pipe', timeout: 5000 });
        if (out && out.includes('system')) return;
      } catch (_) {}
      await wait(2000);
    }
    throw new Error('ComfyUI API never came up');
  }

  async _downloadModels(ssh, manifest) {
    if (!Array.isArray(manifest) || manifest.length === 0) return;
    await Promise.all(manifest.map(async (entry) => {
      const dest = `/root/ComfyUI/models/${entry.dest}`;
      await ssh.exec(`mkdir -p $(dirname ${dest}) && wget -q "${entry.url}" -O ${dest}`, { timeout: 900000 });
    }));
  }

  async _submitWorkflow(ssh, comfyApiPayload) {
    const payload = JSON.stringify({ prompt: comfyApiPayload }).replace(/'/g, "'\\''");
    const out = await ssh.exec(
      `curl -sf -X POST http://localhost:${COMFYUI_PORT}/prompt -H "Content-Type: application/json" -d '${payload}'`,
      { stdio: 'pipe', timeout: 15000 }
    );
    try {
      const parsed = JSON.parse(out || '{}');
      return parsed.prompt_id || null;
    } catch (_) {
      return null;
    }
  }

  async _awaitCompletion(ssh, promptId, { jobMs, isStalled }) {
    const deadline = Date.now() + jobMs;
    while (Date.now() < deadline) {
      if (isStalled()) return { remotePaths: [] };
      try {
        const out = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/history`, { stdio: 'pipe', timeout: 5000 });
        const parsed = JSON.parse(out || '{}');
        const entry = promptId ? parsed[promptId] : Object.values(parsed)[0];
        if (entry && entry.outputs) {
          const remotePaths = collectOutputPaths(entry.outputs);
          if (remotePaths.length) return { remotePaths };
        }
      } catch (_) {}
      await wait(2000);
    }
    throw new Error('Workflow did not complete within jobMs');
  }

  _fail({ code, message, timings }) {
    return {
      status: 'failed',
      podId: null,
      gpuTypeId: null,
      cloudType: null,
      timings,
      cost: { hourlyUsd: null, totalUsd: null },
      outputs: [],
      error: { code, message },
    };
  }
}

function collectOutputPaths(outputs) {
  const paths = [];
  for (const node of Object.values(outputs || {})) {
    for (const kind of ['images', 'gifs', 'videos', 'audio']) {
      if (Array.isArray(node[kind])) {
        for (const item of node[kind]) {
          const subdir = item.subfolder ? `${item.subfolder}/` : '';
          paths.push(`/root/ComfyUI/output/${subdir}${item.filename}`);
        }
      }
    }
  }
  return paths;
}

function buildCost(hourlyUsd, totalMs) {
  if (!hourlyUsd || !Number.isFinite(hourlyUsd)) {
    return { hourlyUsd: hourlyUsd || null, totalUsd: null };
  }
  const totalUsd = (hourlyUsd / 3600) * (totalMs / 1000);
  return { hourlyUsd, totalUsd: Number(totalUsd.toFixed(6)) };
}

function makeSshHttpFetch(ssh, port) {
  return async (path) => {
    try {
      const out = await ssh.exec(`curl -sf http://localhost:${port}${path}`, { stdio: 'pipe', timeout: 5000 });
      return { ok: true, status: 200, body: JSON.parse(out || '{}'), json: async () => JSON.parse(out || '{}') };
    } catch (err) {
      return { ok: false, status: err.code || 0 };
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = GenerationRunner;

if (require.main === module) {
  // ---------------------------------------------------------------------------
  // Smoke check — exercises the orchestration with stubs. No network/SSH.
  // ---------------------------------------------------------------------------
  const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

  function makeFakeSsh({ history } = {}) {
    return {
      exec: async (cmd) => {
        if (cmd.includes('/system_stats')) return '{"system":{}}';
        if (cmd.includes('/prompt')) return JSON.stringify({ prompt_id: 'P1' });
        if (cmd.includes('/history')) return JSON.stringify(history || {});
        if (cmd.includes('/queue')) return '{"queue_running":[],"queue_pending":[]}';
        return '';
      },
      download: async () => {},
      close: async () => {},
      on: () => {},
      off: () => {},
    };
  }

  function makeFakeService({ failProvision = false, instance } = {}) {
    const inst = instance || {
      instanceId: 'pod-fake-1',
      sshHost: '1.2.3.4',
      sshPort: 22,
      sshUser: 'root',
      gpuType: 'NVIDIA GeForce RTX 4090',
      hourlyUsd: 0.69,
      status: 'running',
    };
    return {
      config: { sshKeyPath: '/dev/null' },
      terminated: [],
      provisionInstanceWithRetry: async (_ctx, opts) => {
        if (failProvision) throw new Error('all GPU types out of capacity');
        const ssh = await opts.sshProbe(inst);
        return { instance: inst, probeResult: ssh, attempts: 1 };
      },
      getInstanceStatus: async () => inst,
      terminateInstance: async function (id) { this.terminated.push(id); },
    };
  }

  const fakeUploader = {
    uploadFromPod: async ({ remotePaths, jobId, accountId }) => remotePaths.map((p) => ({
      filename: p.split('/').pop(),
      key: `outputs/${accountId}/${jobId}/${p.split('/').pop()}`,
      size: 1024,
      signedUrl: `https://dryrun.local/${p.split('/').pop()}`,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    })),
  };

  function makeFakeStallDetectorFactory({ shouldStall = false } = {}) {
    return (opts) => {
      const handlers = {};
      return {
        start() {
          if (shouldStall) {
            setTimeout(() => handlers.stalled && handlers.stalled({ reason: 'fake-stall', status: {} }), 30);
          }
        },
        stop() {},
        on(evt, fn) { handlers[evt] = fn; },
        getStatus() { return { stalled: shouldStall, reason: shouldStall ? 'fake-stall' : null }; },
      };
    };
  }

  function fakeSshFactory(ssh) {
    return () => ssh;
  }

  const baseWorkload = { vramGb: 24, cloudPreference: 'SECURE', maxPricePerHr: 1.0 };
  const baseWorkflow = {
    comfyApiPayload: { '1': { class_type: 'KSampler', inputs: {} } },
    modelManifest: [],
  };

  (async () => {
    const failures = [];

    // Scenario A: happy path — completes, terminates pod.
    {
      const ssh = makeFakeSsh({
        history: { P1: { outputs: { '9': { images: [{ filename: 'render_001.png', subfolder: '', type: 'output' }] } } } },
      });
      const service = makeFakeService();
      const runner = new GenerationRunner({
        logger: silent,
        config: { sshKeyPath: '/dev/null' },
        service,
        uploader: fakeUploader,
        stallDetectorFactory: makeFakeStallDetectorFactory(),
        sshTransportFactory: fakeSshFactory(ssh),
      });
      const result = await runner.run({
        accountId: 'acct1',
        jobId: 'job1',
        workload: baseWorkload,
        workflow: baseWorkflow,
        timeouts: { jobMs: 5000, stallMs: 5000, sshMs: 5000 },
      });
      if (result.status !== 'completed') failures.push(`A: expected completed, got ${result.status} (${result.error?.message})`);
      if (result.outputs.length !== 1) failures.push(`A: expected 1 output, got ${result.outputs.length}`);
      if (!service.terminated.includes('pod-fake-1')) failures.push('A: pod not terminated');
      console.log(`  happy-path: status=${result.status} outputs=${result.outputs.length} terminated=${service.terminated.length}`);
    }

    // Scenario B: stall path — StallDetector trips, pod still terminates.
    {
      const ssh = makeFakeSsh({ history: {} });
      const service = makeFakeService();
      const runner = new GenerationRunner({
        logger: silent,
        config: { sshKeyPath: '/dev/null' },
        service,
        uploader: fakeUploader,
        stallDetectorFactory: makeFakeStallDetectorFactory({ shouldStall: true }),
        sshTransportFactory: fakeSshFactory(ssh),
      });
      const result = await runner.run({
        accountId: 'acct1',
        jobId: 'job2',
        workload: baseWorkload,
        workflow: baseWorkflow,
        timeouts: { jobMs: 10000, stallMs: 100, sshMs: 2000 },
      });
      if (result.status !== 'stalled') failures.push(`B: expected stalled, got ${result.status}`);
      if (!service.terminated.includes('pod-fake-1')) failures.push('B: pod not terminated on stall');
      console.log(`  stall-path: status=${result.status} reason=${result.error?.message} terminated=${service.terminated.length}`);
    }

    // Scenario C: provision failure — no pod to terminate, returns failed.
    {
      const service = makeFakeService({ failProvision: true });
      const runner = new GenerationRunner({
        logger: silent,
        config: { sshKeyPath: '/dev/null' },
        service,
        uploader: fakeUploader,
        stallDetectorFactory: makeFakeStallDetectorFactory(),
        sshTransportFactory: fakeSshFactory(makeFakeSsh()),
      });
      const result = await runner.run({
        accountId: 'acct1',
        jobId: 'job3',
        workload: baseWorkload,
        workflow: baseWorkflow,
        timeouts: { jobMs: 1000, stallMs: 500, sshMs: 1000 },
      });
      if (result.status !== 'failed') failures.push(`C: expected failed, got ${result.status}`);
      if (!result.error || !/capacity/i.test(result.error.message)) failures.push(`C: missing capacity error`);
      if (service.terminated.length !== 0) failures.push('C: should not terminate (no pod was provisioned)');
      console.log(`  provision-fails: status=${result.status} error="${result.error?.message}" terminated=${service.terminated.length}`);
    }

    if (failures.length) {
      console.error('FAIL:', failures.join('; '));
      process.exit(1);
    }
    console.log('PASS: GenerationRunner');
  })().catch((err) => {
    console.error('FAIL: smoke check threw', err);
    process.exit(1);
  });
}
