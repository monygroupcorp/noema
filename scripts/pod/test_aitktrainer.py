#!/usr/bin/env python3
"""
Hermetic contract tests for aitktrainer.py — the pod-side LoRA trainer.

No GPU, no network, no ai-toolkit. Pins the WIRE CONTRACT the host depends on:
  - the /runner/status Progressus signal (phase/unit/terminal) the bulletin renders;
  - the completion webhook payload (RunPodPayload: id/status/output[{url}]/executionTime);
  - manifest parsing → image + NNN.txt caption sidecars ai-toolkit pairs by basename;
  - the SQLite Job-row seed/read round-trip (same schema as the host SqliteAitkJobStore).
A drift in any of these silently strands a remote run, so they are bound here.

Run:  python3 -m unittest test_aitktrainer   (from scripts/pod)
"""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aitktrainer as t  # noqa: E402


class ManifestTests(unittest.TestCase):
    def test_parses_url_and_caption(self):
        m = t.parse_manifest('[{"url":"https://r2/a.png","caption":"a koh"},{"url":"https://r2/b.jpg"}]')
        self.assertEqual(m, [{"url": "https://r2/a.png", "caption": "a koh"}, {"url": "https://r2/b.jpg"}])

    def test_blank_caption_dropped(self):
        m = t.parse_manifest('[{"url":"https://r2/a.png","caption":"   "}]')
        self.assertEqual(m, [{"url": "https://r2/a.png"}])

    def test_rejects_empty_and_urlless(self):
        self.assertRaises(ValueError, t.parse_manifest, "[]")
        self.assertRaises(ValueError, t.parse_manifest, '[{"caption":"no url"}]')

    def test_ext_from_url_defaults_png(self):
        self.assertEqual(t._ext_for("https://r2/a.JPG"), ".jpg")
        self.assertEqual(t._ext_for("https://r2/a.webp?x=1"), ".webp")
        self.assertEqual(t._ext_for("https://r2/noext"), ".png")
        self.assertEqual(t._ext_for("https://r2/a.svg"), ".png")   # unknown → png


class StageDatasetTests(unittest.TestCase):
    def test_writes_images_and_caption_sidecars_paired_by_basename(self):
        fetched = []
        def fake_fetch(url, dest):
            fetched.append((url, dest))
            with open(dest, "wb") as f:
                f.write(b"img")
        with tempfile.TemporaryDirectory() as d:
            n = t.stage_dataset(
                [{"url": "https://r2/a.png", "caption": "a koh man"}, {"url": "https://r2/b.jpg"}],
                d, fetch=fake_fetch)
            self.assertEqual(n, 2)
            # image 0000 + its caption; image 0001 with NO caption file.
            self.assertTrue(os.path.exists(os.path.join(d, "0000.png")))
            with open(os.path.join(d, "0000.txt")) as f:
                self.assertEqual(f.read(), "a koh man")
            self.assertTrue(os.path.exists(os.path.join(d, "0001.jpg")))
            self.assertFalse(os.path.exists(os.path.join(d, "0001.txt")))
        self.assertEqual([u for u, _ in fetched], ["https://r2/a.png", "https://r2/b.jpg"])


class CaptionGapTests(unittest.TestCase):
    def test_count_uncaptioned_counts_images_without_a_txt_sidecar(self):
        with tempfile.TemporaryDirectory() as d:
            # 0000 has a caption; 0001/0002 don't; notes.txt is not an image.
            for name, body in [("0000.png", b"i"), ("0000.txt", b"c"), ("0001.png", b"i"),
                               ("0002.jpg", b"i"), ("notes.txt", b"x")]:
                with open(os.path.join(d, name), "wb") as f:
                    f.write(body)
            self.assertEqual(t.count_uncaptioned(d), 2)

    def test_count_uncaptioned_zero_when_all_captioned_or_empty(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "a.png"), "wb") as f: f.write(b"i")
            with open(os.path.join(d, "a.txt"), "wb") as f: f.write(b"c")
            self.assertEqual(t.count_uncaptioned(d), 0)
        with tempfile.TemporaryDirectory() as d2:
            self.assertEqual(t.count_uncaptioned(d2), 0)


