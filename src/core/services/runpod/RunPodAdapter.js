/**
 * RunPodAdapter - Adapter wrapping GenerationRunner for the AdapterRegistry.
 *
 * Bridges the async ToolAdapter contract (startJob → { runId }, pollJob(runId))
 * onto GenerationRunner.run(), which is a single blocking call that provisions
 * a pod, executes the workflow, collects outputs, and terminates. We kick run()
 * off in the background, hand back a synthetic runId, and let pollJob surface
 * the eventual result to AsyncJobPoller.
 */

const crypto = require('crypto');

class RunPodAdapter {
    constructor(generationRunner) {
        if (!generationRunner) {
            throw new Error('RunPodAdapter requires a GenerationRunner instance');
        }
        this.runner = generationRunner;
        this.jobs = new Map();
    }

    /**
     * Start a RunPod generation. Resolves immediately with a synthetic runId;
     * the actual GenerationRunner.run() promise is tracked internally for pollJob.
     *
     * @param {Object} inputs - Merged inputs from AdapterCoordinator. Expected keys:
     *   - accountId | masterAccountId : caller identity (required)
     *   - jobId : generation/run id (optional; auto-generated if absent)
     *   - workflow : ComfyUI api payload (required) — either { comfyApiPayload, modelManifest, scriptHooks } or a raw graph
     *   - workload : { vramGb, cloudPreference, maxPricePerHr, maxJobCostUsd, expectedSteps } (optional; sourced from tool.metadata + inputs)
     *   - timeouts : { provisionMs, sshMs, jobMs, stallMs } (optional)
     *   - cloudType, vramGb, maxPricePerHr, expectedSteps : convenience overrides folded into workload
     * @returns {Promise<{ runId: string }>}
     */
    async startJob(inputs) {
        const {
            accountId,
            masterAccountId,
            jobId,
            workflow,
            workload,
            timeouts,
            cloudType,
            vramGb,
            maxPricePerHr,
            maxJobCostUsd,
            expectedSteps,
        } = inputs || {};

        const resolvedAccountId = accountId || masterAccountId;
        if (!resolvedAccountId) {
            throw new Error('RunPodAdapter.startJob: accountId (or masterAccountId) is required');
        }
        if (!workflow) {
            throw new Error('RunPodAdapter.startJob: workflow is required');
        }

        const resolvedWorkflow = workflow.comfyApiPayload
            ? workflow
            : { comfyApiPayload: workflow, modelManifest: [] };

        const resolvedWorkload = {
            ...(workload || {}),
            ...(cloudType !== undefined && { cloudPreference: cloudType }),
            ...(vramGb !== undefined && { vramGb }),
            ...(maxPricePerHr !== undefined && { maxPricePerHr }),
            ...(maxJobCostUsd !== undefined && { maxJobCostUsd }),
            ...(expectedSteps !== undefined && { expectedSteps }),
        };

        const resolvedJobId = jobId || `runpod-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const runId = resolvedJobId;

        const runPromise = this.runner.run({
            accountId: resolvedAccountId,
            jobId: resolvedJobId,
            workload: resolvedWorkload,
            workflow: resolvedWorkflow,
            timeouts: timeouts || {},
        });

        const entry = { status: 'processing', result: null };
        this.jobs.set(runId, entry);

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

        return { runId };
    }

    /**
     * Poll a started job. Returns the AsyncJobPoller-shaped envelope:
     *   { status: 'processing'|'succeeded'|'failed', type, data, costUsd? }
     */
    async pollJob(runId) {
        const entry = this.jobs.get(runId);
        if (!entry) {
            throw new Error(`RunPodAdapter.pollJob: unknown runId ${runId}`);
        }

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
        const adapterRegistry = require('../adapterRegistry');
        const { ToolRegistry } = require('../../tools/ToolRegistry');

        const fakeRunner = {
            calls: [],
            run(args) {
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

        adapterRegistry.register('runpod', new RunPodAdapter(fakeRunner));

        const adapter = adapterRegistry.get('runpod');
        if (!adapter || !(adapter instanceof RunPodAdapter)) failures.push('registry did not return RunPodAdapter');

        const toolRegistry = ToolRegistry.getInstance();
        toolRegistry.loadStaticTools();
        const runmake = toolRegistry.getToolById('runmake');
        if (!runmake) failures.push('ToolRegistry.get(runmake) is undefined');
        if (runmake && runmake.service !== 'runpod') failures.push(`runmake.service=${runmake.service}, expected runpod`);
        const dispatched = adapterRegistry.get(runmake?.service);
        if (dispatched !== adapter) failures.push('runmake.service does not resolve to RunPodAdapter');

        const tool = runmake;
        const inputs = {
            accountId: 'acct1',
            jobId: 'job1',
            workload: { vramGb: 24 },
            cloudType: tool?.metadata?.cloudType,
            workflow: {
                comfyApiPayload: { '1': { class_type: 'KSampler', inputs: {} } },
                modelManifest: [],
            },
        };

        const { runId } = await adapter.startJob(inputs);
        if (!runId) failures.push('startJob did not return runId');

        const call = fakeRunner.calls[0];
        if (call.accountId !== 'acct1') failures.push(`run accountId=${call.accountId}`);
        if (call.jobId !== 'job1') failures.push(`run jobId=${call.jobId}`);
        if (call.workload.cloudPreference !== 'SECURE') failures.push(`run workload.cloudPreference=${call.workload.cloudPreference}`);
        if (call.workload.vramGb !== 24) failures.push(`run workload.vramGb=${call.workload.vramGb}`);
        if (!call.workflow.comfyApiPayload) failures.push('run workflow.comfyApiPayload missing');

        await new Promise((r) => setImmediate(r));
        const poll = await adapter.pollJob(runId);
        if (poll.status !== 'succeeded') failures.push(`pollJob status=${poll.status}`);
        if (!Array.isArray(poll.data.outputs) || poll.data.outputs.length !== 1) failures.push('pollJob outputs missing');
        if (poll.costUsd !== 0.0006) failures.push(`pollJob costUsd=${poll.costUsd}`);

        const reject = await adapter.startJob({ accountId: 'a', workflow: { comfyApiPayload: {} } })
            .then((r) => ({ ok: r }))
            .catch((e) => ({ err: e.message }));
        if (!reject.ok) failures.push(`auto-jobId path failed: ${reject.err}`);

        const missing = await adapter.startJob({ workflow: { comfyApiPayload: {} } })
            .then(() => null)
            .catch((e) => e.message);
        if (!missing || !/accountId/.test(missing)) failures.push(`expected accountId guard, got: ${missing}`);

        console.log(`  registry resolves runmake -> ${dispatched ? dispatched.constructor.name : 'NONE'}`);
        console.log(`  startJob runId=${runId}`);
        console.log(`  GenerationRunner.run called with accountId=${call.accountId} jobId=${call.jobId} cloudPreference=${call.workload.cloudPreference} vramGb=${call.workload.vramGb}`);
        console.log(`  pollJob status=${poll.status} outputs=${poll.data.outputs.length} costUsd=${poll.costUsd}`);

        if (failures.length) {
            console.error('FAIL:', failures.join('; '));
            process.exit(1);
        }
        console.log('PASS: RunPodAdapter');
    })().catch((err) => {
        console.error('FAIL: smoke check threw', err);
        process.exit(1);
    });
}
