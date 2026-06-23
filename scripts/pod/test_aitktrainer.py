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

    def test_failed_carries_error(self):
        p = t.build_webhook_payload("pod-9", "FAILED", error="boom")
        self.assertEqual(p, {"id": "pod-9", "status": "FAILED", "error": "boom"})

    def test_lora_path_follows_aitoolkit_convention(self):
        self.assertEqual(t.lora_path("/aitk/output", "koh"), "/aitk/output/koh/koh.safetensors")


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
