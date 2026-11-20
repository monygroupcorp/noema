import { j } from './core';
import { readHeaders } from './session';

// The account snapshot (GET /v1/me/status) — mirrors the backend StatusView.
// gens = ACTIVE gens (queued + running), not all-time history.
export interface GenEntry {
  actumId: string;
  modusLabel: string;
  // Impetus locked (held) against this run — a reservation, not a charge. Stringified
  // bigint, same convention as StudioEntry.netImpetus below.
  heldImpetus: string;
  studio: { id: string; hostLabel: string; isOwn: boolean } | null;
  status: 'nascens' | 'agens';
  elapsedMs?: number;
  etaMs?: number;
}
export interface StudioEntry {
  studioId: string;
  materiaId: string;
  label: string;
  status: 'idle' | 'running' | 'provisioning' | 'terminated' | 'draining';
  warmRemainingMs?: number;
  guestsToday: number;
  netImpetus: string; // bigint stringified by the backend
  netUsd: number;
}
export interface JoinableEntry { studioId: string; label: string; hostLabel: string; queueDepth: number }
export interface MeStatus {
  balanceImpetus: string;
  balanceUsd: number;
  // Impetus currently locked against the caller's own in-flight runs (sum of
  // gens[].heldImpetus) — a hold, not a charge. Not included in balanceImpetus.
  heldImpetus: string;
  heldUsd: number;
  gens: GenEntry[];
  studios: StudioEntry[];
  joinable: JoinableEntry[];
  takenAt: string;
}

const statusApi = {
  meStatus: () => fetch('/v1/me/status', { headers: readHeaders() }).then(j<MeStatus>),
};

export default statusApi;
