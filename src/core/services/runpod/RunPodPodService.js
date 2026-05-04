/**
 * RunPodPodService — GPU rental orchestration for RunPod pod-rental marketplace.
 *
 * Mirrors VastAIService's API shape so a benchmark or worker can swap providers.
 * Both extend ComputeProvider; both expose searchOffers / provisionInstance /
 * getInstanceStatus / terminateInstance / attachSshKey.
 *
 * Key differences vs VastAI:
 *   - SSH is direct (not proxied through ssh2.vast.ai) — RunPod assigns a
 *     public IP + mapped TCP port for port 22 inside the container.
 *   - SSH key injection is via the PUBLIC_KEY env var (RunPod convention) at
 *     pod creation time. Their official PyTorch templates honor this; custom
 *     images need an openssh-server present (or installed on startup).
 *   - "Reliability" doesn't have a direct analog. We use cloudType (SECURE >
 *     COMMUNITY) as the primary stability signal, then price.
 *   - "Offers" are abstracted: searchOffers returns synthetic offers built from
 *     GPU types whose listed cloudType availability matches our requirements.
 *     RunPod doesn't expose a per-host marketplace listing the way VastAI does.
 *
 * @see notes/ in src/core/services/vastai/ for general SSH/cold-start gotchas
 */
const fs = require('fs');
const { ComputeProvider } = require('../compute');
const { getRunPodPodConfig } = require('../../../config/runpodPod');
const RunPodPodClient = require('./RunPodPodClient');
const RunPodError = require('./RunPodError');

