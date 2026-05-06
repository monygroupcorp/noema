/**
 * GPUScheduler — picks an ordered list of RunPod GPU type IDs for a workload.
 *
 * Pure-function-y: takes a workload spec, returns the gpuTypeIds array that
 * RunPodPodService.provisionInstanceWithRetry() will rotate through on
 * capacity-500 errors. SECURE-first by policy (per 2026-05-06 shootout);
 * COMMUNITY-fallback only when cloudPreference === 'AUTO'.
 *
 * Static catalog for v1 — RunPod has no /gpuTypes endpoint and pricing is not
 * exposed via REST (see RunPodPodService header). Numbers below are sourced
 * from runpod.io console and our shootout memo
 * (docs/benchmarks/2026-05-06-runpod-vs-vastai-shootout.md). Refresh manually.
 */

const VALID_CLOUD_PREFERENCES = new Set(['SECURE', 'COMMUNITY', 'AUTO']);

const GPU_CATALOG = [
  { gpuTypeId: 'NVIDIA RTX A4000',            vramGb: 16, secureUsdPerHr: 0.32, communityUsdPerHr: 0.17 },
  { gpuTypeId: 'NVIDIA RTX A4500',            vramGb: 20, secureUsdPerHr: 0.36, communityUsdPerHr: 0.21 },
  { gpuTypeId: 'NVIDIA GeForce RTX 3090',     vramGb: 24, secureUsdPerHr: 0.43, communityUsdPerHr: 0.22 },
  { gpuTypeId: 'NVIDIA RTX A5000',            vramGb: 24, secureUsdPerHr: 0.46, communityUsdPerHr: 0.26 },
  { gpuTypeId: 'NVIDIA GeForce RTX 4090',     vramGb: 24, secureUsdPerHr: 0.69, communityUsdPerHr: 0.34 },
  { gpuTypeId: 'NVIDIA RTX A6000',            vramGb: 48, secureUsdPerHr: 0.79, communityUsdPerHr: 0.49 }
];

function priceFor(gpu, cloudType) {
  return cloudType === 'SECURE' ? gpu.secureUsdPerHr : gpu.communityUsdPerHr;
}

function rankCandidates(catalog, { vramGb, maxPricePerHr, cloudType, preferredGpus }) {
  const preferred = Array.isArray(preferredGpus) ? preferredGpus : [];
  return catalog
    .filter((gpu) => gpu.vramGb >= vramGb)
    .filter((gpu) => {
      const price = priceFor(gpu, cloudType);
      return maxPricePerHr == null || price <= maxPricePerHr;
    })
    .map((gpu) => ({
      gpuTypeId: gpu.gpuTypeId,
      cloudType,
      vramGb: gpu.vramGb,
      hourlyUsd: priceFor(gpu, cloudType),
      preferredRank: preferred.indexOf(gpu.gpuTypeId)
    }))
    .sort((a, b) => {
      const aPref = a.preferredRank === -1 ? Infinity : a.preferredRank;
      const bPref = b.preferredRank === -1 ? Infinity : b.preferredRank;
      if (aPref !== bPref) return aPref - bPref;
      return a.hourlyUsd - b.hourlyUsd;
    });
}

