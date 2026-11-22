import { api } from './api';
import { isHeicFile } from './fileIngest';

/**
 * How many uploads are allowed in flight at once.
 *
 * Not unbounded: a browser opens about six connections per host, so firing fifty PUTs at once
 * does not make fifty happen — it makes forty-four queue inside the browser where nothing can
 * report on them, and the first upload finishes no sooner. Four leaves room for the signing
 * calls that interleave with them.
 */
export const UPLOAD_CONCURRENCY = 4;

const HEIC_NAME_RE = /\.(heic|heif)$/i;

/**
 * A HEIC/HEIF straight off an iPhone, re-encoded to a JPEG `File` storage will actually sign.
 * The one place this runs: every upload path (dataset, moodboard, avatar/banner) calls
 * `uploadAsset`, so converting here covers all three without each needing its own copy of this.
 * `heic2any` is dynamically imported so a batch with no HEIC in it never pays for the library.
 */
async function toUploadableFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  const heic2any = (await import('heic2any')).default;
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return new File([blob], file.name.replace(HEIC_NAME_RE, '.jpg'), { type: 'image/jpeg' });
}

/** Upload one file through the signed-PUT path and return its permanent public URL. */
export async function uploadAsset(file: File): Promise<string> {
  const toSend = await toUploadableFile(file);
  const { signedUrl, permanentUrl } = await api.signUpload({ filename: toSend.name, contentType: toSend.type });
  const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': toSend.type }, body: toSend });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return permanentUrl;
}

export interface BatchResult<O> {
  /** What succeeded, in the order it was given — not the order it finished. */
  ok: O[];
  /** The index of each item that threw, in input order. */
  failedIndexes: number[];
  /** Why each of `failedIndexes` failed, in the same order — a caller naming a rejected file
   *  needs a reason beside it, not just the fact that it failed (D-62). */
  failureReasons: string[];
}

/**
 * Run `work` across `items` with a bounded number in flight, settling each one independently.
 *
 * The two upload paths in this app each had half of what this does. One ran a `for` loop with
 * an `await` inside, so fifty files went up one at a time and isolated their failures; the
 * other ran `Promise.all`, so they went up together and a single rejection threw away the
 * forty-nine that had worked. Neither is what a batch wants, and they were the same work.
 *
 * Results keep INPUT order. For a dataset that ordering is the media order, and it must not
 * depend on which upload happened to finish first.
 */
export async function runBatch<I, O>(
  items: readonly I[],
  work: (item: I, index: number) => Promise<O>,
  opts: { concurrency?: number; onState?: (index: number, state: 'running' | 'done' | 'failed') => void } = {},
): Promise<BatchResult<O>> {
  const limit = Math.max(1, Math.trunc(opts.concurrency ?? UPLOAD_CONCURRENCY));
  const done = new Array<{ ok: true; value: O } | { ok: false; reason: string }>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      opts.onState?.(i, 'running');
      try {
        done[i] = { ok: true, value: await work(items[i], i) };
        opts.onState?.(i, 'done');
      } catch (e) {
        // The rejection itself is kept (not swallowed) so the caller can name WHY, not just
        // that it failed — but it must not reject the pool, which would abandon whatever is
        // still in flight beside it, so each item still settles independently.
        done[i] = { ok: false, reason: e instanceof Error ? e.message : String(e) };
        opts.onState?.(i, 'failed');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  const ok: O[] = [];
  const failedIndexes: number[] = [];
  const failureReasons: string[] = [];
  done.forEach((r, i) => { if (r?.ok) ok.push(r.value); else { failedIndexes.push(i); failureReasons.push(r.reason); } });
  return { ok, failedIndexes, failureReasons };
}
