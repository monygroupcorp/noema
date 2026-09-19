import { api } from './api';

/**
 * How many uploads are allowed in flight at once.
 *
 * Not unbounded: a browser opens about six connections per host, so firing fifty PUTs at once
 * does not make fifty happen — it makes forty-four queue inside the browser where nothing can
 * report on them, and the first upload finishes no sooner. Four leaves room for the signing
 * calls that interleave with them.
 */
export const UPLOAD_CONCURRENCY = 4;

/** Upload one file through the signed-PUT path and return its permanent public URL. */
export async function uploadAsset(file: File): Promise<string> {
  const { signedUrl, permanentUrl } = await api.signUpload({ filename: file.name, contentType: file.type });
  const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return permanentUrl;
}

export interface BatchResult<O> {
  /** What succeeded, in the order it was given — not the order it finished. */
  ok: O[];
  /** The index of each item that threw, in input order. */
  failedIndexes: number[];
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
  const done = new Array<{ ok: true; value: O } | { ok: false }>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      opts.onState?.(i, 'running');
      try {
        done[i] = { ok: true, value: await work(items[i], i) };
        opts.onState?.(i, 'done');
      } catch {
        // Swallowed on purpose: one item's failure is reported through `failedIndexes` and must
        // not reject the pool, which would abandon whatever is still in flight beside it.
        done[i] = { ok: false };
        opts.onState?.(i, 'failed');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  const ok: O[] = [];
  const failedIndexes: number[] = [];
  done.forEach((r, i) => { if (r?.ok) ok.push(r.value); else failedIndexes.push(i); });
  return { ok, failedIndexes };
}
