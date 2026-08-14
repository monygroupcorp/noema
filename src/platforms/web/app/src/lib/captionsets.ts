// Captionset → training projection.
//
// A dataset's captions live on a captionset as `captions: Record<mediaId, string>` (sparse,
// keyed by media id — `types/dataset.ts#Captionset`). A training run takes a flat list of
// `{ url, caption }`. Turning one into the other is the only correctness-critical logic on
// this path, so it lives here as a pure function with its own gated test rather than inside a
// screen: a mis-binding here is invisible in the UI (every image still shows *a* caption) and
// only shows up in what the LoRA learned.
//
// Three rules, each of which the test suite pins:
//   1. captions are looked up BY MEDIA ID, never by position — `media` is append-only, so
//      positional pairing binds captions to the wrong images as soon as the two orders differ.
//   2. an image with no caption in the chosen captionset is DROPPED, not sent captionless — a
//      captionless entry reaches the trainer with no `.txt` sidecar and gets auto-captioned,
//      which discards the captionset the user chose. The caller reports the dropped count.
//   3. the CALLER'S captionset wins — never `captionsets[0]`.

import type { Dataset } from './api';
import type { DatasetImage } from './training';

/**
 * Project a dataset + a chosen captionset into the training image list.
 *
 * Media order is preserved. Media with no non-empty caption in that captionset is omitted, so
 * `dataset.media.length - result.length` is the dropped count a caller should surface before
 * spending. An unknown `captionsetId` yields an empty list (nothing is captioned by it).
 */
export function captionsToTrainingImages(dataset: Dataset, captionsetId: string): DatasetImage[] {
  const set = dataset.captionsets.find((cs) => cs.id === captionsetId);
  if (!set) return [];
  const captions = set.captions ?? {};
  const out: DatasetImage[] = [];
  for (const item of dataset.media) {
    const caption = captions[item.id];
    if (typeof caption !== 'string' || caption.trim() === '') continue;
    out.push({ url: item.url, caption });
  }
  return out;
}
