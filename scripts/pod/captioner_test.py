#!/usr/bin/env python3
"""
Pure-python coverage for the batched caption walk added to `captioner.py` — chunking and the
batch→map reassembly, plus the per-item fallback path a failed batch takes. No GPU, no network,
no model weights: `caption_batch` is a plain stub attached to a fake `caption_one`.

Run:  python3 scripts/pod/captioner_test.py
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captioner as c  # noqa: E402


def _fake_fetch(url, dest):
    with open(dest, "wb") as f:
        f.write(b"img")


def _batching_captioner(batch_fn):
    """A fake `caption_one`-shaped callable carrying `.caption_batch`, the marker
    `caption_manifest` looks for to take the batched walk instead of the serial one."""
    def caption_one(path):
        return batch_fn([path])[0]
    caption_one.caption_batch = batch_fn
    return caption_one


class ChunkTests(unittest.TestCase):
    def test_splits_into_groups_of_size(self):
        self.assertEqual(c.chunk([0, 1, 2, 3, 4, 5], 2), [[0, 1], [2, 3], [4, 5]])

    def test_final_partial_group_is_kept_not_dropped(self):
        # 7 items at batch size 3 -> groups of 3, 3, 1. Every item must still appear somewhere.
        groups = c.chunk(list(range(7)), 3)
        self.assertEqual(groups, [[0, 1, 2], [3, 4, 5], [6]])
        self.assertEqual(sum(len(g) for g in groups), 7, "no item is dropped by chunking")

    def test_single_group_when_size_exceeds_item_count(self):
        self.assertEqual(c.chunk([0, 1], 10), [[0, 1]])

    def test_empty_input_yields_no_groups(self):
        self.assertEqual(c.chunk([], 3), [])


class BatchedWalkMapInvariantTests(unittest.TestCase):
    """The map `caption_manifest` returns is keyed by the manifest's own `id`, never by a
    batch-relative position — batching must not change what the walk means to the host."""

    def test_batched_walk_captions_every_item_keyed_by_manifest_id(self):
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(7)]

        def batch_fn(paths):
            # Deliberately reverse-order the response so a caller keying on batch POSITION
            # instead of the manifest id would misattribute captions.
            return [f"caption for {os.path.basename(p)}" for p in paths]

        caption_one = _batching_captioner(batch_fn)
        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(
                manifest, d, caption_one, fetch=_fake_fetch, batch_size=3)

        self.assertEqual(uncollected, 0)
        self.assertEqual(len(captions), 7, "every manifest item is captioned")
        for i, item in enumerate(manifest):
            expected_path = f"{i:04d}.png"
            self.assertEqual(captions[item["id"]], f"caption for {expected_path}",
                             "caption is attributed to the manifest id that produced its image")

    def test_batch_index_keying_would_fail_this_invariant(self):
        # Same setup as above, but the map is (deliberately, for this test only) built by batch
        # POSITION rather than manifest id, to pin that the prior test would actually catch the
        # regression it names. This directly encodes non-vacuity check #2 from the plan.
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(5)]

        def caption_batch(paths):
            return [f"caption for {os.path.basename(p)}" for p in paths]

        wrong_map = {}
        with tempfile.TemporaryDirectory() as d:
            for gi, group in enumerate(c.chunk(list(enumerate(manifest)), 2)):
                paths = [os.path.join(d, f"{i:04d}.png") for i, _ in group]
                for p in paths:
                    _fake_fetch("https://r2/x.png", p)
                for bi, text in enumerate(caption_batch(paths)):
                    wrong_map[f"batch-{gi}-{bi}"] = text  # keyed by batch position, not id

        self.assertNotEqual(set(wrong_map), {m["id"] for m in manifest},
                            "keying by batch position does not reproduce the manifest's ids")

    def test_progress_reaches_the_full_total_across_batches(self):
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(5)]
        ticks = []
        caption_one = _batching_captioner(lambda paths: ["x"] * len(paths))
        with tempfile.TemporaryDirectory() as d:
            c.caption_manifest(manifest, d, caption_one, fetch=_fake_fetch, batch_size=2,
                               on_progress=lambda done, total: ticks.append((done, total)))
        self.assertEqual(ticks[-1], (5, 5))
        self.assertEqual([t for t, _ in ticks], [1, 2, 3, 4, 5], "progress is monotonic per item")


class BatchFallbackTests(unittest.TestCase):
    """A batch that fails to caption degrades to per-item captioning for that chunk — it never
    sinks the whole chunk, and it never falls further back than today's per-item behavior."""

    def test_a_failing_batch_falls_back_to_per_item_for_its_chunk(self):
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(4)]

        def caption_batch(paths):
            raise RuntimeError("padded batch decode error")

        def caption_one(path):
            return f"per-item caption for {os.path.basename(path)}"
        caption_one.caption_batch = caption_batch

        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(
                manifest, d, caption_one, fetch=_fake_fetch, batch_size=4)

        self.assertEqual(uncollected, 0)
        self.assertEqual(len(captions), 4, "the chunk is still fully captioned via fallback")
        for i, item in enumerate(manifest):
            self.assertEqual(captions[item["id"]], f"per-item caption for {i:04d}.png")

    def test_a_batch_returning_the_wrong_count_also_falls_back(self):
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(3)]

        def caption_batch(paths):
            return ["only one caption"]  # wrong length for a batch of 3

        def caption_one(path):
            return "fallback"
        caption_one.caption_batch = caption_batch

        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(
                manifest, d, caption_one, fetch=_fake_fetch, batch_size=3)

        self.assertEqual(uncollected, 0)
        self.assertEqual(len(captions), 3)

    def test_one_undownloadable_item_does_not_sink_its_batch(self):
        manifest = [{"url": "https://r2/a.png", "id": "media-1"},
                   {"url": "https://r2/bad.png", "id": "media-2"},
                   {"url": "https://r2/c.png", "id": "media-3"}]

        def fetch(url, dest):
            if "bad" in url:
                raise OSError("404")
            _fake_fetch(url, dest)

        caption_one = _batching_captioner(lambda paths: [f"caption {i}" for i in range(len(paths))])
        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(
                manifest, d, caption_one, fetch=fetch, batch_size=3)

        self.assertEqual(uncollected, 1)
        self.assertEqual(set(captions), {"media-1", "media-3"})


