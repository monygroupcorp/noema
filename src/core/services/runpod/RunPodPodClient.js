const axios = require('axios');
const RunPodError = require('./RunPodError');

const DEFAULT_TIMEOUT_MS = 30000;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * sanitizeAxiosError — strip secrets from an axios error before it leaves
 * this module. Axios attaches the full request `config` (including the
 * `Authorization` header and the request body) to thrown errors, and that
 * config is reachable via `.toJSON()`, `JSON.stringify(err)`, and in some
 * code paths `err.message` itself. PUBLIC_KEY env values, query-string
 * tokens, and Bearer tokens have all been observed leaking into logs.
 *
 * Returns a plain Error with only safe fields attached as own properties:
 *   status, statusText, body (truncated string), method, urlPath
 *
 * The original axios error is NOT preserved as `.cause` — it carries the
 * config object back into the chain. We log enough to debug from
 * status + body alone.
 */
function sanitizeAxiosError(error) {
  const status = error.response?.status ?? null;
  const statusText = error.response?.statusText ?? null;
  const rawBody = error.response?.data;
  let bodyMsg = '';
  if (typeof rawBody === 'string') {
    bodyMsg = rawBody;
  } else if (rawBody && typeof rawBody === 'object') {
    bodyMsg = rawBody.message || rawBody.error || JSON.stringify(rawBody);
  }
  if (bodyMsg.length > 500) bodyMsg = `${bodyMsg.slice(0, 500)}…`;

  const method = (error.config?.method || 'unknown').toString().toUpperCase();
  // Use the relative URL (no full base + no query params); strip everything
  // after `?` defensively in case a path-level query slipped in.
  const rawUrl = error.config?.url || '';
  const urlPath = rawUrl.split('?')[0] || rawUrl;

  const code = error.response?.data?.error
    || error.response?.data?.code
    || (error.code && !/^ERR_/.test(error.code) ? error.code : null);
  const requestId = error.response?.headers?.['x-request-id'] || null;

  const message = bodyMsg
    || statusText
    || (status ? `HTTP ${status}` : 'RunPod pod request failed');

  // Build a clean Error — no axios config, no headers, no request data.
  const clean = new Error(message);
  clean.name = 'RunPodAxiosError';
  clean.status = status;
  clean.statusText = statusText;
  clean.body = bodyMsg || null;
  clean.method = method;
  clean.urlPath = urlPath;
  clean.code = code;
  clean.requestId = requestId;
  // Override toJSON so JSON.stringify(err) cannot leak fields we did not opt-in to.
  clean.toJSON = function toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      body: this.body,
      method: this.method,
      urlPath: this.urlPath,
      code: this.code,
      requestId: this.requestId
    };
  };
  return clean;
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
 *
 * Error hygiene: every thrown RunPodError wraps a sanitized cause that
 * does NOT carry the axios request config. See sanitizeAxiosError() above.
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
        // Sanitize *immediately* — never let the raw axios error survive
        // beyond this catch block. lastError is the cleaned version.
        const cleaned = sanitizeAxiosError(error);
        lastError = cleaned;
        const status = cleaned.status;
        const errCode = cleaned.code;
        const bodyMsg = cleaned.body || '';
        // RunPod surfaces capacity exhaustion as a 500 with a specific message.
        // Retrying with exponential backoff doesn't help — no host exists.
        // Bail immediately so the caller can try a different config.
        const isCapacityError = status === 500 && /does not have the resources/i.test(bodyMsg);
        const shouldRetry = RETRYABLE_STATUS.has(status) && attempt < retries && !isCapacityError;
        this.logger.warn(
          `[RunPodPodClient] ${method} ${finalUrl} failed (status=${status} code=${errCode || 'n/a'} msg=${cleaned.message}) attempt=${attempt + 1}/${retries + 1}${isCapacityError ? ' [capacity, not retrying]' : ''}`
        );
        if (!shouldRetry) {
          throw new RunPodError(
            cleaned.message || 'RunPod pod request failed',
            {
              status,
              code: errCode,
              requestId: cleaned.requestId,
              cause: cleaned
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
module.exports.sanitizeAxiosError = sanitizeAxiosError;

// ---------------------------------------------------------------------------
// Inline smoke check — `node RunPodPodClient.js` runs this. Confirms a 500
// with a Bearer-token-bearing axios config doesn't leak the secret into the
// thrown error's message, toString, stack, or JSON serialization.
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    const SECRET = 'rpa_test_secret_xyz';
    const fakeAxiosError = Object.assign(new Error('Request failed with status code 500 — config: { Authorization: Bearer ' + SECRET + ' }'), {
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        data: { message: 'This machine does not have the resources to deploy your pod' },
        headers: { 'x-request-id': 'req-abc' }
      },
      config: {
        method: 'post',
        url: '/pods?token=' + SECRET,
        baseURL: 'https://rest.runpod.io/v1',
        headers: { Authorization: 'Bearer ' + SECRET, Accept: 'application/json' },
        data: JSON.stringify({ PUBLIC_KEY: 'ssh-ed25519 AAAA' + SECRET })
      },
      isAxiosError: true,
      code: 'ERR_BAD_RESPONSE',
      toJSON() {
        return { config: this.config, message: this.message };
      }
    });

    // 1) sanitizeAxiosError directly
    const cleaned = sanitizeAxiosError(fakeAxiosError);
    const probes = [
      ['cleaned.message', cleaned.message],
      ['cleaned.toString()', cleaned.toString()],
      ['cleaned.stack', cleaned.stack || ''],
      ['JSON.stringify(cleaned)', JSON.stringify(cleaned)]
    ];
    let leaks = [];
    for (const [name, val] of probes) {
      if (String(val).includes(SECRET)) leaks.push(name);
    }

    // 2) End-to-end: fake axios instance, real client.request
    const RunPodError = require('./RunPodError');
    const client = new RunPodPodClient({
      apiKey: SECRET,
      apiBaseUrl: 'https://rest.runpod.io/v1',
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }
    });
    // Stub the http instance to throw our fake axios error.
    client.http = {
      request: async () => { throw fakeAxiosError; }
    };
    let thrown;
    try {
      await client.request({ method: 'POST', url: '/pods', data: { PUBLIC_KEY: SECRET }, retries: 0 });
    } catch (e) {
      thrown = e;
    }
    if (!(thrown instanceof RunPodError)) {
      console.error('FAIL: client.request did not throw RunPodError, got', thrown);
      process.exit(1);
    }
    const e2eProbes = [
      ['thrown.message', thrown.message],
      ['thrown.toString()', thrown.toString()],
      ['thrown.stack', thrown.stack || ''],
      ['JSON.stringify(thrown)', JSON.stringify(thrown)],
      ['JSON.stringify(thrown.cause)', JSON.stringify(thrown.cause)],
      ['thrown.cause?.message', thrown.cause?.message || ''],
      ['thrown.cause?.stack', thrown.cause?.stack || '']
    ];
    for (const [name, val] of e2eProbes) {
      if (String(val).includes(SECRET)) leaks.push(name);
    }

    if (leaks.length) {
      console.error('FAIL: secret leaked through:', leaks.join(', '));
      process.exit(1);
    }
    console.log('PASS: RunPodPodClient sanitizer — no leak of', SECRET, 'across', probes.length + e2eProbes.length, 'probes');
    console.log('  cleaned.body:', cleaned.body);
    console.log('  cleaned.urlPath:', cleaned.urlPath);
    console.log('  thrown.status:', thrown.status, 'thrown.message:', thrown.message);
  })().catch((err) => {
    console.error('FAIL: smoke check threw', err);
    process.exit(1);
  });
}