class StatusSignalTests(unittest.TestCase):
    def test_running_is_executing_on_steps_with_total(self):
        sig = t.build_status_signal("act-1", {"status": "running", "step": 30, "info": "Training"}, cfg_steps=250)
        self.assertEqual(sig["actumId"], "act-1")
        self.assertEqual(sig["progressus"]["phase"], "executing")
        self.assertEqual(sig["progressus"]["progress"], {"done": 30, "total": 250, "unit": "steps"})

    def test_running_without_cfg_steps_omits_total(self):
        sig = t.build_status_signal("act-1", {"status": "running", "step": 5}, cfg_steps=None)
        self.assertEqual(sig["progressus"]["progress"], {"done": 5, "unit": "steps"})

    def test_completed_is_terminal_done(self):
        self.assertEqual(t.build_status_signal("a", {"status": "completed", "step": 250})["progressus"],
                         {"phase": "done"})

    def test_error_is_terminal_failed_with_message(self):
        prog = t.build_status_signal("a", {"status": "error", "step": 5, "info": "CUDA OOM"})["progressus"]
        self.assertEqual(prog["phase"], "failed")
        self.assertEqual(prog["message"], "CUDA OOM")

    def test_queued_maps_to_queued(self):
        self.assertEqual(t.build_status_signal("a", {"status": "queued", "step": 0})["progressus"]["phase"], "queued")


class WebhookPayloadTests(unittest.TestCase):
    def test_completed_carries_lora_url_and_time(self):
        p = t.build_webhook_payload("pod-9", "COMPLETED", lora_url="https://cdn/x.safetensors", execution_time=12345)
        self.assertEqual(p, {"id": "pod-9", "status": "COMPLETED",
                             "output": [{"url": "https://cdn/x.safetensors"}], "executionTime": 12345})

    def test_samples_ride_output_tagged_kind_sample(self):
        p = t.build_webhook_payload("pod-9", "COMPLETED", lora_url="https://cdn/x.safetensors",
                                    execution_time=10, sample_urls=["https://cdn/s0.jpg", "https://cdn/s1.jpg"])
        self.assertEqual(p["output"], [
            {"url": "https://cdn/x.safetensors"},
            {"url": "https://cdn/s0.jpg", "kind": "sample"},
            {"url": "https://cdn/s1.jpg", "kind": "sample"},
        ])

    def test_failed_carries_error(self):
        p = t.build_webhook_payload("pod-9", "FAILED", error="boom")
        self.assertEqual(p, {"id": "pod-9", "status": "FAILED", "error": "boom"})

    def test_lora_path_follows_aitoolkit_convention(self):
        self.assertEqual(t.lora_path("/aitk/output", "koh"), "/aitk/output/koh/koh.safetensors")


class SamplePathsTests(unittest.TestCase):
    def test_lists_sorted_sample_images_only(self):
        import os, tempfile
        with tempfile.TemporaryDirectory() as d:
            sdir = os.path.join(d, "koh", "samples")
            os.makedirs(sdir)
            for n in ["1.jpg", "0.png", "notes.txt"]:
                open(os.path.join(sdir, n), "w").close()
            paths = t.sample_paths(d, "koh")
            self.assertEqual([os.path.basename(p) for p in paths], ["0.png", "1.jpg"])

    def test_missing_samples_dir_returns_empty(self):
        self.assertEqual(t.sample_paths("/nonexistent", "koh"), [])


class LatestCheckpointTests(unittest.TestCase):
    def test_picks_highest_step_checkpoint(self):
        import os, tempfile
        with tempfile.TemporaryDirectory() as d:
            jdir = os.path.join(d, "koh")
            os.makedirs(jdir)
            for n in ["koh_000000250.safetensors", "koh_000000500.safetensors", "koh.safetensors", "koh_notanum.safetensors"]:
                open(os.path.join(jdir, n), "w").close()
            path, step = t.latest_checkpoint(d, "koh")
            self.assertEqual(step, 500)
            self.assertTrue(path.endswith("koh_000000500.safetensors"))

    def test_no_checkpoints_returns_none_zero(self):
        self.assertEqual(t.latest_checkpoint("/nonexistent", "koh"), (None, 0))


class JobRowTests(unittest.TestCase):
    def test_seed_then_read_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            db = os.path.join(d, "aitk_db.db")
            t.seed_job_row(db, "koh", gpu_ids="0")
            row = t.read_job_row(db, "koh")
            self.assertEqual(row["status"], "queued")
            self.assertEqual(row["step"], 0)
            # the trainer updates the row by name; reading reflects the live row.
            conn = sqlite3.connect(db)
            conn.execute("UPDATE Job SET status='running', step=42, info='Training' WHERE id='koh'")
            conn.commit(); conn.close()
            self.assertEqual(t.read_job_row(db, "koh"),
                             {"status": "running", "step": 42, "info": "Training", "speed_string": ""})

    def test_read_missing_row_is_empty(self):
        with tempfile.TemporaryDirectory() as d:
            db = os.path.join(d, "aitk_db.db")
            t.seed_job_row(db, "koh")
            self.assertEqual(t.read_job_row(db, "nope"), {})


class ManifestIdTests(unittest.TestCase):
    def test_id_passes_through_when_present(self):
        m = t.parse_manifest('[{"url":"https://r2/a.png","id":"media-1"},{"url":"https://r2/b.jpg"}]')
        self.assertEqual(m, [{"url": "https://r2/a.png", "id": "media-1"}, {"url": "https://r2/b.jpg"}])

    def test_non_string_or_absent_id_is_simply_absent(self):
        # An id-less manifest is the TRAINING path and must stay valid input, not an error.
        m = t.parse_manifest('[{"url":"https://r2/a.png","id":7}]')
        self.assertEqual(m, [{"url": "https://r2/a.png"}])


