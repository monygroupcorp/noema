/**
 * RunPodPodService — GPU rental orchestration for RunPod pod-rental marketplace.
 *
 * Mirrors VastAIService's API shape so a benchmark or worker can swap providers.
 * Both extend ComputeProvider; both expose searchOffers / provisionInstance /
 * getInstanceStatus / terminateInstance / attachSshKey.
 *
 * Key differences vs VastAI:
 *   - SSH is via RunPod's first-class proxy at ssh.runpod.io. The pod's ID
 *     becomes the SSH username; no public IP is needed. This works on both
 *     SECURE and COMMUNITY cloud and is the supported, documented path. We
 *     do NOT request a public IP (supportPublicIp is COMMUNITY-only and
 *     globalNetworking only works on some SECURE datacenters — neither is
 *     necessary once you're going through ssh.runpod.io).
 *   - SSH key injection is dual-path: (a) RunPod auto-injects keys uploaded
 *     to your account settings, and (b) the PUBLIC_KEY env var is also set
 *     at pod creation as a belt-and-suspenders fallback. Either path lands
 *     the key in the pod's authorized_keys.
 *   - HTTP services (e.g. ComfyUI on 8188) are reached through a separate
 *     proxy at https://<podId>-<port>.proxy.runpod.net. Cloudflare-fronted,
 *     so any single request must complete within 100s — fine for ComfyUI's
 *     async submit/poll API, would not work for a synchronous render call.
 *   - "Reliability" doesn't have a direct analog. We use cloudType (SECURE >
 *     COMMUNITY) as the primary stability signal, then preferred GPU order.
 *   - There is NO GPU-types listing endpoint in the REST API (verified from
 *     /v1/openapi.json on 2026-05-04). gpuTypeIds is a fixed enum baked into
 *     the spec. searchOffers therefore returns "offers" built from a curated
 *     list (config preferredGpuTypes, or a sensible default) — pricing and
 *     availability aren't exposed via REST. We rely on RunPod's own
 *     gpuTypePriority="availability" to pick whichever GPU in our list is
 *     actually rentable at provision time.
 *
 * Schema notes (per /v1/openapi.json):
 *   - PodCreateInput.ports is `string[]` like ["22/tcp", "8188/http"]
 *   - PodCreateInput.dockerStartCmd is `string[]`; PodCreateInput has
 *     no `dockerArgs` field
 *   - Pod response has top-level `publicIp` and `portMappings`, but we
 *     ignore both — we route SSH through ssh.runpod.io regardless. They
 *     stay null on SECURE pods anyway.
 *
 * @see notes/ in src/core/services/vastai/ for general SSH/cold-start gotchas
 */
const fs = require('fs');
const { ComputeProvider } = require('../compute');
const { getRunPodPodConfig } = require('../../../config/runpodPod');
const RunPodPodClient = require('./RunPodPodClient');
const RunPodError = require('./RunPodError');

const VALID_CLOUD_TYPES = new Set(['SECURE', 'COMMUNITY']);

// Default GPU types — broad list ordered roughly cheapest-first within the
// 24GB+ band, with a couple of cheap <24GB options as last-resort fallbacks.
// Wide list = better chance of finding capacity in COMMUNITY cloud, where
// RunPod returns HTTP 500 ("This machine does not have the resources to
// deploy your pod") when no host can satisfy the request. All values are
// members of the gpuTypeIds enum in /v1/openapi.json.
const DEFAULT_PREFERRED_GPU_TYPES = [
  'NVIDIA GeForce RTX 3090',           // 24GB
  'NVIDIA GeForce RTX 4090',           // 24GB
  'NVIDIA GeForce RTX 3090 Ti',        // 24GB
  'NVIDIA GeForce RTX 4080',           // 16GB — cheap and plentiful
  'NVIDIA GeForce RTX 4080 SUPER',     // 16GB
  'NVIDIA RTX A5000',                  // 24GB
  'NVIDIA RTX A4500',                  // 20GB
  'NVIDIA L4',                         // 24GB
  'NVIDIA A40',                        // 48GB
  'NVIDIA RTX A6000',                  // 48GB
  'NVIDIA A5000 Ada',                  // 32GB
  'NVIDIA RTX 5000 Ada Generation',    // 32GB
  'NVIDIA L40S',                       // 48GB
  'NVIDIA L40',                        // 48GB
  'NVIDIA RTX A4000',                  // 16GB — last-resort fallback
];

