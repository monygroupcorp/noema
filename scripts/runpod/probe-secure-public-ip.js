#!/usr/bin/env node
/**
 * probe-secure-public-ip.js — Settle the question: do SECURE pods get a public
 * IP when supportPublicIp=true is requested? Docs (expose-ports page) imply yes
 * and that the IPs are MORE stable than COMMUNITY. Our earlier 3-minute probe
 * came back with publicIp:"" — but maybe we didn't wait long enough, or the
 * specific GPU type / data center didn't have public IP capacity.
 *
 * This probe:
 *   1. Provisions a SECURE pod with supportPublicIp=true (small disk, cheap GPU)
 *   2. Polls /pods/{id} every 10s for up to 8 min
 *   3. Logs full pod state on every poll so we can see exactly when (if ever)
 *      publicIp + portMappings populate
 *   4. Tries direct-TCP SSH the moment they appear
 *   5. Cleans up no matter what
 */
require('dotenv').config();

const { spawnSync } = require('child_process');
const { RunPodPodService } = require('../../src/core/services/runpod');
const { getRunPodPodConfig } = require('../../src/config/runpodPod');

const IMAGE = 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04';

const logger = {
  info: (...a) => console.log(`[${new Date().toISOString()}]`, ...a),
  warn: (...a) => console.log(`[${new Date().toISOString()}] WARN:`, ...a),
  error: (...a) => console.error(`[${new Date().toISOString()}] ERROR:`, ...a),
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = getRunPodPodConfig();
  const service = new RunPodPodService({ logger, config });

  let podId = null;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned || !podId) return;
    cleaned = true;
    try { await service.terminateInstance(podId); logger.info(`terminated ${podId}`); }
    catch (e) { logger.error(`terminate failed: ${e.message}`); }
  };
  process.on('SIGINT', () => cleanup().then(() => process.exit(130)));
  process.on('SIGTERM', () => cleanup().then(() => process.exit(143)));

  try {
    const offers = await service.searchOffers({ cloudType: 'SECURE' });
    logger.info(`SECURE offers: ${offers.length} GPU types`);

    // Cheap SECURE GPUs: A4000, RTX 3090, L4, RTX A4500
    const gpuTypeIds = [
      'NVIDIA RTX A4000',
      'NVIDIA L4',
      'NVIDIA RTX A4500',
      'NVIDIA GeForce RTX 3090',
    ];

    logger.info(`Provisioning SECURE pod with supportPublicIp=true...`);
    const instance = await service.provisionInstance({
      gpuTypeIds,
      image: IMAGE,
      diskGb: 20,
      cloudType: 'SECURE',
      label: `secure-probe-${Date.now()}`,
      ports: ['22/tcp', '8188/http'],
      supportPublicIp: true,  // explicit opt-in for SECURE
    });
    podId = instance.instanceId;
    logger.info(`pod ${podId} created. Polling for publicIp...`);

    const deadline = Date.now() + 8 * 60 * 1000;
    let attempt = 0;
    let firstSshTry = false;
    while (Date.now() < deadline) {
      attempt += 1;
      const status = await service.getInstanceStatus(podId);
      const raw = status.raw || {};
      logger.info(
        `poll ${attempt}: status=${status.status} desired=${status.desiredStatus} `
        + `publicIp="${raw.publicIp || ''}" `
        + `portMappings=${JSON.stringify(raw.portMappings || null)} `
        + `machineId=${raw.machineId || '?'} `
        + `dataCenterId=${raw.dataCenterId || '?'}`
      );

      if (status.sshHost && status.sshPort && !firstSshTry) {
        firstSshTry = true;
        logger.info(`>>> direct SSH endpoint up: ${status.sshUser}@${status.sshHost}:${status.sshPort}. Trying connection...`);
        const r = spawnSync('ssh', [
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-o', 'ConnectTimeout=10',
          '-o', 'PreferredAuthentications=publickey',
          '-o', 'BatchMode=yes',
          '-i', config.sshKeyPath,
          '-p', String(status.sshPort),
          `${status.sshUser}@${status.sshHost}`,
          'echo SSH_OK && uname -a && nvidia-smi -L',
        ], { encoding: 'utf8', timeout: 20000 });
        console.log('--- ssh stdout ---');
        console.log(r.stdout);
        console.log('--- ssh stderr (last 200 chars) ---');
        console.log((r.stderr || '').slice(-200));
        console.log('--- ssh exit:', r.status);
        if (r.status === 0) {
          logger.info(`>>> SUCCESS: SECURE direct-IP SSH works on this pod`);
          break;
        } else {
          logger.warn(`SSH failed; will keep polling in case sshd just isn't up yet`);
          firstSshTry = false; // retry on next poll
        }
      }

      await wait(10000);
    }

    if (!firstSshTry) {
      logger.warn(`8min cap hit — publicIp never populated for SECURE pod ${podId}`);
    }
  } catch (err) {
    logger.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
