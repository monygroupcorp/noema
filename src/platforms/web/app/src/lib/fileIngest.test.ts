import { describe, expect, it } from 'vitest';
import { imagesFrom, imagesFromClipboard, imagesFromDrop, isImageFile, mergeFiles } from './fileIngest';

const file = (name: string, type: string, lastModified = 1) =>
  new File(['x'], name, { type, lastModified });

describe('isImageFile — one filter for drop, paste and a folder walk (dataset-ingest-is-starved)', () => {
  it('passes a typed image file', () => {
    expect(isImageFile(file('a.png', 'image/png'))).toBe(true);
  });

  it('rejects a typed non-image file', () => {
    expect(isImageFile(file('notes.txt', 'text/plain'))).toBe(false);
  });

  it('falls back to the extension when the browser sniffed no type at all', () => {
    expect(isImageFile(file('scan.jpg', ''))).toBe(true);
    expect(isImageFile(file('readme.md', ''))).toBe(false);
  });

  it('never reclassifies a file by name when a non-image type IS set', () => {
    // A `.png` that is actually served as an octet-stream stays whatever it is typed as — the
    // extension fallback exists only for the untyped case (a dropped directory entry, a sniff
    // miss), never to override a type the platform already reported.
    expect(isImageFile(file('fake.png', 'application/octet-stream'))).toBe(false);
  });
});

describe('imagesFrom — a folder\'s non-images are left out, not errored', () => {
  it('keeps only the images, in order, from a mixed list', () => {
    const list = [file('a.png', 'image/png'), file('notes.txt', 'text/plain'), file('b.jpg', 'image/jpeg')];
    expect(imagesFrom(list).map((f) => f.name)).toEqual(['a.png', 'b.jpg']);
  });

  it('is empty for a folder with no images, not a thrown error', () => {
    expect(imagesFrom([file('readme.md', ''), file('notes.txt', 'text/plain')])).toEqual([]);
  });
});

describe('imagesFromClipboard — a pasted screenshot, not a pasted word', () => {
  it('pulls the file item out and leaves a plain text paste alone', () => {
    const img = file('shot.png', 'image/png');
    const e = {
      clipboardData: {
        items: [
          { kind: 'string', getAsFile: () => null },
          { kind: 'file', getAsFile: () => img },
        ],
      },
    } as unknown as ClipboardEvent;
    expect(imagesFromClipboard(e).map((f) => f.name)).toEqual(['shot.png']);
  });

  it('is empty when the clipboard carries no file item at all', () => {
    const e = { clipboardData: { items: [{ kind: 'string', getAsFile: () => null }] } } as unknown as ClipboardEvent;
    expect(imagesFromClipboard(e)).toEqual([]);
  });

  it('is empty, not a throw, when the event carries no clipboardData', () => {
    expect(imagesFromClipboard({} as ClipboardEvent)).toEqual([]);
  });
});

describe('imagesFromDrop — a dropped folder is skipped quietly, not walked', () => {
  it('keeps the dropped images', () => {
    const e = { dataTransfer: { files: [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg')] } } as unknown as DragEvent;
    expect(imagesFromDrop(e).map((f) => f.name)).toEqual(['a.png', 'b.jpg']);
  });

  it('drops a directory entry\'s zero-size, typeless File like any other non-image', () => {
    const dir = file('photos', '', 1);
    const e = { dataTransfer: { files: [dir, file('a.png', 'image/png')] } } as unknown as DragEvent;
    expect(imagesFromDrop(e).map((f) => f.name)).toEqual(['a.png']);
  });
});

describe('mergeFiles — the same image offered twice does not land twice', () => {
  it('appends new files after the ones already held', () => {
    const held = [file('a.png', 'image/png')];
    const next = mergeFiles(held, [file('b.png', 'image/png')]);
    expect(next.map((f) => f.name)).toEqual(['a.png', 'b.png']);
  });

  it('drops an incoming file identical to one already held', () => {
    const a = file('a.png', 'image/png', 100);
    const heldAgain = new File(['x'], 'a.png', { type: 'image/png', lastModified: 100 });
    expect(mergeFiles([a], [heldAgain]).map((f) => f.name)).toEqual(['a.png']);
  });

  it('keeps two files that share a name but not a size or mtime', () => {
    const a = new File(['x'], 'a.png', { type: 'image/png', lastModified: 100 });
    const b = new File(['xy'], 'a.png', { type: 'image/png', lastModified: 200 });
    expect(mergeFiles([a], [b])).toHaveLength(2);
  });

  it('does nothing, successfully, for an empty incoming list', () => {
    const held = [file('a.png', 'image/png')];
    expect(mergeFiles(held, [])).toEqual(held);
  });
});
