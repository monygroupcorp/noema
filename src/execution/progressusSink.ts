import type { Progressus } from '../types/progressus.js'

/**
 * In-process status-recorder seam (spec §6a). The persistent recorder is
 * `CrystalApi.recordProgressus`, registered once at wireup (index.ts) — but the comfyrunner
 * SSE parse lives in the crystal rail, constructed before `CrystalApi` exists, so it reaches
 * the recorder through this ambient registration (mirrors the `bus` singleton). A Progressus
 * routed here is appended to the Actum's timeline (coalesced, §7) + emitted as a typed
 * `actum.progressus` event. This is the IN-PROCESS twin of the HTTP `/runner/status` sink
 * (`reportProgressus`): same persistence, but no legacy `actum.stage` shim — in-process
 * runners still emit the legacy stage vocabulary themselves (the consumers parse those exact
 * strings until build #6).
 *
 * No-op until registered, so unit tests that exercise the SSE parse in isolation need no sink.
 */
export type ProgressusRecorder = (actumId: string, progressus: Progressus) => Promise<void>

let recorder: ProgressusRecorder | undefined

export function registerProgressusRecorder(fn: ProgressusRecorder): void {
  recorder = fn
}

/** Route a Progressus to the registered recorder; silently no-ops if none is wired. */
export async function recordProgressus(actumId: string, progressus: Progressus): Promise<void> {
  await recorder?.(actumId, progressus)
}
