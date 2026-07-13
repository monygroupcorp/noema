import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sseStream } from './api';

// noema-041: EventSource can't send auth headers, so authed SSE routes (`GET
// /v1/runs/:id/stream`) need a hand-rolled fetch + ReadableStream reader. Exercises the
// framing (multi-frame chunks, frames split across a chunk boundary) and the
// error-propagation path a caller falls back to polling on.

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sseStream — frame parsing', () => {
  it('parses multiple complete frames delivered in one chunk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      streamFromChunks(['data: {"kind":"snapshot"}\n\ndata: {"kind":"progress"}\n\n']),
      { status: 200 },
    )));

    const messages: string[] = [];
    const handle = sseStream('/v1/runs/r1/stream', {});
    handle.onmessage = (e) => messages.push(e.data);

    await vi.waitFor(() => expect(messages).toEqual([
      '{"kind":"snapshot"}',
      '{"kind":"progress"}',
    ]));
    handle.close();
  });

  it('reassembles a frame split across chunk boundaries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      streamFromChunks(['data: {"kind":"sna', 'pshot"}\n\n']),
      { status: 200 },
    )));

    const messages: string[] = [];
    const handle = sseStream('/v1/runs/r1/stream', {});
    handle.onmessage = (e) => messages.push(e.data);

    await vi.waitFor(() => expect(messages).toEqual(['{"kind":"snapshot"}']));
    handle.close();
  });

  it('surfaces onerror on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));

    let sawError = false;
    const handle = sseStream('/v1/runs/r1/stream', {});
    handle.onerror = () => { sawError = true; };

    await vi.waitFor(() => expect(sawError).toBe(true));
    handle.close();
  });

  it('close() before any error suppresses onerror (intentional teardown, not a failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamFromChunks([]), { status: 200 })));

    let sawError = false;
    const handle = sseStream('/v1/runs/r1/stream', {});
    handle.onerror = () => { sawError = true; };
    handle.close();

    // Let the stream's `done` path (or abort) resolve; either way no onerror.
    await new Promise((r) => setTimeout(r, 20));
    expect(sawError).toBe(false);
  });
});