const VALID_CLOUD_TYPES = new Set(['SECURE', 'COMMUNITY']);

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
   * Normalize a raw GPU-type entry from /gputypes into our offer shape.
   * One GPU type = one synthetic offer; price + availability come from the
   * cloud-type breakdown that RunPod returns per type.
   */
  normalizeGpuTypeAsOffer(rawGpuType = {}, { cloudType }) {
    const cloudKey = cloudType === 'SECURE' ? 'secureCloud' : 'communityCloud';
    const cloudInfo = rawGpuType[cloudKey] || {};

    // RunPod surfaces these on different endpoints with slightly different
    // field names — be tolerant.
    const hourlyUsd =
      cloudInfo.lowestPrice?.uninterruptablePrice ??
      cloudInfo.minimumBidPrice ??
      cloudInfo.onDemandPrice ??
      rawGpuType.lowestPrice?.uninterruptablePrice ??
      null;

    const memoryInGb =
      rawGpuType.memoryInGb ??
      rawGpuType.memoryGb ??
      rawGpuType.vramGb ??
      null;

    return {
      // Use the GPU type ID as the offer ID — provisionInstance will pass it as gpuTypeIds.
      id: rawGpuType.id || rawGpuType.gpuTypeId,
      gpuType: rawGpuType.displayName || rawGpuType.id,
      vramGb: memoryInGb,
      hourlyUsd: hourlyUsd != null ? parseFloat(hourlyUsd) : null,
      cloudType,
      // Higher availability count = lower chance we lose the race to another tenant.
      availability: cloudInfo.availability ?? cloudInfo.availableInstances ?? null,
      // RunPod's "reliability" stand-in: secure cloud = ToB datacenters, community = third-party.
      reliability: cloudType === 'SECURE' ? 1.0 : 0.85,
      raw: rawGpuType
    };
  }

  /**
   * Search RunPod GPU SKUs and return synthetic offers ranked by reliability + price.
   * RunPod doesn't expose a per-host marketplace, so we build offers from
   * /gputypes filtered by VRAM and cloud type availability.
   */
  async searchOffers(criteria = {}) {
    const cloudType = (criteria.cloudType || this.config.defaultCloudType || 'COMMUNITY').toUpperCase();
    if (!VALID_CLOUD_TYPES.has(cloudType)) {
      throw new RunPodError(`Invalid cloudType "${cloudType}" — expected SECURE or COMMUNITY`);
    }

    const data = await this.client.listGpuTypes();
    const gpuTypes = Array.isArray(data) ? data : (data?.data || data?.gpuTypes || []);
    const offers = gpuTypes.map((g) => this.normalizeGpuTypeAsOffer(g, { cloudType }));
    return this.filterAndSortOffers(offers, { ...criteria, cloudType });
  }

  filterAndSortOffers(offers = [], criteria = {}) {
    const minVramGb = criteria.minVramGb ?? this.config.minVramGb;
    const maxHourlyUsd = criteria.maxHourlyUsd ?? this.config.maxPriceUsdPerHour;
    const preferredSubstrings = (criteria.preferredGpuTypes || this.config.preferredGpuTypes || [])
      .map((s) => s.toLowerCase());

    const filtered = offers.filter((offer) => {
      if (!offer.id) return false;
      // Drop offers whose pricing/availability isn't published for the chosen cloud tier.
      if (offer.hourlyUsd == null) return false;
      if (minVramGb && offer.vramGb && offer.vramGb < minVramGb) return false;
      if (maxHourlyUsd && offer.hourlyUsd > maxHourlyUsd) return false;
      if (offer.availability != null && offer.availability <= 0) return false;
      if (criteria.gpuType) {
        const q = criteria.gpuType.toLowerCase();
        if (!offer.gpuType?.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    // Boost preferred GPU types to the top, then sort by reliability desc, price asc.
    filtered.sort((a, b) => {
      const aPref = preferredSubstrings.some((p) => a.gpuType?.toLowerCase().includes(p)) ? 1 : 0;
      const bPref = preferredSubstrings.some((p) => b.gpuType?.toLowerCase().includes(p)) ? 1 : 0;
      if (aPref !== bPref) return bPref - aPref;

      const relA = a.reliability ?? 0;
      const relB = b.reliability ?? 0;
      if (relB !== relA) return relB - relA;

      return (a.hourlyUsd ?? 0) - (b.hourlyUsd ?? 0);
    });

    return filtered;
  }

  /**
   * Build the POST /pods payload for a benchmark/job.
   * NOTE on SSH: RunPod's standard PUBLIC_KEY env var is honored by their
   * official base images, which start sshd on boot. Custom images (like the
   * baked flux-comfyui-runtime image) generally do NOT include openssh-server.
   * Pass `dockerArgs` to install/start sshd on boot if needed — see the
   * benchmark script for an example startup command.
   */
  buildPodPayload(jobContext = {}) {
    const offerId = jobContext.offerId || jobContext.offer?.id;
    if (!offerId) {
      throw new RunPodError('offerId (gpuTypeId) is required to provision a RunPod pod');
    }
    if (!jobContext.image && !this.config.defaultImage) {
      throw new RunPodError('RunPod provisioning requires an image');
    }

    const cloudType = (jobContext.cloudType || this.config.defaultCloudType || 'COMMUNITY').toUpperCase();
    if (!VALID_CLOUD_TYPES.has(cloudType)) {
      throw new RunPodError(`Invalid cloudType "${cloudType}"`);
    }

    const env = {
      PUBLIC_KEY: this.getPublicKey(),
      ...(jobContext.extraEnv || {})
    };

    const payload = {
      name: jobContext.label || this.generateLabel(jobContext),
      imageName: jobContext.image || this.config.defaultImage,
      cloudType,
      gpuTypeIds: [offerId],
      gpuCount: jobContext.gpuCount || 1,
      containerDiskInGb: jobContext.diskGb || this.config.defaultDiskGb,
      volumeInGb: jobContext.volumeGb || 0,
      ports: jobContext.ports || '22/tcp,8188/http',
      env,
      supportPublicIp: jobContext.supportPublicIp !== false,
      interruptible: jobContext.interruptible === true
    };

    if (jobContext.dockerArgs) {
      payload.dockerArgs = jobContext.dockerArgs;
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
   * Pull SSH host/port out of a RunPod pod's runtime ports list.
   * RunPod exposes mapped public ports under runtime.ports[]:
   *   { ip, isIpPublic, privatePort, publicPort, type }
   * We want the entry where privatePort=22 and isIpPublic=true.
   */
  extractSshEndpoint(rawPod = {}) {
    const ports = rawPod.runtime?.ports || rawPod.ports || [];
    const sshPort = ports.find((p) => (p.privatePort === 22 || p.privatePort === '22') && p.isIpPublic !== false);
    if (!sshPort) {
      return { sshHost: null, sshPort: null, publicIp: null };
    }
    return {
      sshHost: sshPort.ip || sshPort.publicIp || null,
      sshPort: sshPort.publicPort || sshPort.externalPort || null,
      publicIp: sshPort.ip || sshPort.publicIp || null
    };
  }

  normalizeInstance(rawPod = {}) {
    const { sshHost, sshPort, publicIp } = this.extractSshEndpoint(rawPod);

    // RunPod's status field shape: desiredStatus is the user-set target,
    // currentStatus / lastStatusChange reflect actual state. The pod is
    // "ready" when runtime is populated AND a public SSH port is mapped.
    const desiredStatus = rawPod.desiredStatus || rawPod.status;
    const hasRuntime = !!(rawPod.runtime && (rawPod.runtime.uptimeInSeconds != null || rawPod.runtime.ports));
    const status = hasRuntime && desiredStatus === 'RUNNING' ? 'running' : (desiredStatus || 'unknown').toString().toLowerCase();

    const machine = rawPod.machine || {};
    return {
      instanceId: rawPod.id || rawPod.podId,
      publicIp,
      sshHost,
      sshPort,
      sshUser: 'root',
      status,
      hourlyUsd: rawPod.costPerHr ?? rawPod.adjustedCostPerHr ?? null,
      gpuType: machine.gpuDisplayName || machine.gpuType || rawPod.gpuTypeId,
      diskGb: rawPod.containerDiskInGb,
      label: rawPod.name,
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
