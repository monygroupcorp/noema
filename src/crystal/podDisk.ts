// =============================================================================
// podDisk — how big the pod's writable disk has to be for a flow's weights
// =============================================================================
//
// Every pod was provisioned with a FLAT 40 GB container disk. That is fine for a
// 27 GB flux stack and silently fatal for anything larger: the weight fetch fills
// the disk and `wget` exits 3 (file I/O error) on whichever files were still in
// flight — reported as "model download failed", which reads like a mirror problem
// and is not. noema-372's first successful provision died exactly this way, with
// the three small weights landing and the 21 GB DiT and 27 GB text encoder failing.
//
// The requirement is DERIVED from the weight manifest rather than declared per
// substrate, because a declared number drifts the moment a weight is added and the
// failure it causes does not name the cause. `Intella.sizeGb` is already the single
// source for how big a weight is; this is just arithmetic over it.
// =============================================================================

/** What a pod gets when nothing says otherwise — RunPod's `containerDiskInGb`. */
export const DEFAULT_POD_DISK_GB = 40

/**
 * Room beyond the weights themselves: the ComfyUI checkout and its pip tree, the
 * runner, staged media inputs, and the rendered output before it is uploaded.
 * Measured generously — a pod that is 10 GB too big costs cents, a pod that is
 * 1 GB too small costs the whole run plus its provisioning time.
 */
export const POD_DISK_HEADROOM_GB = 15

/**
 * Disk a flow needs, in whole GB, rounded up to a 10 GB step so that a weight
 * changing by a few hundred MB does not churn the compiled spec's hash.
 */
export function podDiskGbFor(weightGb: number): number {
  const need = Math.ceil(weightGb) + POD_DISK_HEADROOM_GB
  return Math.max(DEFAULT_POD_DISK_GB, Math.ceil(need / 10) * 10)
}
