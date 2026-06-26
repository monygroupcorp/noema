// Provisioning policy — a standing preference on the cost ↔ capacity trade-off for how the
// user's runs get a GPU. A capacity FLOOR ("never give me 4090s, I want headroom") and a cost
// CEILING ("don't give me a $3.30/hr GPU, I'd rather wait") are the two ends of one control.
// Set on the Compute settings page; read by the quoter/provisioner (future) to pick a tier.

export interface GpuTier { id: string; name: string; vramGb: number; hourly: number }

// Illustrative catalogue (matches the user's mental anchors: ~$0.69 4090, $3.30 H100).
export const GPU_TIERS: GpuTier[] = [
  { id: '3090', name: 'RTX 3090', vramGb: 24, hourly: 0.44 },
  { id: '4090', name: 'RTX 4090', vramGb: 24, hourly: 0.69 },
  { id: 'a100', name: 'A100 80GB', vramGb: 80, hourly: 1.89 },
  { id: 'h100', name: 'H100 80GB', vramGb: 80, hourly: 3.30 },
];

export interface ComputePolicy {
  allowed: string[];                 // tier ids the user will let us provision
  lean: 'thrift' | 'headroom';       // when several allowed tiers fit a job
  maxHourly: number | null;          // spend ceiling $/hr (null = no cap)
  onBusy: 'wait' | 'fallback';       // preferred tier busy → wait for it, or take what's free
}

export const DEFAULT_POLICY: ComputePolicy = {
  allowed: GPU_TIERS.map((t) => t.id), lean: 'thrift', maxHourly: null, onBusy: 'fallback',
};

// Named starting points — they map onto the two dispositions the user described.
export const POLICY_PRESETS: { id: string; t: string; s: string; policy: ComputePolicy }[] = [
  { id: 'thrifty', t: 'Thrifty', s: 'Conserve credits — cap the price and wait rather than surge.',
    policy: { allowed: ['3090', '4090'], lean: 'thrift', maxHourly: 1, onBusy: 'wait' } },
  { id: 'balanced', t: 'Balanced', s: 'Any tier, cheapest that fits, take what’s available.',
    policy: { ...DEFAULT_POLICY } },
  { id: 'headroom', t: 'Headroom', s: 'Never bottleneck me — big GPUs only, room for parallel work.',
    policy: { allowed: ['a100', 'h100'], lean: 'headroom', maxHourly: null, onBusy: 'fallback' } },
];

const KEY = 'noema-compute-policy';

export function loadPolicy(): ComputePolicy {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v ? { ...DEFAULT_POLICY, ...v } : { ...DEFAULT_POLICY };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}
export function savePolicy(p: ComputePolicy): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

// Which preset (if any) the current policy matches — for highlighting.
export function matchedPreset(p: ComputePolicy): string | null {
  const eq = (a: ComputePolicy, b: ComputePolicy) =>
    a.lean === b.lean && a.maxHourly === b.maxHourly && a.onBusy === b.onBusy &&
    a.allowed.length === b.allowed.length && a.allowed.every((x) => b.allowed.includes(x));
  return POLICY_PRESETS.find((pre) => eq(p, pre.policy))?.id ?? null;
}
