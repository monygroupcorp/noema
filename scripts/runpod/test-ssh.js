#!/usr/bin/env node
/**
 * test-ssh.js — One-shot RunPod SSH connectivity probe.
 *
 * Provisions a small pod using a RunPod-official PyTorch image (which has
 * sshd pre-installed and honors the PUBLIC_KEY env var), waits for the SSH
 * endpoint to come up, runs a couple of commands, and terminates the pod.
 *
 * Goal: verify that our RunPodPodService + SshTransport stack can reach a
 * RunPod pod end-to-end, before paying for full benchmark runs.
 *
 * Cost: a single ~5-10 min pod on a cheap GPU (RTX A4000 / 3090) is ~$0.03-0.10.
 *
 * Usage:
 *   node scripts/runpod/test-ssh.js
 *   node scripts/runpod/test-ssh.js --image runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04
 *   node scripts/runpod/test-ssh.js --gpu "NVIDIA RTX A4000,NVIDIA GeForce RTX 3090"
 *
 * Whatever happens, the script always tries to terminate the pod in finally{}.
 */
require('dotenv').config();

const minimist = require('minimist');
const { RunPodPodService } = require('../../src/core/services/runpod');
const { getRunPodPodConfig } = require('../../src/config/runpodPod');
const SshTransport = require('../../src/core/services/remote/SshTransport');

const args = minimist(process.argv.slice(2), {
  string: ['image', 'gpu', 'cloud'],
  default: {
    image: 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
    gpu: 'NVIDIA RTX A4000,NVIDIA GeForce RTX 3090,NVIDIA RTX A4500',
    cloud: 'COMMUNITY',
  },
});

const logger = {
  info: (...a) => console.log(`[${new Date().toISOString()}] INFO:`, ...a),
  warn: (...a) => console.log(`[${new Date().toISOString()}] WARN:`, ...a),
  error: (...a) => console.error(`[${new Date().toISOString()}] ERROR:`, ...a),
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = getRunPodPodConfig();
  const svc = new RunPodPodService({ logger, config });

  const gpuTypeIds = args.gpu.split(',').map((s) => s.trim()).filter(Boolean);
  console.log('\n' + '='.repeat(60));
  console.log('RunPod SSH connectivity probe');
  console.log('='.repeat(60));
  console.log(`Image:       ${args.image}`);
  console.log(`GPU types:   ${gpuTypeIds.join(', ')}`);
  console.log(`Cloud:       ${args.cloud.toUpperCase()}`);
  console.log(`SSH key:     ${config.sshKeyPath}`);

  let instance = null;
  let ssh = null;
  const startedAt = Date.now();

  try {
    logger.info('Provisioning pod...');
    instance = await svc.provisionInstance({
      gpuTypeIds,
      image: args.image,
      diskGb: 20, // smallest reasonable for the pytorch image
      label: `ssh-probe-${Date.now()}`,
      cloudType: args.cloud.toUpperCase(),
      ports: ['22/tcp'],
    });
    logger.info(`Pod provisioned: id=${instance.instanceId} desiredStatus=${instance.desiredStatus || 'unknown'}`);

    // Poll until publicIp + portMappings.22 are populated
    const maxWaitMs = 300_000; // 5 min cap
    const pollEvery = 5_000;
    let status = instance;
    while (Date.now() - startedAt < maxWaitMs) {
      status = await svc.getInstanceStatus(instance.instanceId);
      logger.info(`  status=${status.status} ip=${status.publicIp || 'n/a'} sshPort=${status.sshPort || 'n/a'}`);
      if (status.status === 'running' && status.sshHost && status.sshPort) {
        break;
      }
      await wait(pollEvery);
    }
    if (!(status.sshHost && status.sshPort)) {
      throw new Error(`SSH endpoint never appeared. Last status: ${JSON.stringify({
        status: status.status, publicIp: status.publicIp, sshPort: status.sshPort,
      })}`);
    }

    const sshReadyAt = Date.now();
    logger.info(`Endpoint up after ${((sshReadyAt - startedAt) / 1000).toFixed(1)}s. Trying SSH ${status.sshHost}:${status.sshPort}...`);

    // Retry SSH for up to 2 min — sshd inside the container takes a beat
    // after the port is mapped before it actually accepts connections.
    let sshOk = false;
    let lastErr = null;
    const sshDeadline = Date.now() + 120_000;
    while (Date.now() < sshDeadline) {
      try {
        ssh = new SshTransport({
          host: status.sshHost,
          port: status.sshPort,
          username: 'root',
          privateKeyPath: config.sshKeyPath,
          logger,
        });
        const out = await ssh.exec('echo SSH_OK && uname -a && (nvidia-smi -L 2>/dev/null || echo no-nvidia-smi)', {
          timeout: 15000, stdio: 'pipe',
        });
        console.log('\n--- SSH command output ---');
        console.log(out);
        console.log('--------------------------\n');
        sshOk = true;
        break;
      } catch (err) {
        lastErr = err;
        try { if (ssh && ssh.close) await ssh.close(); } catch (_) {}
        ssh = null;
        await wait(8000);
      }
    }

    if (!sshOk) {
      throw new Error(`SSH never connected: ${lastErr?.message}`);
    }

    const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n✓ SUCCESS — pod provisioned, SSH'd in, command ran. Total: ${totalSec}s`);
  } catch (err) {
    console.error(`\n✗ FAILED: ${err.message}`);
    if (err.cause?.response?.data) {
      console.error('Response body:', JSON.stringify(err.cause.response.data).slice(0, 500));
    }
    process.exitCode = 1;
  } finally {
    if (ssh && ssh.close) {
      try { await ssh.close(); } catch (_) {}
    }
    if (instance?.instanceId) {
      logger.info(`Terminating pod ${instance.instanceId}...`);
      try {
        await svc.terminateInstance(instance.instanceId);
        logger.info('Terminated.');
      } catch (err) {
        logger.error(`Termination failed: ${err.message}. Check the dashboard and remove manually.`);
      }
    }
  }
}

main().catch((err) => {
  logger.error('Unhandled:', err);
  process.exit(1);
});