class RunPodPodService extends ComputeProvider {
  constructor({ logger, config } = {}) {
    super({ logger });
    this.config = getRunPodPodConfig(config);
    this.client = new RunPodPodClient({
      apiKey: this.config.apiKey,
      apiBaseUrl: this.config.apiBaseUrl,
      logger: this.logger
    });
  }

  ensureSshKeyConfigured() {
    if (!this.config.sshKeyPath) {
      throw new Error('RunPodPodService requires RUNPOD_SSH_KEY_PATH (or VASTAI_SSH_KEY_PATH) to provision pods');
    }
    const privateKeyExists = fs.existsSync(this.config.sshKeyPath);
    const publicKeyExists = fs.existsSync(`${this.config.sshKeyPath}.pub`);
    if (!privateKeyExists || !publicKeyExists) {
      throw new Error(`RunPod SSH keypair not found at ${this.config.sshKeyPath}`);
    }
  }

  getPublicKey() {
    if (!this.publicKey) {
      this.ensureSshKeyConfigured();
      this.publicKey = fs.readFileSync(`${this.config.sshKeyPath}.pub`, 'utf8').trim();
    }
    return this.publicKey;
  }

  /**
   * Build a synthetic offer from a GPU type ID.
   * Pricing isn't available via REST — caller can fill it in if known.
   */
  buildOfferFromGpuTypeId(gpuTypeId, { cloudType, hourlyUsd = null } = {}) {
    return {
      id: gpuTypeId,
      gpuType: gpuTypeId,
      vramGb: null,        // not exposed via REST
      hourlyUsd,           // not exposed via REST
      cloudType,
      availability: null,  // not exposed via REST
      reliability: cloudType === 'SECURE' ? 1.0 : 0.85,
      raw: { gpuTypeId, cloudType }
    };
  }

  /**
   * Return a prioritized list of "offers" (one per GPU type ID).
   *
   * Because the REST API has no /gpuTypes endpoint and no pricing/availability
   * fields, this method does NOT call RunPod. It returns the configured
   * preferred GPU types as offers, in priority order, so the caller can hand
   * them all to provisionInstance() and let RunPod's gpuTypePriority logic
   * pick whichever is actually available.
   *
   * The benchmark uses offers[0].id as the primary GPU type, but a smarter
   * caller can pass `gpuTypeIds: offers.map(o => o.id)` to provisionInstance
   * for first-available semantics.
   */
  async searchOffers(criteria = {}) {
    const cloudType = (criteria.cloudType || this.config.defaultCloudType || 'SECURE').toUpperCase();
    if (!VALID_CLOUD_TYPES.has(cloudType)) {
      throw new RunPodError(`Invalid cloudType "${cloudType}" — expected SECURE or COMMUNITY`);
    }

    const requested = criteria.gpuTypeIds
      || criteria.preferredGpuTypes
      || (this.config.preferredGpuTypes?.length ? this.config.preferredGpuTypes : DEFAULT_PREFERRED_GPU_TYPES);

    return requested.map((id) => this.buildOfferFromGpuTypeId(id, { cloudType }));
  }