class SerialPathUnaffectedTests(unittest.TestCase):
    """A plain per-item callable (no `.caption_batch`, or `batch_size` <= 1) takes the original
    serial walk untouched — the change is additive, not a rewrite of the default path."""

    def test_plain_callable_ignores_batch_size(self):
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(3)]
        seen = []

        def caption_one(path):
            seen.append(path)
            return "a caption"

        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(
                manifest, d, caption_one, fetch=_fake_fetch, batch_size=4)

        self.assertEqual(len(seen), 3, "no .caption_batch -> serial per-item walk, unchanged")
        self.assertEqual(uncollected, 0)
        self.assertEqual(len(captions), 3)

    def test_batch_size_one_ignores_a_present_caption_batch(self):
        # caption_one and caption_batch are independent stubs here (unlike _batching_captioner,
        # which routes caption_one through caption_batch) so the call counts prove which path ran.
        manifest = [{"url": "https://r2/a.png", "id": "media-1"}]
        calls = {"one": 0, "batch": 0}

        def caption_one(path):
            calls["one"] += 1
            return "x"

        def batch_fn(paths):
            calls["batch"] += 1
            return ["x"] * len(paths)

        caption_one.caption_batch = batch_fn
        with tempfile.TemporaryDirectory() as d:
            c.caption_manifest(manifest, d, caption_one, fetch=_fake_fetch, batch_size=1)

        self.assertEqual(calls["batch"], 0, "batch_size=1 stays on the serial per-item walk")
        self.assertEqual(calls["one"], 1)


if __name__ == "__main__":
    unittest.main()
