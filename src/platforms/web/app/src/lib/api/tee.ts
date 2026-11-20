import { j } from './core';
import { authHeaders, readHeaders } from './session';

// A TEE private session (POST/GET /v1/sessions/tee) — mirrors the backend TeeSessionView.
// `phase` is the live cold-start progress (Phasis taxonomy) while status='provisioning'.
export type TeePhase =
  | 'queued' | 'provisioning' | 'pulling' | 'attesting' | 'downloading' | 'installing'
  | 'loading' | 'warming' | 'executing' | 'uploading' | 'finalizing' | 'cancelling'
  | 'done' | 'failed';
export interface TeeSessionView {
  sessionId: string;
  status: 'provisioning' | 'ready' | 'ended';
  phase?: TeePhase;
  error?: string;
  serverPublicKey?: string;
  endpoint?: string;
  proxyUrl?: string;
  tunnelIp?: string;
  gpuHours?: number;
}

const teeApi = {
  // ── TEE private sessions — sealed compute over the caller's own tunnel ───────
  // The browser generates the WireGuard keypair; only the PUBLIC key goes up. Poll
  // GET until status='ready' (phase carries the live cold-start progress), then the
  // /tee WASM client drives the tunnel with the private key. DELETE ends the pod.
  provisionTee: (body: { wgClientPublicKey: string; gpuClass?: string; maxImpetus?: string }) =>
    fetch('/v1/sessions/tee', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ session: TeeSessionView }>),
  getTeeSession: (id: string) =>
    fetch(`/v1/sessions/tee/${encodeURIComponent(id)}`, { headers: readHeaders() }).then(j<{ session: TeeSessionView }>),
  endTeeSession: (id: string) =>
    fetch(`/v1/sessions/tee/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })
      .then((r) => { if (!r.ok && r.status !== 404) throw new Error(`end session failed: ${r.status}`); }),
};

export default teeApi;