  /**
   * Build the POST /pods payload for a benchmark/job.
   *
   * NOTE on SSH: RunPod's PUBLIC_KEY env var is honored only by images that
   * start sshd themselves on boot — RunPod's official PyTorch images do; the
   * baked flux-comfyui-runtime image does not. For images without sshd, pass
   * `dockerStartCmd: [...]` overriding CMD with an apt-install + sshd command.
   *
   * jobContext.gpuTypeIds (array) takes precedence over offerId so the caller
   * can hand RunPod a prioritized fallback list and let gpuTypePriority pick.
   */
  buildPodPayload(jobContext = {}) {
    const gpuTypeIds = Array.isArray(jobContext.gpuTypeIds) && jobContext.gpuTypeIds.length
      ? jobContext.gpuTypeIds
      : (jobContext.offerId || jobContext.offer?.id ? [jobContext.offerId || jobContext.offer.id] : null);

    if (!gpuTypeIds) {
      throw new RunPodError('gpuTypeIds (or offerId) is required to provision a RunPod pod');
    }
    if (!jobContext.image && !this.config.defaultImage) {
      throw new RunPodError('RunPod provisioning requires an image');
    }

    const cloudType = (jobContext.cloudType || this.config.defaultCloudType || 'SECURE').toUpperCase();
    if (!VALID_CLOUD_TYPES.has(cloudType)) {
      throw new RunPodError(`Invalid cloudType "${cloudType}"`);
    }

    const env = {
      PUBLIC_KEY: this.getPublicKey(),
      ...(jobContext.extraEnv || {})
    };

    // ports must be a string[] per /v1/openapi.json (PodCreateInput.ports)
    let ports = jobContext.ports || ['22/tcp', '8188/http'];
    if (typeof ports === 'string') {
      ports = ports.split(',').map((s) => s.trim()).filter(Boolean);
    }

    // SSH path policy:
    //   - COMMUNITY: default supportPublicIp=true so the pod gets a public IP
    //     and we can SSH in via direct TCP (this path is verified working).
    //   - SECURE: no public IP — caller can opt in to globalNetworking or the
    //     ssh.runpod.io proxy, both currently unverified for our setup.
    // Either default can be overridden by jobContext.
    const payload = {
      name: jobContext.label || this.generateLabel(jobContext),
      imageName: jobContext.image || this.config.defaultImage,
      cloudType,
      computeType: jobContext.computeType || 'GPU',
      gpuTypeIds,
      gpuCount: jobContext.gpuCount || 1,
      gpuTypePriority: jobContext.gpuTypePriority || 'availability',
      containerDiskInGb: jobContext.diskGb || this.config.defaultDiskGb,
      volumeInGb: jobContext.volumeGb || 0,
      ports,
      env,
      interruptible: jobContext.interruptible === true
    };

    const wantsPublicIp = jobContext.supportPublicIp === true
      || (cloudType === 'COMMUNITY' && jobContext.supportPublicIp !== false);
    if (wantsPublicIp) {
      payload.supportPublicIp = true;
    }
    if (jobContext.globalNetworking === true) {
      payload.globalNetworking = true;
    }

    // dockerStartCmd is a string[] override for CMD (no `dockerArgs` in REST API)
    if (jobContext.dockerStartCmd) {
      payload.dockerStartCmd = Array.isArray(jobContext.dockerStartCmd)
        ? jobContext.dockerStartCmd
        : ['bash', '-c', jobContext.dockerStartCmd];
    }
    if (jobContext.dockerEntrypoint) {
      payload.dockerEntrypoint = Array.isArray(jobContext.dockerEntrypoint)
        ? jobContext.dockerEntrypoint
        : [jobContext.dockerEntrypoint];
    }
    if (jobContext.volumeMountPath) {
      payload.volumeMountPath = jobContext.volumeMountPath;
    }

    return payload;
  }

  generateLabel(jobContext = {}) {
    if (jobContext.jobId) {
      return `stationthis-${jobContext.jobId}`;
    }
    return `stationthis-${Date.now()}`;
  }

  /**
   * Direct-TCP SSH endpoint. Only populated once the pod has a publicIp
   * and a port-22 mapping (COMMUNITY + supportPublicIp=true path). Returns
   * { sshHost: null, sshPort: null, sshUser: null } until ready, so callers
   * can poll the same way they always have.
   *
   * For the alternate path through ssh.runpod.io see proxySshEndpoint().
   */
  extractSshEndpoint(rawPod = {}) {
    const publicIp = rawPod.publicIp || null;
    const portMappings = rawPod.portMappings || null;
    if (publicIp && portMappings) {
      const sshPort = portMappings['22'] ?? portMappings[22] ?? null;
      if (sshPort) {
        return { sshHost: publicIp, sshPort: Number(sshPort), sshUser: 'root' };
      }
    }
    return { sshHost: null, sshPort: null, sshUser: null };
  }

