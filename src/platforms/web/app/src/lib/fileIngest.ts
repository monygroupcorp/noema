/**
 * Turning a paste, a drop or a folder choice into the same `File[]` the existing file-dialog
 * input already produces — the one shape `AddImages` and the create-dataset modal already
 * upload through `runBatch`/`uploadAsset`. Nothing downstream of this file needs to know which
 * of the four gestures supplied the list.
 */

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|tiff?)$/i;

/**
 * A directory entry dragged onto the page, or a file Chrome failed to sniff, carries no MIME
 * type — that is the ONE case the extension fallback exists for. A file whose `type` IS set and
 * is not `image/*` (a PDF, a `.DS_Store`, a sibling `.txt` sitting in the same folder) is never
 * reclassified by its name.
 */
export function isImageFile(file: File): boolean {
  if (file.type) return file.type.startsWith('image/');
  return IMAGE_EXT_RE.test(file.name);
}

/** Every image in a FileList (or array) — a folder's non-images left out, not errored. */
export function imagesFrom(files: FileList | File[]): File[] {
  return Array.from(files).filter(isImageFile);
}

/**
 * Image files pasted onto the page. A paste carries `kind: 'file'` items beside (or instead of)
 * any text — a screenshot tool or a copy from another app puts the image there, not on the
 * page's normal text clipboard. Non-file items are left alone so an ordinary text paste into a
 * nearby field is untouched.
 */
export function imagesFromClipboard(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (f && isImageFile(f)) files.push(f);
  }
  return files;
}

/**
 * Image files dropped onto the page. A dropped FOLDER arrives as one zero-size, typeless entry
 * in `dataTransfer.files` and is filtered out here same as any other non-image — walking a
 * folder's contents is the explicit folder picker's job (`webkitdirectory`), not drop's.
 */
export function imagesFromDrop(e: DragEvent): File[] {
  return imagesFrom(e.dataTransfer?.files ?? []);
}

/**
 * Appends `incoming` onto `held`, dropping anything already present by name+size+lastModified.
 * Three independent gestures (dialog, drop, paste, folder) can each hand back the same file —
 * dragging the same image twice, or pasting what was already picked in the dialog — and a
 * pending list that doubles it is a batch that uploads, and then dedupes, it twice for nothing.
 */
export function mergeFiles(held: readonly File[], incoming: readonly File[]): File[] {
  const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
  const seen = new Set(held.map(key));
  const merged = held.slice();
  for (const f of incoming) {
    const k = key(f);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(f);
  }
  return merged;
}