function interleave(a, b) {
  const out = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

class GPUScheduler {
  constructor({ catalog = GPU_CATALOG } = {}) {
    this.catalog = catalog;
  }

  /**
   * @param {object} spec
   * @param {number} spec.vramGb               minimum VRAM required
   * @param {number} [spec.maxPricePerHr]      cap in USD/hr
   * @param {string} [spec.cloudPreference]    'SECURE' | 'COMMUNITY' | 'AUTO'
   * @param {string[]} [spec.preferredGpus]    ordered GPU type IDs to bias toward
   * @returns {Array<{gpuTypeId:string, cloudType:string, vramGb:number, hourlyUsd:number}>}
   */
  plan(spec = {}) {
    const vramGb = Number(spec.vramGb) || 0;
    const maxPricePerHr = spec.maxPricePerHr != null ? Number(spec.maxPricePerHr) : null;
    const cloudPreference = (spec.cloudPreference || 'SECURE').toUpperCase();
    if (!VALID_CLOUD_PREFERENCES.has(cloudPreference)) {
      throw new Error(`Invalid cloudPreference "${cloudPreference}" — expected SECURE, COMMUNITY, or AUTO`);
    }
    const preferredGpus = spec.preferredGpus || [];

    const baseArgs = { vramGb, maxPricePerHr, preferredGpus };

    if (cloudPreference === 'SECURE' || cloudPreference === 'COMMUNITY') {
      return rankCandidates(this.catalog, { ...baseArgs, cloudType: cloudPreference });
    }

    const secure = rankCandidates(this.catalog, { ...baseArgs, cloudType: 'SECURE' });
    const community = rankCandidates(this.catalog, { ...baseArgs, cloudType: 'COMMUNITY' });
    return interleave(secure, community);
  }

  /**
   * Convenience: returns just the gpuTypeIds in plan order, deduped.
   * RunPod's gpuTypeIds enum doesn't encode cloudType, so callers that need
   * to switch clouds across attempts should use plan() and group by cloudType.
   */
  planGpuTypeIds(spec = {}) {
    const seen = new Set();
    const out = [];
    for (const entry of this.plan(spec)) {
      if (!seen.has(entry.gpuTypeId)) {
        seen.add(entry.gpuTypeId);
        out.push(entry.gpuTypeId);
      }
    }
    return out;
  }
}

GPUScheduler.GPU_CATALOG = GPU_CATALOG;

module.exports = GPUScheduler;

if (require.main === module) {
  const scheduler = new GPUScheduler();

  const fmt = (entry) => `${entry.cloudType}/${entry.gpuTypeId} (${entry.vramGb}GB, $${entry.hourlyUsd}/hr)`;

  console.log('--- small workload, 16GB, SECURE ---');
  const small = scheduler.plan({ vramGb: 16, cloudPreference: 'SECURE' });
  small.forEach((e) => console.log('  ' + fmt(e)));
  console.assert(small[0].gpuTypeId === 'NVIDIA RTX A4000', 'expected cheapest 16GB GPU first');
  console.assert(small.every((e) => e.cloudType === 'SECURE'), 'expected SECURE only');

  console.log('\n--- large workload, 40GB, SECURE ---');
  const large = scheduler.plan({ vramGb: 40, cloudPreference: 'SECURE' });
  large.forEach((e) => console.log('  ' + fmt(e)));
  console.assert(large.length === 1 && large[0].gpuTypeId === 'NVIDIA RTX A6000', 'expected only 48GB GPU');
  console.assert(!large.some((e) => e.vramGb < 40), 'expected no sub-40GB GPUs');

  console.log('\n--- 24GB, COMMUNITY explicit ---');
  const community = scheduler.plan({ vramGb: 24, cloudPreference: 'COMMUNITY' });
  community.forEach((e) => console.log('  ' + fmt(e)));
  console.assert(community.every((e) => e.cloudType === 'COMMUNITY'), 'expected COMMUNITY only');

  console.log('\n--- 24GB, AUTO ---');
  const auto = scheduler.plan({ vramGb: 24, cloudPreference: 'AUTO' });
  auto.forEach((e) => console.log('  ' + fmt(e)));
  console.assert(auto[0].cloudType === 'SECURE', 'expected SECURE first in AUTO');
  console.assert(auto.some((e) => e.cloudType === 'COMMUNITY'), 'expected COMMUNITY in AUTO mix');
  const firstCommunityIdx = auto.findIndex((e) => e.cloudType === 'COMMUNITY');
  const firstSecureIdx = auto.findIndex((e) => e.cloudType === 'SECURE');
  console.assert(firstSecureIdx < firstCommunityIdx, 'expected SECURE before first COMMUNITY');

  console.log('\n--- 16GB, AUTO, maxPricePerHr=0.25 ---');
  const capped = scheduler.plan({ vramGb: 16, cloudPreference: 'AUTO', maxPricePerHr: 0.25 });
  capped.forEach((e) => console.log('  ' + fmt(e)));
  console.assert(capped.every((e) => e.hourlyUsd <= 0.25), 'expected all entries within price cap');

  console.log('\n--- 24GB, SECURE, preferredGpus=[RTX 4090] ---');
  const preferred = scheduler.plan({
    vramGb: 24,
    cloudPreference: 'SECURE',
    preferredGpus: ['NVIDIA GeForce RTX 4090']
  });
  preferred.forEach((e) => console.log('  ' + fmt(e)));
  console.assert(preferred[0].gpuTypeId === 'NVIDIA GeForce RTX 4090', 'expected preferred GPU first');

  console.log('\n--- planGpuTypeIds (24GB AUTO) ---');
  console.log('  ' + scheduler.planGpuTypeIds({ vramGb: 24, cloudPreference: 'AUTO' }).join(', '));

  console.log('\nall smoke assertions passed');
}
