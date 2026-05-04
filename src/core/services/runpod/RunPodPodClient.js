const axios = require('axios');
const RunPodError = require('./RunPodError');

const DEFAULT_TIMEOUT_MS = 30000;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RunPodPodClient — REST wrapper for RunPod's pod-rental API.
 *
 * Base URL: https://rest.runpod.io/v1
 * Auth:     Authorization: Bearer <RUNPOD_API_KEY>
 *
 * NOT to be confused with RunPodClient (serverless). Pod-rental gives you a
 * raw GPU box you SSH into, like a VastAI instance. Serverless is a job queue.
 *
 * The REST API is the supported surface going forward — the legacy GraphQL API
 * at api.runpod.io/graphql is being deprecated.
 *
 * Key endpoints used here:
 *   GET    /gputypes        — list available GPU SKUs
 *   GET    /gputypes/{id}   — current availability for a SKU
 *   POST   /pods            — provision a pod
 *   GET    /pods            — list pods (filtered)
 *   GET    /pods/{id}       — fetch status, ports, IPs
 *   DELETE /pods/{id}       — terminate a pod
 *
 * Mirrors VastAIClient's retry/backoff structure for consistency.
 */
class RunPodPodClient {
  constructor({ apiKey, apiBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, logger }) {
    if (!apiKey) {
      throw new Error('RunPodPodClient requires an API key');
    }
    if (!apiBaseUrl) {
      throw new Error('RunPodPodClient requires an apiBaseUrl');
    }
    this.apiKey = apiKey;
    this.logger = logger || console;
    this.http = axios.create({
      baseURL: apiBaseUrl.replace(/\/$/, ''),
      timeout: timeoutMs
    });
  }

  async request({ method, url, params, data, headers = {}, retries = 2, timeoutMs }) {
    const finalUrl = url.startsWith('/') ? url : `/${url}`;
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      try {
        const response = await this.http.request({
          method,
          url: finalUrl,
          params,
          data,
          timeout: timeoutMs,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...headers
          }
        });
        return response.data;
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const errCode = error.code || error.response?.data?.error;
        const shouldRetry = RETRYABLE_STATUS.has(status) && attempt < retries;
        const body = error.response?.data;
        this.logger.warn(
          `[RunPodPodClient] ${method} ${finalUrl} failed (status=${status} code=${errCode || 'n/a'} msg=${error.message}) attempt=${attempt + 1}/${retries + 1}`
        );
        if (!shouldRetry) {
          throw new RunPodError(
            body?.message || body?.error || error.message || 'RunPod pod request failed',
            {
              status,
              code: body?.error || body?.code,
              requestId: error.response?.headers?.['x-request-id'],
              cause: error
            }
          );
        }
        const backoff = 2 ** attempt * 250;
        await delay(backoff);
        attempt += 1;
      }
    }

    throw lastError;
  }

  /**
   * GET /gputypes — list all GPU SKUs available on RunPod.
   * Returns array of { id, displayName, memoryInGb, secureCloud, communityCloud, ... }.
   */
  async listGpuTypes() {
    return this.request({ method: 'GET', url: '/gputypes' });
  }

  /**
   * GET /gputypes/{id} — fetch one GPU SKU including current availability.
   * Used to check how many machines RunPod has of a given GPU type right now.
   */
  async listAvailableGpus(gpuTypeId) {
    if (!gpuTypeId) {
      throw new Error('listAvailableGpus requires a gpuTypeId');
    }
    return this.request({ method: 'GET', url: `/gputypes/${encodeURIComponent(gpuTypeId)}` });
  }

  /**
   * POST /pods — provision a pod.
   *
   * Common payload fields (per RunPod REST docs):
   *   - name              (string)   — display name
   *   - imageName         (string)   — Docker image, e.g. "stationthis/flux-comfyui-runtime:v1"
   *   - cloudType         (string)   — "SECURE" or "COMMUNITY"
   *   - gpuTypeIds        (string[]) — preferred GPU SKU IDs; RunPod picks one available
   *   - gpuCount          (number)   — usually 1
   *   - containerDiskInGb (number)   — ephemeral disk
   *   - volumeInGb        (number)   — persistent volume (0 = no volume)
   *   - ports             (string)   — e.g. "22/tcp,8188/http"
   *   - env               (object)   — { PUBLIC_KEY: "ssh-ed25519 ..." }
   *   - dockerArgs        (string)   — optional command override
   *   - supportPublicIp   (boolean)  — request a public IP (needed for direct SSH)
   *   - interruptible     (boolean)  — false for on-demand
   */
  async createPod(payload) {
    if (!payload || !payload.imageName) {
      throw new Error('createPod requires an imageName');
    }
    return this.request({ method: 'POST', url: '/pods', data: payload });
  }

  /**
   * GET /pods/{id} — fetch a pod's current state.
   * Response includes desiredStatus, machine info, runtime { ports, uptimeInSeconds }, etc.
   */
  async getPod(podId) {
    if (!podId) {
      throw new Error('getPod requires a podId');
    }
    return this.request({ method: 'GET', url: `/pods/${encodeURIComponent(podId)}` });
  }

  /**
   * GET /pods — list pods owned by the authenticated user.
   */
  async listPods(params = {}) {
    return this.request({ method: 'GET', url: '/pods', params });
  }

  /**
   * DELETE /pods/{id} — terminate (and free) a pod.
   * RunPod also exposes /pods/{id}/stop to suspend without deleting; for our
   * benchmark we always want delete so we don't keep paying for storage.
   */
  async terminatePod(podId) {
    if (!podId) {
      throw new Error('terminatePod requires a podId');
    }
    return this.request({ method: 'DELETE', url: `/pods/${encodeURIComponent(podId)}` });
  }

  /**
   * POST /pods/{id}/stop — suspend a pod (keeps storage). Not used by the
   * benchmark, but exposed for parity with VastAI's stop semantics.
   */
  async stopPod(podId) {
    if (!podId) {
      throw new Error('stopPod requires a podId');
    }
    return this.request({ method: 'POST', url: `/pods/${encodeURIComponent(podId)}/stop` });
  }
}

module.exports = RunPodPodClient;