  /**
   * Proxy SSH endpoint at ssh.runpod.io. Available as soon as the pod has
   * an ID. Auth depends on the user having registered the key via account
   * settings or `runpodctl ssh add-key`. Note: in practice (2026-05-05)
   * this path returns "Permission denied (publickey)" for our setup
   * despite the key being registered — root cause unresolved.
   */
  proxySshEndpoint(rawPod = {}) {
    const podId = rawPod.id || rawPod.podId || null;
    if (!podId) return { sshHost: null, sshPort: null, sshUser: null };
    return { sshHost: 'ssh.runpod.io', sshPort: 22, sshUser: podId };
  }

  /**
   * URL for the HTTP proxy on a given internal port. The pod must declare
   * `<port>/http` in `ports` at creation. Cloudflare-fronted, 100s timeout
   * per request — fine for ComfyUI's async submit/poll API.
   */
  buildHttpProxyUrl(rawPod = {}, internalPort) {
    const podId = rawPod.id || rawPod.podId;
    if (!podId || !internalPort) return null;
    return `https://${podId}-${internalPort}.proxy.runpod.net`;
  }

  normalizeInstance(rawPod = {}) {
    const { sshHost, sshPort, sshUser } = this.extractSshEndpoint(rawPod);

    // desiredStatus is RUNNING when the pod is fully booted on a host. The
    // ssh.runpod.io proxy can't reach the container's sshd until then.
    // Callers still need to probe SSH itself — sshd may take a few extra
    // seconds to bind after the pod reports RUNNING.
    const desiredStatus = rawPod.desiredStatus || rawPod.status;
    const status = (desiredStatus === 'RUNNING')
      ? 'running'
      : (desiredStatus || 'unknown').toString().toLowerCase();

    const machine = rawPod.machine || {};
    const gpu = rawPod.gpu || {};
    return {
      instanceId: rawPod.id || rawPod.podId,
      publicIp: rawPod.publicIp || null,
      sshHost,
      sshPort,
      sshUser,
      comfyuiUrl: this.buildHttpProxyUrl(rawPod, 8188),
      status,
      desiredStatus,
      hourlyUsd: rawPod.costPerHr ?? rawPod.adjustedCostPerHr ?? null,
      gpuType: machine.gpuDisplayName || gpu.gpuTypeId || machine.gpuType || null,
      diskGb: rawPod.containerDiskInGb,
      label: rawPod.name,
      portMappings: rawPod.portMappings || null,
      raw: rawPod
    };
  }

  async provisionInstance(jobContext = {}) {
    this.ensureSshKeyConfigured();
    const payload = this.buildPodPayload(jobContext);
    const response = await this.client.createPod(payload);

    // RunPod's response shape: typically { id, ...podFields } at top level.
    // Some endpoints wrap it as { data: {...} } — handle both.
    const podData = response?.data || response;
    const podId = podData?.id || podData?.podId;
    if (!podId) {
      throw new RunPodError('createPod returned no pod ID', { code: 'NO_POD_ID' });
    }

    // Pod isn't ready immediately — caller should poll getInstanceStatus.
    return this.normalizeInstance(podData);
  }

  async getInstanceStatus(instanceId) {
    const response = await this.client.getPod(instanceId);
    const podData = response?.data || response;
    return this.normalizeInstance(podData);
  }

  /**
   * RunPod injects the SSH public key at pod creation via PUBLIC_KEY env var.
   * There's no separate "attach key" endpoint, so this is a no-op for parity
   * with VastAIService.attachSshKey().
   */
  async attachSshKey(_instanceId) {
    return { success: true, note: 'PUBLIC_KEY injected at pod creation; no-op' };
  }

  async terminateInstance(instanceId, { deleteInstance = true } = {}) {
    if (deleteInstance) {
      await this.client.terminatePod(instanceId);
    } else {
      await this.client.stopPod(instanceId);
    }
    this.logger.info(`[RunPod] Pod ${instanceId} ${deleteInstance ? 'terminated' : 'stopped'}`);
  }
}

module.exports = RunPodPodService;
