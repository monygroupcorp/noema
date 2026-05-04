const path = require('path');

const REQUIRED_ENV_VARS = ['RUNPOD_API_KEY'];

function getRequiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var ${key} for RunPod pod-rental config`);
  }
  return value;
}

function parseCsv(value) {
  if (!value) {
    return [];
  }
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

/**
 * RunPod Pod-Rental Configuration
 *
 * NOTE: This is the PoD-RENTAL config (REST API at https://rest.runpod.io/v1),
 * separate from the SERVERLESS config in src/config/runpod.js. They share the
 * same RUNPOD_API_KEY but talk to different API surfaces. Don't conflate them.
 *
 * Env vars:
 *   RUNPOD_API_KEY                  (required) — same key as serverless
 *   RUNPOD_POD_API_BASE_URL         (optional, default https://rest.runpod.io/v1)
 *   RUNPOD_SSH_KEY_PATH             (optional, falls back to VASTAI_SSH_KEY_PATH)
 *   RUNPOD_PREFERRED_GPUS           (optional, CSV) — gpu type id substrings to prefer
 *   RUNPOD_MIN_VRAM_GB              (optional, default 24)
 *   RUNPOD_DEFAULT_DISK_GB          (optional, default 60)
 *   RUNPOD_DEFAULT_CLOUD_TYPE       (optional, COMMUNITY or SECURE, default COMMUNITY)
 *   RUNPOD_MAX_PRICE_PER_HOUR       (optional, default 1.00)
 */
function getRunPodPodConfig(overrides = {}) {
  const sshKeyPath = process.env.RUNPOD_SSH_KEY_PATH || process.env.VASTAI_SSH_KEY_PATH;
  const config = {
    apiBaseUrl: process.env.RUNPOD_POD_API_BASE_URL || 'https://rest.runpod.io/v1',
    apiKey: getRequiredEnv('RUNPOD_API_KEY'),
    sshKeyPath: sshKeyPath ? path.resolve(sshKeyPath) : null,
    preferredGpuTypes: parseCsv(process.env.RUNPOD_PREFERRED_GPUS),
    minVramGb: parseInt(process.env.RUNPOD_MIN_VRAM_GB || '24', 10),
    defaultDiskGb: parseInt(process.env.RUNPOD_DEFAULT_DISK_GB || '60', 10),
    defaultCloudType: (process.env.RUNPOD_DEFAULT_CLOUD_TYPE || 'COMMUNITY').toUpperCase(),
    maxPriceUsdPerHour: parseFloat(process.env.RUNPOD_MAX_PRICE_PER_HOUR || '1.00'),
    loggerLabel: 'RunPodPodService',
    ...overrides
  };

  if (!config.sshKeyPath) {
    console.warn('[runpod-pod config] No SSH key path set (RUNPOD_SSH_KEY_PATH or VASTAI_SSH_KEY_PATH); provisioning will fail until configured');
  }

  return config;
}

module.exports = {
  getRunPodPodConfig,
  REQUIRED_ENV_VARS
};
