// The meter model — a user-visible projection of the runner's resource ledger, scoped to
// the standing compute you own (see docs/plans/2026-06-19-frontend-pathways-braindump.md §1).
//
// EARNED, not default: a meter only exists when you hold *standing* compute, not a one-off
// run. Standing state = a TEE session, a connected local host, or a pinned studio. A casual
// shared-compute run shows no meter — just results. (Studio/rented-standing is a third
// trigger; wire it when studio session state lands. Today it derives off the execution mode.)

import type { Execution, Ident } from './idents';
import { isPrivateExec } from './idents';

export interface WarmItem { id: string; name: string; vramGb: number; status: 'ready' | 'loading'; pinned?: boolean }
export interface StagedItem { id: string; name: string; size: string }   // client-piped fundamentum
export interface QueueItem { id: string; verb: string; needsGb: number; evicts?: string }

export interface MeterState {
  shown: boolean;
  locus: Execution;
  podLabel: string;        // "sealed pod · RTX 4090" / "your rig · RTX 4090"
  podCount: number;
  vramUsedGb: number;
  vramTotalGb: number;
  costLabel: string;       // metered $ or "no charge" for local
  metered: boolean;
  warm: WarmItem[];
  staged: StagedItem[];    // the privacy guarantee made visible — pipes in, we never read it
  queue: QueueItem[];
}

const EMPTY: MeterState = {
  shown: false, locus: 'rented', podLabel: '', podCount: 0,
  vramUsedGb: 0, vramTotalGb: 0, costLabel: '', metered: false,
  warm: [], staged: [], queue: [],
};

export function meterFor(execution: Execution, _ident: Ident): MeterState {
  if (!isPrivateExec(execution)) return EMPTY;   // shared compute → no meter, just results

  if (execution === 'tee') {
    return {
      shown: true, locus: 'tee', podLabel: 'sealed pod · RTX 4090', podCount: 1,
      vramUsedGb: 10.1, vramTotalGb: 24, costLabel: '$0.043 · 12 GPU-min', metered: true,
      warm: [
        { id: 'flux', name: 'flux-schnell', vramGb: 6.1, status: 'ready', pinned: true },
        { id: 'joy', name: 'joycaption', vramGb: 4.0, status: 'ready' },
      ],
      staged: [
        { id: 's1', name: 'dragon-ref.png', size: '2.1 MB' },
        { id: 's2', name: 'lora: neon-temple', size: '144 MB' },
      ],
      queue: [{ id: 'q1', verb: 'animate · ltx-video', needsGb: 9, evicts: 'joycaption' }],
    };
  }

  // local — your own GPU, outside pay-to-play: no charge, work never leaves the device
  return {
    shown: true, locus: 'local', podLabel: 'your rig · RTX 4090', podCount: 1,
    vramUsedGb: 9.2, vramTotalGb: 24, costLabel: 'on your GPU · no charge', metered: false,
    warm: [
      { id: 'flux', name: 'flux-schnell', vramGb: 6.1, status: 'ready', pinned: true },
      { id: 'hunyuan', name: 'hunyuan3d', vramGb: 3.1, status: 'ready' },
    ],
    staged: [
      { id: 's1', name: 'portrait-ref.png', size: '1.4 MB' },
      { id: 's2', name: 'lora: my-style', size: '156 MB' },
    ],
    queue: [{ id: 'q1', verb: 'make-3d · hunyuan', needsGb: 12, evicts: 'flux-schnell' }],
  };
}
