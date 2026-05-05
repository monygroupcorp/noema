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
 * Endpoints exposed (verified via /v1/openapi.json on 2026-05-04):
 *   POST   /pods                — provision a pod
 *   GET    /pods                — list pods
 *   GET    /pods/{id}           — fetch pod status (publicIp, portMappings, etc.)
 *   PATCH  /pods/{id}           — update mutable fields
 *   DELETE /pods/{id}           — terminate a pod
 *   POST   /pods/{id}/stop      — suspend without deleting
 *   POST   /pods/{id}/start     — resume a stopped pod
 *   GET/POST /templates         — pod/endpoint templates
 *   GET/POST /endpoints         — serverless endpoints (separate from RunPodClient)
 *   GET/POST /networkvolumes    — persistent volumes
 *
 * NOT exposed: there is NO /gputypes endpoint. The list of valid GPU type
 * IDs is a fixed enum in the OpenAPI spec (PodCreateInput.gpuTypeIds.items.enum).
 * For pricing/availability you'd need the legacy GraphQL API at
 * api.runpod.io/graphql, which we are intentionally NOT adding here.
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
