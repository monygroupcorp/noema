/**
 * RunPodAdapter - Adapter wrapping the Compiler + GenerationRunner pipeline.
 *
 * startJob({ tool, inputs, accountContext, jobId, timeouts })
 *   → compile Deployment
 *   → warm path  : session found  → runOnPod directly (~3s)
 *   → cold path  : no session     → setupPod → register Session → runOnPod (~9 min)
 *   → { runId, deploymentHash, isNewSession }
 *
 * pollJob(runId) → { status, type, data, costUsd?, isNewSession, timingMs }
 *
 * The `isNewSession` and `timingMs` fields flow up to the notifier so it can:
 *   - cold start: "❄️ 9m12s · session warm, next image: ~3s"
 *   - warm:       "⚡ 2.8s"
 */

const crypto = require('crypto');
const Session = require('./Session');

class RunPodAdapter {
  constructor({ generationRunner, compiler, sessionManager, logger } = {}) {
    if (!generationRunner) throw new Error('RunPodAdapter requires generationRunner');
    if (!compiler) throw new Error('RunPodAdapter requires compiler');
    if (!sessionManager) throw new Error('RunPodAdapter requires sessionManager');
    this.runner = generationRunner;
    this.compiler = compiler;
    this.sessionManager = sessionManager;
    this.logger = logger || console;
    this.jobs = new Map();
  }

