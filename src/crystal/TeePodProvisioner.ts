// =============================================================================
// TeePodProvisioner — the provisioner contract behind /v1/sessions/tee.
// =============================================================================
//
// Two backends implement it:
//
//   TeeProvisioner        RunPod SECURE pod, RTX 4090 — cheap, fast cold start,
//                         single-tenant but NOT confidential compute.
//   ConfidentialPodClient Azure NCCads_H100_v5 CVM (SEV-SNP + H100 CC-On) —
//                         the hardware-sealed tier. Pure on-demand: allocate on
//                         session open, deallocate on session end.
//
// The entire CrystalApi TEE lifecycle (TeeSession map, ready callback, phase
// machine, billing) is written against this interface and is identical for both.
// =============================================================================

export interface TeeProvisionResult {
  podId: string
  /** USD/hr from the provider API — set as costPerHrUsd on the TeeSession for billing. */
  costPerHrUsd?: number
}

/** Browser-facing tunnel ingress for a ready pod. */
export interface TeeIngress {
  /** gost SOCKS5+WS(S) URL the browser WASM tunnel dials. */
  proxyUrl: string
  /** WireGuard UDP endpoint as seen through that proxy (ip:port). */
  endpoint: string
}

export interface TeePodProvisioner {
  /**
   * Boot (or allocate) a pod for the session. `onPodCreated` fires as soon as the
   * provider assigns an id — before the pod is running — so the session's podId is
   * set before the pod's /runner/ready callback can arrive.
   *
   * `runnerToken` is a per-session secret injected into the pod (env var / VM tag);
   * the runner echoes it on every platform callback and CrystalApi rejects
   * callbacks that don't carry it (hardware-path plan §"smaller hardening").
   */
  provision(
    sessionId: string,
    wgClientPublicKey: string,
    onPodCreated?: (podId: string) => void,
    runnerToken?: string,
  ): Promise<TeeProvisionResult>

  /**
   * Probe the WS upgrade path before the session is marked ready. RunPod-specific
   * (some hosts route through nginx that strips the Upgrade header); a backend that
   * owns its ingress returns true unconditionally.
   */
  probeWSUpgrade(podId: string): Promise<boolean>

  /** Kill the pod / deallocate the VM. Must be idempotent — sessions retry it. */
  terminate(podId: string): Promise<void>

  /**
   * The browser-facing tunnel ingress for this pod, or null when the runner's
   * self-reported endpoint should be used directly (local dev / community cloud).
   */
  ingress(podId: string): TeeIngress | null
}
