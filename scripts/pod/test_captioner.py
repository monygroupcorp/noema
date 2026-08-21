#!/usr/bin/env python3
"""
Hermetic contract tests for captioner.py — the pod-side caption pass.

No GPU, no network, no model weights. Pins the properties the host depends on:
  - the walk is the WHOLE manifest (a pass captions every media item, always);
  - the harvested map is `{media id: caption}` at the key the finalizer reads, and identity is
    echoed from the manifest rather than computed from a position;
  - the completion webhook payload (RunPodPayload: id/status/output[{url}]/executionTime);
  - a model that cannot load FAILS the run — no map is uploaded and no completion is reported.

Run:  python3 -m unittest test_captioner   (from scripts/pod)
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captioner as c  # noqa: E402


def _fake_fetch(url, dest):
    with open(dest, "wb") as f:
        f.write(b"img")


class ManifestTests(unittest.TestCase):
    def test_parses_url_and_id(self):
        m = c.parse_manifest('[{"url":"https://r2/a.png","id":"media-1"},{"url":"https://r2/b.jpg"}]')
        self.assertEqual(m, [{"url": "https://r2/a.png", "id": "media-1"}, {"url": "https://r2/b.jpg"}])

    def test_rejects_empty_and_urlless(self):
        self.assertRaises(ValueError, c.parse_manifest, "[]")
        self.assertRaises(ValueError, c.parse_manifest, '[{"id":"media-1"}]')

    def test_ext_from_url_defaults_png(self):
        self.assertEqual(c._ext_for("https://r2/a.JPG"), ".jpg")
        self.assertEqual(c._ext_for("https://r2/a.webp?x=1"), ".webp")
        self.assertEqual(c._ext_for("https://r2/noext"), ".png")
        self.assertEqual(c._ext_for("https://r2/a.svg"), ".png")   # unknown → png


class WholeSetWalkTests(unittest.TestCase):
    """A caption pass captions EVERYTHING it was handed. Partial coverage that still reports
    success would change what the run means and what it charges for."""

    def test_the_captioner_captions_every_media_item_in_the_manifest(self):
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(7)]
        seen = []

        def caption_one(path):
            seen.append(os.path.basename(path))
            return f"caption for {os.path.basename(path)}"

        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(manifest, d, caption_one, fetch=_fake_fetch)

        self.assertEqual(len(seen), len(manifest), "every manifest item is captioned")
        self.assertEqual(sorted(captions), sorted(m["id"] for m in manifest))
        self.assertEqual(uncollected, 0)

    def test_progress_is_reported_against_the_whole_set(self):
        manifest = [{"url": f"https://r2/{i}.png", "id": f"media-{i}"} for i in range(3)]
        ticks = []
        with tempfile.TemporaryDirectory() as d:
            c.caption_manifest(manifest, d, lambda p: "x", fetch=_fake_fetch,
                               on_progress=lambda done, total: ticks.append((done, total)))
        self.assertEqual(ticks, [(1, 3), (2, 3), (3, 3)])


class HarvestShapeTests(unittest.TestCase):
    """The map the pod uploads is the map the host finalizer validates — keyed by the media id
    the manifest carried, never by position."""

    def test_map_is_keyed_by_the_manifest_id(self):
        manifest = [{"url": "https://r2/a.png", "id": "media-b"}, {"url": "https://r2/b.png", "id": "media-a"}]
        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(
                manifest, d, lambda p: os.path.basename(p), fetch=_fake_fetch)
        self.assertEqual(captions, {"media-b": "0000.png", "media-a": "0001.png"})
        self.assertEqual(uncollected, 0)

    def test_an_item_with_no_id_is_omitted_and_counted(self):
        manifest = [{"url": "https://r2/a.png"}, {"url": "https://r2/b.png", "id": "media-1"}]
        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(manifest, d, lambda p: "a caption", fetch=_fake_fetch)
        self.assertEqual(captions, {"media-1": "a caption"})
        self.assertEqual(uncollected, 1, "no id is ever invented for an item")

    def test_an_item_that_produced_no_caption_is_omitted_and_counted(self):
        manifest = [{"url": "https://r2/a.png", "id": "media-1"}, {"url": "https://r2/b.png", "id": "media-2"}]

        def caption_one(path):
            return "  " if path.endswith("0000.png") else "a caption"

        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(manifest, d, caption_one, fetch=_fake_fetch)
        self.assertEqual(captions, {"media-2": "a caption"})
        self.assertEqual(uncollected, 1)

    def test_one_unreadable_item_does_not_cost_the_rest(self):
        manifest = [{"url": "https://r2/a.png", "id": "media-1"}, {"url": "https://r2/b.png", "id": "media-2"}]

        def fetch(url, dest):
            if url.endswith("a.png"):
                raise OSError("404")
            _fake_fetch(url, dest)

        with tempfile.TemporaryDirectory() as d:
            captions, uncollected = c.caption_manifest(manifest, d, lambda p: "a caption", fetch=fetch)
        self.assertEqual(captions, {"media-2": "a caption"})
        self.assertEqual(uncollected, 1)

    def test_caption_key_is_the_key_the_finalizer_reads(self):
        self.assertEqual(c.caption_key("job-1"), "captions/job-1/captions.json")


class WebhookTests(unittest.TestCase):
    def test_completed_carries_the_map_url_in_output_zero(self):
        p = c.build_webhook_payload("pod-9", "COMPLETED", captions_url="https://r2/pub/captions/job-1/captions.json",
                                    execution_time=1234)
        self.assertEqual(p, {"id": "pod-9", "status": "COMPLETED", "executionTime": 1234,
                             "output": [{"url": "https://r2/pub/captions/job-1/captions.json"}]})

    def test_failed_carries_the_error(self):
        p = c.build_webhook_payload("pod-9", "FAILED", error="model load failed")
        self.assertEqual(p, {"id": "pod-9", "status": "FAILED", "error": "model load failed"})

    def test_status_signal_counts_images(self):
        self.assertEqual(
            c.build_status_signal("act-1", 2, 5),
            {"actumId": "act-1",
             "progressus": {"phase": "executing", "progress": {"done": 2, "total": 5, "unit": "images"}}})


def _cfg(work_dir, manifest=None):
    return {
        "jobId": "job-1", "podId": "pod-9", "workDir": work_dir,
        "manifest": manifest or '[{"url":"https://r2/a.png","id":"media-1"}]',
        "model": "a-model", "prompt": "describe it", "maxNewTokens": 96,
        "actumId": "act-1", "statusUrl": "", "webhookUrl": "https://host/webhooks/execution",
        "r2": {"endpoint": "https://r2", "accessKeyId": "k", "secretAccessKey": "s",
               "bucket": "b", "publicUrl": "https://r2/pub"},
    }


class JobOrderingTests(unittest.TestCase):
    """The model loads BEFORE the walk and the map uploads only AFTER it. An empty-but-valid map
    would settle as a completed pass that captioned nothing."""

    def test_a_captioner_that_cannot_load_its_model_fails_the_run(self):
        uploads, hooks = [], []

        def loader(model, prompt, max_new_tokens):
            raise RuntimeError("could not load model weights")

        with tempfile.TemporaryDirectory() as d:
            rc = c.run_caption_job(
                _cfg(d), loader=loader, fetch=_fake_fetch,
                upload=lambda *a: uploads.append(a) or "https://r2/pub/x",
                send_webhook=lambda url, payload: hooks.append(payload),
                post_status=lambda url, sig: None)

        self.assertEqual(rc, 1)
        self.assertEqual(uploads, [], "nothing is uploaded when the model never loaded")
        self.assertEqual(len(hooks), 1)
        self.assertEqual(hooks[0]["status"], "FAILED")
        self.assertIn("could not load model weights", hooks[0]["error"])

    def test_a_completed_pass_uploads_the_map_then_reports_its_url(self):
        uploads, hooks = [], []

        def upload(r2, path, key):
            with open(path, encoding="utf-8") as f:
                uploads.append((key, json.load(f)))
            return f"https://r2/pub/{key}"

        with tempfile.TemporaryDirectory() as d:
            rc = c.run_caption_job(
                _cfg(d, '[{"url":"https://r2/a.png","id":"media-1"},{"url":"https://r2/b.png","id":"media-2"}]'),
                loader=lambda m, p, t: (lambda path: f"a caption for {os.path.basename(path)}"),
                fetch=_fake_fetch, upload=upload,
                send_webhook=lambda url, payload: hooks.append(payload),
                post_status=lambda url, sig: None)

        self.assertEqual(rc, 0)
        self.assertEqual(uploads[0][0], "captions/job-1/captions.json")
        self.assertEqual(uploads[0][1], {"media-1": "a caption for 0000.png",
                                         "media-2": "a caption for 0001.png"})
        self.assertEqual(hooks[0]["status"], "COMPLETED")
        self.assertEqual(hooks[0]["output"], [{"url": "https://r2/pub/captions/job-1/captions.json"}])

    def test_the_loader_is_handed_the_launcher_s_model_prompt_and_token_bound(self):
        seen = []
        with tempfile.TemporaryDirectory() as d:
            c.run_caption_job(
                _cfg(d),
                loader=lambda m, p, t: seen.append((m, p, t)) or (lambda path: "x"),
                fetch=_fake_fetch, upload=lambda *a: "https://r2/pub/x",
                send_webhook=lambda url, payload: None, post_status=lambda url, sig: None)
        self.assertEqual(seen, [("a-model", "describe it", 96)])


class ConfigFromEnvTests(unittest.TestCase):
    """Config transport is environment variables — the caption pod parses no toolkit config."""

    BASE = {
        "NOEMA_JOB_ID": "job-1", "NOEMA_MANIFEST_B64": "W3sidXJsIjoiaHR0cHM6Ly9yMi9hLnBuZyJ9XQ==",
        "NOEMA_WEBHOOK_URL": "https://host/webhooks/execution", "R2_ENDPOINT": "https://r2",
        "R2_ACCESS_KEY_ID": "k", "R2_SECRET_ACCESS_KEY": "s", "R2_BUCKET_NAME": "b",
    }

    def test_defaults_when_the_launcher_names_nothing(self):
        cfg = c.config_from_env(dict(self.BASE))
        self.assertEqual(cfg["manifest"], '[{"url":"https://r2/a.png"}]')
        self.assertEqual(cfg["model"], c.DEFAULT_MODEL)
        self.assertEqual(cfg["prompt"], c.DEFAULT_PROMPT)
        self.assertEqual(cfg["maxNewTokens"], c.DEFAULT_MAX_NEW_TOKENS)
        self.assertEqual(cfg["podId"], "job-1")   # no RUNPOD_POD_ID → the job id

    def test_launcher_values_win(self):
        env = dict(self.BASE, NOEMA_CAPTION_MODEL="some/vl-model", NOEMA_CAPTION_PROMPT="describe the subject",
                   NOEMA_CAPTION_MAX_NEW_TOKENS="96", RUNPOD_POD_ID="pod-9")
        cfg = c.config_from_env(env)
        self.assertEqual(cfg["model"], "some/vl-model")
        self.assertEqual(cfg["prompt"], "describe the subject")
        self.assertEqual(cfg["maxNewTokens"], 96)
        self.assertEqual(cfg["podId"], "pod-9")

    def test_missing_required_env_is_loud(self):
        for key in ("NOEMA_JOB_ID", "NOEMA_MANIFEST_B64", "NOEMA_WEBHOOK_URL", "R2_BUCKET_NAME"):
            env = dict(self.BASE)
            env.pop(key)
            with self.assertRaises(RuntimeError):
                c.config_from_env(env)


if __name__ == "__main__":
    unittest.main()
