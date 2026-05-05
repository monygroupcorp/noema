#!/usr/bin/env node
/**
 * smoke-proxy-ssh.js — fastest possible end-to-end check that the
 * ssh.runpod.io proxy path actually works for our setup.
 *
 *   1. Provision a small SECURE pod (RTX A4000-class, 20GB disk)
 *   2. Wait until desiredStatus=RUNNING
 *   3. SSH in via ssh.runpod.io with podId as user
 *   4. Run `nvidia-smi -L`
 *   5. Tear down
 *
 * Total cost target: ~$0.01. Cap: 5 min. Run before committing to a
 * full benchmark. Same SIGINT/SIGTERM cleanup as the benchmark.
 */
require('dotenv').config();

const { spawnSync } = require('child_process');
const { RunPodPodService } = require('../../src/core/services/runpod');
const { getRunPodPodConfig } = require('../../src/config/runpodPod');
const SshTransport = require('../../src/core/services/remote/SshTransport');

const IMAGE = 'runpod/pytorch:2.1.0-py3.10-cuda12.1.1-devel-ubuntu22.04';

const logger = {
  info: (...a) => console.log(`[${new Date().toISOString()}]`, ...a),
  warn: (...a) => console.log(`[${new Date().toISOString()}] WARN:`, ...a),
  error: (...a) => console.error(`[${new Date().toISOString()}] ERROR:`, ...a),
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = getRunPodPodConfig();
  const service = new RunPodPodService({ logger, config });

  let activePodId = null;
  const shutdown = (sig) => {
    if (!activePodId) process.exit(130);
    const id = activePodId;
    activePodId = null;
    console.error(`\n[${sig}] terminating ${id} before exit...`);
    service.terminateInstance(id)
      .then(() => process.exit(130))
      .catch((e) => { console.error('terminate failed:', e.message); process.exit(130); });
    setTimeout(() => process.exit(130), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const t0 = Date.now();
  let podId = null;
  let ssh = null;

  try {
    // 1. Provision
    const offers = await service.searchOffers({ cloudType: 'SECURE' });
    logger.info(`Provisioning SECURE pod (priority list: ${offers.length} GPU types)...`);
    const instance = await service.provisionInstance({
      gpuTypeIds: offers.map((o) => o.id),
      image: IMAGE,
      diskGb: 20,
      cloudType: 'SECURE',
      label: `smoke-${Date.now()}`,
      ports: ['22/tcp', '8188/http'],
    });
    podId = instance.instanceId;
    activePodId = podId;
    logger.info(`Created pod ${podId}. Waiting for RUNNING...`);

    // 2. Wait 30s for pod to settle, then run ssh -vvv once for diagnostics
    logger.info('Waiting 30s for pod to settle...');
    await wait(30000);
    const status = await service.getInstanceStatus(podId);
    logger.info(`status after wait: ${status.status} desiredStatus=${status.desiredStatus}`);
    logger.info(`Connecting: ssh ${status.sshUser}@${status.sshHost}`);

    const r = spawnSync('ssh', [
      '-vv',
      '-i', config.sshKeyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=15',
      '-o', 'PreferredAuthentications=publickey',
      `${status.sshUser}@${status.sshHost}`,
      'echo OK && hostname && nvidia-smi -L',
    ], { encoding: 'utf8', timeout: 30000 });
    console.log('---ssh stderr (auth lines only)---');
    console.log(r.stderr.split('\n').filter(l => /Authentication|Offering|debug1: get_agent|publickey|denied|Permission|Will attempt|user-auth|Key exchange|server software|Will continue|debug1: send_pubkey|Successfully|Authenticat/.test(l)).join('\n'));
    console.log('---ssh stdout---');
    console.log(r.stdout);
    console.log('---ssh exit:', r.status);
    if (r.status !== 0) throw new Error('ssh failed; see diagnostic above');

    // 3. Run nvidia-smi
    const out = await ssh.exec('nvidia-smi -L', { stdio: 'pipe', timeout: 15000 });
    logger.info(`nvidia-smi -L:\n${out.trim()}`);
    logger.info(`SUCCESS in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    logger.error(`FAIL after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (ssh && ssh.close) { try { await ssh.close(); } catch (_) {} }
    if (podId) {
      try {
        await service.terminateInstance(podId);
        logger.info(`Terminated ${podId}`);
      } catch (e) {
        logger.error(`Terminate failed: ${e.message}. CHECK DASHBOARD.`);
      }
      activePodId = null;
    }
  }
}

main();