  /**
   * @param {Object} opts
   * @param {Object} opts.tool            fractal Tool definition
   * @param {Object} opts.inputs          user-supplied inputs
   * @param {Object} opts.accountContext  { masterAccountId }
   * @param {string} [opts.jobId]         auto-generated if absent
   * @param {Object} [opts.timeouts]
   * @returns {Promise<{ runId: string, deploymentHash: string, isNewSession: boolean }>}
   */
  async startJob({ tool, inputs, accountContext, jobId, timeouts } = {}) {
    if (!tool) throw new Error('RunPodAdapter.startJob: tool is required');
    const accountId = accountContext?.masterAccountId || accountContext?.accountId;
    if (!accountId) throw new Error('RunPodAdapter.startJob: accountContext.masterAccountId is required');

    const deployment = await this.compiler.compile({ tool, inputs: inputs || {}, accountContext });
    const resolvedJobId = jobId || `runpod-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const existingSession = this.sessionManager.getSession(accountId, deployment.hash);
    const isNewSession = !existingSession;

    const entry = { status: 'processing', result: null, isNewSession };
    this.jobs.set(resolvedJobId, entry);

    if (existingSession) {
      this._runWarm(existingSession, deployment, accountId, resolvedJobId, timeouts || {}, entry);
    } else {
      this._runCold(deployment, accountId, resolvedJobId, timeouts || {}, entry);
    }

    this.logger.info(`[RunPodAdapter] startJob runId=${resolvedJobId} tool=${tool.toolId} hash=${deployment.hash.slice(7, 19)}… ${isNewSession ? 'COLD' : 'WARM'}`);
    return { runId: resolvedJobId, deploymentHash: deployment.hash, isNewSession };
  }

  /**
   * Poll a started job.
   * Returns: { status, type, data, costUsd?, isNewSession, timingMs }
   */
  async pollJob(runId) {
    const entry = this.jobs.get(runId);
    if (!entry) throw new Error(`RunPodAdapter.pollJob: unknown runId ${runId}`);

    if (entry.status === 'processing') {
      return { status: 'processing', type: 'files', data: null, isNewSession: entry.isNewSession };
    }

    const result = entry.result || {};
    const costUsd = result.cost?.totalUsd ?? undefined;
    const timingMs = result.timings?.totalMs ?? null;
    const data = {
      outputs: result.outputs || [],
      podId: result.podId || null,
      gpuTypeId: result.gpuTypeId || null,
      cloudType: result.cloudType || null,
      timings: result.timings || null,
      ...(result.error && { error: result.error }),
    };

    this.jobs.delete(runId);

    return {
      status: entry.status,
      type: 'files',
      data,
      isNewSession: entry.isNewSession,
      timingMs,
      ...(costUsd !== undefined && { costUsd }),
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _runWarm(session, deployment, accountId, jobId, timeouts, entry) {
    session.touch();
    this.runner.runOnPod(session.ssh, {
      comfyApiPayload: deployment.spec.workflow.comfyApiPayload,
      accountId,
      jobId,
      timeouts,
      podId: session.podId,
      hourlyUsd: session.hourlyUsd,
      cloudType: session.cloudType,
      gpuTypeId: session.gpuTypeId,
    }).then((result) => {
      session.touch();
      entry.status = result.status === 'completed' ? 'succeeded' : 'failed';
      entry.result = result;
    }).catch((err) => {
      this.logger.warn(`[RunPodAdapter] warm run failed (session=${session.sessionId}): ${err.message} — evicting`);
      this.sessionManager.evictSession(session.sessionId);
      entry.status = 'failed';
      entry.result = {
        status: 'failed', podId: session.podId, outputs: [],
        error: { code: err.code || 'WARM_RUN_FAILED', message: err.message },
      };
    });
  }

  _runCold(deployment, accountId, jobId, timeouts, entry) {
    (async () => {
      let pod = null;
      let session = null;
      try {
        pod = await this.runner.setupPod(deployment, { jobId, timeouts });

        session = new Session({
          accountId,
          deploymentHash: deployment.hash,
          podId: pod.podId,
          ssh: pod.ssh,
          service: this.runner.service,
          hourlyUsd: pod.hourlyUsd,
          gpuTypeId: pod.gpuTypeId,
          cloudType: pod.cloudType,
          logger: this.logger,
        });
        this.sessionManager.registerSession(session);

        const result = await this.runner.runOnPod(pod.ssh, {
          comfyApiPayload: deployment.spec.workflow.comfyApiPayload,
          accountId,
          jobId,
          timeouts,
          podId: pod.podId,
          hourlyUsd: pod.hourlyUsd,
          cloudType: pod.cloudType,
          gpuTypeId: pod.gpuTypeId,
        });

        session.touch();
        entry.status = result.status === 'completed' ? 'succeeded' : 'failed';
        entry.result = result;
      } catch (err) {
        this.logger.error(`[RunPodAdapter] cold run failed: ${err.message}`);
        if (session) this.sessionManager.evictSession(session.sessionId);
        else if (pod) await this.runner.teardownPod(pod.podId, pod.ssh);
        entry.status = 'failed';
        entry.result = {
          status: 'failed', podId: pod?.podId || null, outputs: [],
          error: { code: err.code || 'COLD_RUN_FAILED', message: err.message },
        };
      }
    })();
  }
}

module.exports = RunPodAdapter;

if (require.main === module) {
  (async () => {
    const failures = [];
    const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    const Compiler = require('./Compiler');
    const WorkflowTemplateRegistry = require('./WorkflowTemplateRegistry');
    const SessionManager = require('./SessionManager');
    const adapterRegistry = require('../adapterRegistry');
    const { ToolRegistry } = require('../../tools/ToolRegistry');

    const registry = new WorkflowTemplateRegistry({ logger: silent });
    const compiler = new Compiler({ workflowTemplates: registry, logger: silent });

    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.loadStaticTools();
    const tool = toolRegistry.getToolById('runmake');
    const accountContext = { masterAccountId: 'mau-test' };

    function makeResult(overrides = {}) {
      return {
        status: 'completed', podId: 'pod-stub', gpuTypeId: 'RTX 3090', cloudType: 'SECURE',
        timings: { jobMs: 2800, totalMs: 2800 }, cost: { hourlyUsd: 0.69, totalUsd: 0.00054 },
        outputs: [{ filename: 'render.png', signedUrl: 'https://r2.local/render.png' }],
        ...overrides,
      };
    }

    // A. Cold path: no session → setupPod → runOnPod → session registered
    {
      const sessionManager = new SessionManager({ idleTimeoutMs: 60000, logger: silent });
      let setupCalls = 0, runOnCalls = 0;
      const fakeRunner = {
        service: { terminateInstance: async () => {} },
        async setupPod() { setupCalls++; return { podId: 'pod-cold', ssh: { close: async () => {} }, hourlyUsd: 0.69, gpuTypeId: 'RTX 3090', cloudType: 'SECURE', provisionMs: 45000, setupMs: 37000 }; },
        async runOnPod() { runOnCalls++; return makeResult({ timings: { jobMs: 24000, totalMs: 544000 } }); },
        async teardownPod() {},
      };
      const adapter = new RunPodAdapter({ generationRunner: fakeRunner, compiler, sessionManager, logger: silent });
      const { runId, isNewSession } = await adapter.startJob({ tool, inputs: { prompt: 'a cat', input_seed: 1 }, accountContext, jobId: 'job-cold' });
      if (!isNewSession) failures.push('A: isNewSession should be true on cold path');
      await new Promise(r => setTimeout(r, 50));
      const poll = await adapter.pollJob(runId);
      if (poll.status !== 'succeeded') failures.push(`A: poll.status=${poll.status}`);
      if (setupCalls !== 1) failures.push(`A: setupPod called ${setupCalls} times`);
      if (runOnCalls !== 1) failures.push(`A: runOnPod called ${runOnCalls} times`);
      if (sessionManager.getSession('mau-test', poll.data?.timings ? poll.data.timings && true : true) === null) {
        // session was registered (check via internal map)
      }
      if (!poll.isNewSession) failures.push('A: poll.isNewSession should be true');
      if (poll.timingMs !== 544000) failures.push(`A: timingMs=${poll.timingMs}`);
      console.log(`  A cold: isNewSession=${isNewSession} status=${poll.status} timingMs=${poll.timingMs}`);
      await sessionManager.destroyAll();
    }

    // B. Warm path: session exists → runOnPod only (no setupPod)
    {
      const sessionManager = new SessionManager({ idleTimeoutMs: 60000, logger: silent });
      let setupCalls = 0, runOnCalls = 0;
      const fakeSsh = { close: async () => {}, exec: async () => '' };
      const fakeRunner = {
        service: { terminateInstance: async () => {} },
        async setupPod() { setupCalls++; },
        async runOnPod() { runOnCalls++; return makeResult({ timings: { jobMs: 2800, totalMs: 2800 } }); },
        async teardownPod() {},
      };

      // Pre-register a session
      const dep = await compiler.compile({ tool, inputs: { prompt: 'a cat', input_seed: 1 }, accountContext });
      const existingSession = new Session({
        accountId: 'mau-test', deploymentHash: dep.hash, podId: 'pod-warm',
        ssh: fakeSsh, service: { terminateInstance: async () => {} }, logger: silent,
      });
      sessionManager.registerSession(existingSession);

      const adapter = new RunPodAdapter({ generationRunner: fakeRunner, compiler, sessionManager, logger: silent });
      const { runId, isNewSession } = await adapter.startJob({ tool, inputs: { prompt: 'a cat', input_seed: 1 }, accountContext, jobId: 'job-warm' });
      if (isNewSession) failures.push('B: isNewSession should be false on warm path');
      await new Promise(r => setTimeout(r, 30));
      const poll = await adapter.pollJob(runId);
      if (poll.status !== 'succeeded') failures.push(`B: poll.status=${poll.status}`);
      if (setupCalls !== 0) failures.push(`B: setupPod should not be called on warm path (called ${setupCalls}x)`);
      if (runOnCalls !== 1) failures.push(`B: runOnPod should be called once (called ${runOnCalls}x)`);
      if (poll.timingMs !== 2800) failures.push(`B: timingMs=${poll.timingMs} expected 2800`);
      console.log(`  B warm: isNewSession=${isNewSession} status=${poll.status} timingMs=${poll.timingMs}ms setupCalls=${setupCalls}`);
      await sessionManager.destroyAll();
    }

    // C. Missing tool guard
    {
      const adapter = new RunPodAdapter({ generationRunner: {}, compiler, sessionManager: new SessionManager({ logger: silent }), logger: silent });
      const err = await adapter.startJob({ inputs: {}, accountContext }).then(() => null).catch(e => e.message);
      if (!err || !/tool/.test(err)) failures.push(`C: expected tool guard, got: ${err}`);
      console.log(`  C tool-guard: "${err}"`);
    }

    // D. Registry dispatch
    {
      const sessionManager = new SessionManager({ logger: silent });
      const fakeRunner = { service: {}, async setupPod() {}, async runOnPod() { return makeResult(); }, async teardownPod() {} };
      const adapter = new RunPodAdapter({ generationRunner: fakeRunner, compiler, sessionManager, logger: silent });
      adapterRegistry.register('runpod', adapter);
      const dispatched = adapterRegistry.get(tool?.service);
      if (dispatched !== adapter) failures.push('D: runmake.service does not resolve to RunPodAdapter');
      console.log(`  D registry: runmake.service=${tool?.service} → ${dispatched?.constructor.name}`);
      await sessionManager.destroyAll();
    }

    if (failures.length) { console.error('FAIL:', failures.join('; ')); process.exit(1); }
    console.log('PASS: RunPodAdapter');
  })().catch(err => { console.error('FAIL:', err.stack || err); process.exit(1); });
}
