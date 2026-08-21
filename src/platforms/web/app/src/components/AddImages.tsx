import { useState, type ReactNode } from 'react';
import { api, type Dataset as DatasetT } from '../lib/api';
import { appendFailureNote, appendMediaRequest } from '../lib/muse';
import '../screens/muse.css';

// Add images to a dataset (noema-260, given a home on the dataset screen by noema-265).
//
// The panel is a component rather than a screen-local function because two surfaces
// render it: the moodboard (`/datasets/:id/muse`), where widening the SET is the second
// exit off a thin floor, and the dataset screen (`/datasets/:id`), which is the page a
// person opens to work on a set. It takes everything it needs as props, so both call
// sites hand it their own dataset and their own follow-on chain.
//
// The class names are the `muse-*` ones the panel was written against; the stylesheet is
// imported here so the panel carries its own appearance to whichever screen renders it.

/** One error, as short prose. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Upload one file to R2 through the signed-PUT path and return its permanent URL —
 *  the same two-step contract `Datasets.tsx` and `Profile.tsx` upload through, so there
 *  is one upload path in the app rather than a second one here. */
async function uploadImage(file: File): Promise<string> {
  const { signedUrl, permanentUrl } = await api.signUpload({ filename: file.name, contentType: file.type });
  const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return permanentUrl;
}

/** What one chosen file is doing, as words. A row that says nothing while a batch runs
 *  is a row the user cannot tell apart from a stuck one. */
const FILE_STATE: Record<string, string> = {
  waiting: 'waiting',
  uploading: 'uploading…',
  added: 'uploaded',
  failed: 'did not upload',
};

/**
 * Add images to a set (noema-260) — on the moodboard it is V7's second exit and the only
 * control there that writes to the DATASET rather than to the session; on the dataset
 * screen it is how the set itself is grown.
 *
 * Three properties it holds, each of them a rule rather than a preference:
 *
 *   AN EMPTY SELECTION FIRES NOTHING. No signature, no PUT, no append. An append of
 *   nothing would still mint a dataset version and recompute every pass' coverage over
 *   an unchanged set — a version recording that nothing happened.
 *
 *   A FILE THAT FAILS DOES NOT TAKE THE BATCH WITH IT. What uploaded is appended and
 *   what did not is named. Abandoning the whole batch on one failure loses the user's
 *   other files for no reason.
 *
 *   THE SET IS REBUILT FROM THE RESPONSE. The append returns the whole dataset — the
 *   new version, the new media, and every caption pass' recomputed coverage — and that
 *   is what the screen re-renders from. A locally patched copy would be a version
 *   behind and would show a coverage denominator that no longer exists.
 */
export function AddImages({
  dataset, open, onOpenChange, onAppended, next, title = 'add images to the moodboard',
}: {
  dataset: DatasetT;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAppended: (dataset: DatasetT) => void;
  next: ReactNode;
  /** What the disclosure row says. The panel names the surface it sits on: a moodboard on
   *  the muse screen, the set itself on the dataset screen. */
  title?: string;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const [states, setStates] = useState<Record<number, string>>({});
  const [appending, setAppending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function append() {
    if (appending) return;
    // The refusal is the pure one: `appendMediaRequest` returns null for an empty list,
    // and nothing is signed, uploaded or posted.
    if (appendMediaRequest(pending.map((f) => f.name)) === null) {
      setMsg({ ok: false, text: 'choose some images first' });
      return;
    }
    setAppending(true);
    setMsg(null);
    setStates(Object.fromEntries(pending.map((_, i) => [i, 'waiting'])));

    const uploaded: string[] = [];
    const failed: string[] = [];
    for (const [i, file] of pending.entries()) {
      setStates((st) => ({ ...st, [i]: 'uploading' }));
      try {
        uploaded.push(await uploadImage(file));
        setStates((st) => ({ ...st, [i]: 'added' }));
      } catch {
        failed.push(file.name);
        setStates((st) => ({ ...st, [i]: 'failed' }));
      }
    }

    const request = appendMediaRequest(uploaded);
    if (!request) {
      setMsg({ ok: false, text: appendFailureNote(failed) ?? 'nothing uploaded, so nothing was added' });
      setAppending(false);
      return;
    }
    try {
      const { dataset: updated } = await api.addDatasetMedia(dataset.id, request);
      onAppended(updated);
      setPending([]);
      const n = request.mediaUrls.length;
      const note = appendFailureNote(failed);
      setMsg({
        ok: true,
        text: `${n} ${n === 1 ? 'image' : 'images'} added — the set is now ${updated.media.length}`
          + (note ? ` · ${note}` : '')
          + '. captioning is the next step; nothing has been spent yet.',
      });
    } catch (e) {
      setMsg({ ok: false, text: `those images uploaded but weren't added to the set: ${errText(e)}` });
    } finally {
      setAppending(false);
    }
  }

  const label = pending.length === 0
    ? 'Add images — free'
    : `Add ${pending.length} ${pending.length === 1 ? 'image' : 'images'} — free`;

  return (
    <section className="muse-add-images">
      <details open={open} onToggle={(e) => onOpenChange((e.target as HTMLDetailsElement).open)}>
        <summary className="muse-manual-summary">{title}</summary>
        <div className="muse-add-images-body">
          <div className="gt-sub mono">
            Three steps, and only the first is free: the images join the set, a caption pass has to
            read the set, and a decompose is what turns those captions into fragments on the floor.
          </div>
          <div className="muse-add-images-row">
            <input
              type="file" accept="image/*" multiple disabled={appending}
              aria-label="images to add"
              onChange={(e) => { setPending(Array.from(e.target.files ?? [])); setStates({}); setMsg(null); }}
            />
            <button type="button" className="btn accent sm" disabled={appending || pending.length === 0}
              onClick={() => void append()}>
              {appending ? 'uploading…' : label}
            </button>
          </div>
          {pending.length > 0 && (
            <ul className="muse-add-files mono">
              {pending.map((f, i) => (
                <li key={`${i}:${f.name}`} className={`muse-add-file-row ${states[i] ?? 'waiting'}`}>
                  <span className="muse-add-file-name">{f.name}</span>
                  <span className="muse-add-file-state">{FILE_STATE[states[i] ?? 'waiting']}</span>
                </li>
              ))}
            </ul>
          )}
          {msg && <div className="gt-sub mono">{msg.text}</div>}
          {next}
        </div>
      </details>
    </section>
  );
}
