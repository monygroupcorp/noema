#!/usr/bin/env node
/**
 * integration-runmake-fractal.js
 *
 * End-to-end live integration test for the fractal-Tool pipeline:
 *
 *   ToolRegistry.get('runmake')
 *     → Compiler.compile({ tool, inputs, accountContext })
 *     → GenerationRunner.runDeployment({ deployment, accountId, jobId })
 *     → signed imageUrl in outputs
 *
 * Uses a real RunPod SECURE pod. Requires env vars:
 *   RUNPOD_API_KEY, SSH_KEY_PATH, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *   R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 *
 * Usage:
 *   node scripts/runpod/integration-runmake-fractal.js [--prompt "a glowing cat"] [--seed 42]
 *
 * Exit codes: 0 = success, 1 = failure.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { ToolRegistry } = require('../../src/core/tools/ToolRegistry');
const { Compiler, WorkflowTemplateRegistry, GenerationRunner } = require('../../src/core/services/runpod');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}
const prompt = argVal('--prompt') || 'a neon cat in a space station, cinematic';
const seed = argVal('--seed') ? Number(argVal('--seed')) : 42;
const accountId = argVal('--accountId') || 'integration-test';
const jobId = `fractal-integ-${Date.now()}`;

// ---------------------------------------------------------------------------
// Wire up the pipeline
// ---------------------------------------------------------------------------
const logger = {
  info:  (...a) => console.log('[INFO]', ...a),
  warn:  (...a) => console.warn('[WARN]', ...a),
  error: (...a) => console.error('[ERR]', ...a),
  debug: (...a) => {},
};

const toolRegistry = ToolRegistry.getInstance();
toolRegistry.loadStaticTools();

const tool = toolRegistry.getToolById('runmake');
if (!tool) {
  console.error('FAIL: runmake tool not found in ToolRegistry');
  process.exit(1);
}
console.log(`Tool: ${tool.toolId} v${tool.version} (${tool.service})`);

const workflowTemplates = new WorkflowTemplateRegistry({ logger });
const compiler = new Compiler({ workflowTemplates, logger });
const runner = new GenerationRunner({ logger });

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------
console.log(`\nCompiling: prompt="${prompt}" seed=${seed}`);
let deployment;
(async () => {
  try {
    deployment = await compiler.compile({
      tool,
      inputs: { prompt, input_seed: seed },
      accountContext: { masterAccountId: accountId },
    });
  } catch (err) {
    console.error('FAIL: Compiler.compile threw:', err.message);
    process.exit(1);
  }

  console.log(`Deployment hash: ${deployment.hash}`);
  console.log(`Models (${deployment.spec.models.length}): ${deployment.spec.models.map(m => m.id).join(', ')}`);

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------
  console.log(`\nStarting pod... (jobId=${jobId})`);
  const start = Date.now();
  let result;
  try {
    result = await runner.runDeployment({
      deployment,
      accountId,
      jobId,
      timeouts: {
        provisionMs: 6 * 60 * 1000,
        sshMs: 12 * 60 * 1000,
        jobMs: 20 * 60 * 1000,
        stallMs: 120 * 1000,
      },
    });
  } catch (err) {
    console.error('FAIL: runner.runDeployment threw:', err.stack || err);
    process.exit(1);
  }

  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n--- Result ---`);
  console.log(`Status:   ${result.status}`);
  console.log(`Pod:      ${result.podId}`);
  console.log(`GPU:      ${result.gpuTypeId}`);
  console.log(`Cloud:    ${result.cloudType}`);
  console.log(`Elapsed:  ${elapsedSec}s`);
  if (result.timings) {
    console.log(`Timings:  provision=${result.timings.provisionMs}ms ssh=${result.timings.sshMs}ms job=${result.timings.jobMs}ms total=${result.timings.totalMs}ms`);
  }
  if (result.cost?.totalUsd != null) {
    console.log(`Cost:     $${result.cost.totalUsd.toFixed(5)} @ $${result.cost.hourlyUsd}/hr`);
  }
  if (result.outputs?.length) {
    console.log(`Outputs (${result.outputs.length}):`);
    for (const o of result.outputs) {
      console.log(`  ${o.filename}  →  ${o.signedUrl}`);
    }
  }
  if (result.error) {
    console.log(`Error:    [${result.error.code}] ${result.error.message}`);
  }

  // ---------------------------------------------------------------------------
  // Pass/Fail
  // ---------------------------------------------------------------------------
  if (result.status !== 'completed') {
    console.error(`\nFAIL: expected status=completed, got ${result.status}`);
    process.exit(1);
  }
  if (!result.outputs || result.outputs.length === 0) {
    console.error('\nFAIL: no outputs returned');
    process.exit(1);
  }

  console.log('\nPASS: integration-runmake-fractal');
})();