class HarvestTests(unittest.TestCase):
    """The caption harvest is keyed by the id the manifest carried, never by position.

    Staged files are named by manifest INDEX, and the host's media list is append-only, so an
    index resolved back to a media item after the run can land on a different item. These pin
    that the map the host receives is keyed by identity and that nothing is invented for an
    item that has no id or no caption.
    """

    def _dir(self, files):
        d = tempfile.mkdtemp()
        for name, body in files.items():
            with open(os.path.join(d, name), "w", encoding="utf-8") as f:
                f.write(body)
        return d

    def test_harvest_keys_captions_by_media_id(self):
        d = self._dir({"0000.txt": "the first image\n", "0001.txt": "the second image"})
        manifest = [{"url": "https://r2/a.png", "id": "media-1"}, {"url": "https://r2/b.png", "id": "media-2"}]
        captions, missing = t.harvest_captions(manifest, d)
        self.assertEqual(captions, {"media-1": "the first image", "media-2": "the second image"})
        self.assertEqual(missing, 0)

    def test_a_reordered_manifest_moves_the_caption_with_the_id(self):
        # Same sidecars on disk; the manifest order is swapped. A positional harvest would bind
        # 0000.txt to media-1 either way — an id-keyed one follows the id.
        d = self._dir({"0000.txt": "the first image", "0001.txt": "the second image"})
        manifest = [{"url": "https://r2/b.png", "id": "media-2"}, {"url": "https://r2/a.png", "id": "media-1"}]
        captions, _ = t.harvest_captions(manifest, d)
        self.assertEqual(captions, {"media-2": "the first image", "media-1": "the second image"})

    def test_missing_sidecar_is_omitted_and_counted(self):
        d = self._dir({"0000.txt": "only the first"})
        manifest = [{"url": "https://r2/a.png", "id": "media-1"}, {"url": "https://r2/b.png", "id": "media-2"}]
        captions, missing = t.harvest_captions(manifest, d)
        self.assertEqual(captions, {"media-1": "only the first"})
        self.assertEqual(missing, 1)

    def test_missing_id_is_omitted_and_counted_never_invented(self):
        d = self._dir({"0000.txt": "text with no owner"})
        captions, missing = t.harvest_captions([{"url": "https://r2/a.png"}], d)
        self.assertEqual(captions, {})
        self.assertEqual(missing, 1)

    def test_blank_sidecar_is_omitted_and_counted(self):
        d = self._dir({"0000.txt": "   \n"})
        captions, missing = t.harvest_captions([{"url": "https://r2/a.png", "id": "media-1"}], d)
        self.assertEqual(captions, {})
        self.assertEqual(missing, 1)

    def test_caption_key_mirrors_the_training_key_shape(self):
        self.assertEqual(t.caption_key("job-1"), "captions/job-1/captions.json")


class JobModeTests(unittest.TestCase):
    """Mode dispatch reads one env var, and an ABSENT value is today's behaviour."""

    def _mode(self, value=None):
        # Mirrors main()'s single read of NOEMA_JOB_MODE.
        prev = os.environ.pop("NOEMA_JOB_MODE", None)
        try:
            if value is not None:
                os.environ["NOEMA_JOB_MODE"] = value
            return (t._env("NOEMA_JOB_MODE", "train") or "train").strip().lower()
        finally:
            os.environ.pop("NOEMA_JOB_MODE", None)
            if prev is not None:
                os.environ["NOEMA_JOB_MODE"] = prev

    def test_absent_mode_is_train(self):
        self.assertEqual(self._mode(), "train")

    def test_empty_mode_is_train(self):
        self.assertEqual(self._mode(""), "train")

    def test_caption_mode_is_recognised_case_and_space_insensitively(self):
        self.assertEqual(self._mode("caption"), "caption")
        self.assertEqual(self._mode(" Caption "), "caption")

    def test_an_unknown_mode_is_not_caption(self):
        self.assertNotEqual(self._mode("something-else"), "caption")


class CaptionWebhookTests(unittest.TestCase):
    def test_caption_completion_rides_the_same_payload_shape(self):
        p = t.build_webhook_payload("pod-1", "COMPLETED",
                                    lora_url="https://r2.example/captions/job-1/captions.json",
                                    execution_time=1234)
        self.assertEqual(p, {"id": "pod-1", "status": "COMPLETED",
                             "output": [{"url": "https://r2.example/captions/job-1/captions.json"}],
                             "executionTime": 1234})


if __name__ == "__main__":
    unittest.main(verbosity=2)
