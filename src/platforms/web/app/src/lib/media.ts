// Extract renderable media from an Actum's exitus (its produced output). Mirrors the
// backend projector (src/execution/projectExitus.ts): media URLs land under the flow's
// declared Porta keys (image/video/audio/3d, then image2…), text under text/caption/….
// The feed and the run result both consume outputs this way, so keep them in sync.

export type MediaKind = 'image' | 'video' | 'audio' | '3d';

const VIDEO = /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i;
const AUDIO = /\.(mp3|wav|ogg|flac|m4a|aac)(\?|#|$)/i;
const MODEL3D = /\.(glb|gltf|obj|ply|stl|fbx)(\?|#|$)/i;

/** Best-guess media kind of an output URL, by extension. Defaults to image. */
export function urlMediaKind(url: string): MediaKind {
  if (VIDEO.test(url)) return 'video';
  if (AUDIO.test(url)) return 'audio';
  if (MODEL3D.test(url)) return '3d';
  return 'image';
}

export interface Media { url: string; kind: MediaKind }

const isUrl = (v: unknown): v is string =>
  typeof v === 'string' && /^(https?:)?\/\/|^\//.test(v);

// Prefer the declared media Porta keys; fall back to the first URL-ish value.
const MEDIA_KEYS = ['image', 'video', 'audio', '3d', 'mesh', 'url'];

/** The primary media output to render, or null if the output carries no media. */
export function mediaFromOutput(output?: Record<string, unknown> | null): Media | null {
  if (!output) return null;
  for (const k of MEDIA_KEYS) {
    const v = output[k];
    if (isUrl(v)) return { url: v, kind: urlMediaKind(v) };
  }
  for (const v of Object.values(output)) {
    if (isUrl(v)) return { url: v, kind: urlMediaKind(v) };
  }
  return null;
}

const TEXT_KEYS = ['text', 'caption', 'summary', 'summarium'];

/** A text output to show as a caption/body, or null. */
export function textFromOutput(output?: Record<string, unknown> | null): string | null {
  if (!output) return null;
  for (const k of TEXT_KEYS) {
    const v = output[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}
