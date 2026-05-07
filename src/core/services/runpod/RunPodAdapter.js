/**
 * RunPodAdapter - Adapter wrapping GenerationRunner for the AdapterRegistry.
 *
 * Bridges the async ToolAdapter contract (startJob → { runId }, pollJob(runId))
 * onto the fractal-Tool Compiler + GenerationRunner.runDeployment() pipeline:
 *
 *   startJob({ tool, inputs, accountContext, jobId, timeouts })
 *     → compiler.compile({ tool, inputs, accountContext }) → Deployment
 *     → runner.runDeployment({ deployment, accountId, jobId, timeouts })   (background)
 *     → { runId, deploymentHash }
 *
 *   pollJob(runId) → { status, type, data, costUsd? }
 */

const crypto = require('crypto');

class RunPodAdapter {
  constructor({ generationRunner, compiler, logger } = {}) {
    if (!generationRunner) throw new Error('RunPodAdapter requires generationRunner');
    if (!compiler) throw new Error('RunPodAdapter requires compiler');
    this.runner = generationRunner;
    this.compiler = compiler;
    this.logger = logger || console;
    this.jobs = new Map();
  }

  /**
   * Compile tool+inputs into a Deployment, then kick off a background run.
   *
   * @param {Object} opts
   * @param {Object} opts.tool            - fractal Tool definition
   * @param {Object} opts.inputs          - user-supplied inputs (prompt, width, …)
   * @param {Object} opts.accountContext  - { masterAccountId, … }
   * @param {string} [opts.jobId]         - caller-supplied job id; auto-generated if absent
   * @param {Object} [opts.timeouts]      - { provisionMs, sshMs, jobMs, stallMs }
   * @returns {Promise<{ runId: string, deploymentHash: string }>}
   */
  async startJob({ tool, inputs, accountContext, jobId, timeouts } = {}) {
    if (!tool) throw new Error('RunPodAdapter.startJob: tool is required');
    const resolvedAccountId = accountContext?.masterAccountId || accountContext?.accountId;
    if (!resolvedAccountId) throw new Error('RunPodAdapter.startJob: accountContext.masterAccountId is required');

    const deployment = await this.compiler.compile({ tool, inputs: inputs || {}, accountContext });

    const resolvedJobId = jobId || `runpod-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const runId = resolvedJobId;

    const entry = { status: 'processing', result: null };
    this.jobs.set(runId, entry);

    const runPromise = this.runner.runDeployment({
      deployment,
      accountId: resolvedAccountId,
      jobId: resolvedJobId,
      timeouts: timeouts || {},
    });

    runPromise
      .then((result) => {
        entry.status = result.status === 'completed' ? 'succeeded' : 'failed';
        entry.result = result;
      })
      .catch((err) => {
        entry.status = 'failed';
        entry.result = {
          status: 'failed',
          podId: null,
          outputs: [],
          error: { code: err.code || 'RUN_THREW', message: err.message || String(err) },
        };
      });

    this.logger.info(`[RunPodAdapter] startJob runId=${runId} tool=${tool.toolId} hash=${deployment.hash}`);
    return { runId, deploymentHash: deployment.hash };
  }

  /**
   * Poll a started job. Returns the AsyncJobPoller-shaped envelope:
   *   { status: 'processing'|'succeeded'|'failed', type, data, costUsd? }
   */
  async pollJob(runId) {
    const entry = this.jobs.get(runId);
    if (!entry) throw new Error(`RunPodAdapter.pollJob: unknown runId ${runId}`);

    if (entry.status === 'processing') {
      return { status: 'processing', type: 'files', data: null };
    }

    const result = entry.result || {};
    const costUsd = result.cost?.totalUsd ?? undefined;
    const data = {
      outputs: result.outputs || [],
      podId: result.podId || null,
      gpuTypeId: result.gpuTypeId || null,
      cloudType: result.cloudType || null,
      timings: result.timings || null,
      deploymentHash: result.deploymentHash || null,
      ...(result.error && { error: result.error }),
    };

    this.jobs.delete(runId);

    return {
      status: entry.status,
      type: 'files',
      data,
      ...(costUsd !== undefined && { costUsd }),
    };
  }
}

module.exports = RunPodAdapter;

if (require.main === module) {
  (async () => {
    const failures = [];
    const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    const Compiler = require('./Compiler');
    const WorkflowTemplateRegistry = require('./WorkflowTemplateRegistry');
    const adapterRegistry = require('../adapterRegistry');
    const { ToolRegistry } = require('../../tools/ToolRegistry');

    const registry = new WorkflowTemplateRegistry({ logger: silent });

    const fakeRunner = {
      calls: [],
      runDeployment(args) {
        this.calls.push(args);
        return Promise.resolve({
          status: 'completed',
          podId: 'pod-stub-1',
          gpuTypeId: 'NVIDIA GeForce RTX 4090',
          cloudType: 'SECURE',
          timings: { provisionMs: 1, sshMs: 1, jobMs: 1, totalMs: 3 },
          cost: { hourlyUsd: 0.69, totalUsd: 0.0006 },
          outputs: [{
            filename: 'render_001.png',
            key: 'outputs/acct1/job1/render_001.png',
            size: 1024,
            signedUrl: 'https://dryrun.local/render_001.png',
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          }],
        });
      },
    };

    const compiler = new Compiler({ workflowTemplates: registry, logger: silent });
    const adapter = new RunPodAdapter({ generationRunner: fakeRunner, compiler, logger: silent });

    // A. Registry dispatch: runmake.service → RunPodAdapter
    {
      adapterRegistry.register('runpod', adapter);
      const toolRegistry = ToolRegistry.getInstance();
      toolRegistry.loadStaticTools();
      const runmake = toolRegistry.getToolById('runmake');
      if (!runmake) failures.push('A: ToolRegistry.get(runmake) undefined');
      if (runmake && runmake.service !== 'runpod') failures.push(`A: runmake.service=${runmake.service}`);
      const dispatched = adapterRegistry.get(runmake?.service);
      if (dispatched !== adapter) failures.push('A: runmake.service does not resolve to RunPodAdapter');
      console.log(`  A registry: runmake.service=${runmake?.service} → ${dispatched?.constructor.name}`);
    }

    // B. Happy path: compile → runDeployment → pollJob
    {
      const toolRegistry = ToolRegistry.getInstance();
      const tool = toolRegistry.getToolById('runmake');
      const inputs = { prompt: 'a glowing cat', input_seed: 42 };
      const accountContext = { masterAccountId: 'mau-test' };

      const { runId, deploymentHash } = await adapter.startJob({ tool, inputs, accountContext, jobId: 'job-b' });
      if (!runId) failures.push('B: no runId');
      if (!deploymentHash || !deploymentHash.startsWith('sha256:')) failures.push(`B: bad deploymentHash: ${deploymentHash}`);

      const call = fakeRunner.calls[fakeRunner.calls.length - 1];
      if (!call) failures.push('B: runner.runDeployment not called');
      if (call && call.accountId !== 'mau-test') failures.push(`B: accountId=${call.accountId}`);
      if (call && call.jobId !== 'job-b') failures.push(`B: jobId=${call.jobId}`);
      if (call && (!call.deployment || !call.deployment.hash)) failures.push('B: deployment.hash missing');
      if (call && (!call.deployment.spec.workflow.comfyApiPayload)) failures.push('B: comfyApiPayload missing from deployment');

      await new Promise((r) => setImmediate(r));
      const poll = await adapter.pollJob(runId);
      if (poll.status !== 'succeeded') failures.push(`B: poll.status=${poll.status}`);
      if (!Array.isArray(poll.data.outputs) || poll.data.outputs.length !== 1) failures.push('B: outputs missing');
      if (poll.costUsd !== 0.0006) failures.push(`B: costUsd=${poll.costUsd}`);
      console.log(`  B happy: runId=${runId} hash=${deploymentHash?.slice(0, 20)}… poll=${poll.status} costUsd=${poll.costUsd}`);
    }

    // C. Missing tool guard
    {
      const err = await adapter.startJob({ inputs: {}, accountContext: { masterAccountId: 'x' } })
        .then(() => null).catch((e) => e.message);
      if (!err || !/tool/.test(err)) failures.push(`C: expected tool guard, got: ${err}`);
      console.log(`  C tool-guard: "${err}"`);
    }

    // D. Missing accountContext guard
    {
      const toolRegistry = ToolRegistry.getInstance();
      const tool = toolRegistry.getToolById('runmake');
      const err = await adapter.startJob({ tool, inputs: {} })
        .then(() => null).catch((e) => e.message);
      if (!err || !/accountContext/.test(err)) failures.push(`D: expected accountContext guard, got: ${err}`);
      console.log(`  D accountContext-guard: "${err}"`);
    }

    // E. Auto-generated jobId
    {
      const toolRegistry = ToolRegistry.getInstance();
      const tool = toolRegistry.getToolById('runmake');
      const { runId } = await adapter.startJob({
        tool, inputs: { prompt: 'test', input_seed: 1 }, accountContext: { masterAccountId: 'mau-e' },
      });
      if (!runId || !runId.startsWith('runpod-')) failures.push(`E: auto jobId format: ${runId}`);
      await new Promise((r) => setImmediate(r));
      await adapter.pollJob(runId);
      console.log(`  E auto-jobId: ${runId}`);
    }

    if (failures.length) {
      console.error('FAIL:', failures.join('; '));
      process.exit(1);
    }
    console.log('PASS: RunPodAdapter');
  })().catch((err) => {
    console.error('FAIL: smoke check threw', err.stack || err);
    process.exit(1);
  });
}
