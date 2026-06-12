#!/usr/bin/env python3
"""
Hermetic tests for runner.py — the VRAM-budget harness manager + executor seam (ADR-0007).

No GPU, no network, no servers. FakeHarness stands in for a runtime so we exercise:
  - the PURE scheduler decision (_pick_next_runnable): residency, fit, LRU eviction, busy-waits,
    shortest-expected ordering, aging, concurrency-capability;
  - _run_job delivery (text inline / file→R2 / file→proxy / failure→webhook) + eviction/load;
  - the preserved pure bits (registry sharing, vLLM request shaping, ComfyUI output mapping).

Run:  python3 -m unittest test_runner   (from scripts/pod)  or  python3 -m unittest scripts.pod.test_runner
"""

import os
import sys
import unittest

os.environ.setdefault("RUNNER_VRAM_GB", "24")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner  # noqa: E402


class FakeHarness(runner.Executor):
    def __init__(self, rt, vram, ewma):
        super().__init__()
        self.runtime = rt
        self.vram_gb = vram
        self.ewma_ms = ewma
        self.outputs = [{"kind": "text", "text": "ok"}]
        self.fail = False
        self.load_calls = 0
        self.unload_calls = 0

    def model_root(self): return "/tmp/fake"
    def is_present(self, m): return True
    def fetch_one(self, m, j): pass
    def load(self, spec, jid): self.load_calls += 1
    def run(self, spec, jid):
        if self.fail:
            raise RuntimeError("boom")
        return self.outputs
    def unload(self): self.unload_calls += 1


def _install(*harnesses):
    """Replace the global registry/harness-list with fakes (keyed by runtime)."""
    runner.EXECUTORS = {h.runtime: h for h in harnesses}
    runner._HARNESSES = list(harnesses)


def _reset():
    runner._jobs.clear()
    runner._wait.clear()


def _enqueue(job_id, runtime, *, enqueued=None, spec=None):
    runner._jobs[job_id] = {"jobId": job_id, "status": "queued", "events": [], "result": None,
                            "runtime": runtime, "enqueued": enqueued if enqueued is not None else runner._now_ms(),
                            "spec": spec or {"jobId": job_id, "runtime": runtime}}
    runner._wait.append(job_id)


# ─────────────────────────────────────────────────────────────────────────────
# Scheduler decision — _pick_next_runnable (pure, no threads)
# ─────────────────────────────────────────────────────────────────────────────

class SchedulerDecisionTests(unittest.TestCase):
    def setUp(self):
        self._saved = (runner.EXECUTORS, runner._HARNESSES)
        _reset()

    def tearDown(self):
        runner.EXECUTORS, runner._HARNESSES = self._saved
        _reset()

    def test_resident_idle_runs_without_loading(self):
        v = FakeHarness("vLLM", 20, 30_000); v.state = "loaded"
        _install(v)
        _enqueue("j1", "vLLM")
        pick = runner._pick_next_runnable()
        self.assertEqual((pick[0], pick[1], pick[2], pick[3]), ("j1", v, [], False))

    def test_unloaded_but_fits_loads(self):
        v = FakeHarness("vLLM", 20, 30_000)  # state unloaded; budget 24
        _install(v)
        _enqueue("j1", "vLLM")
        pick = runner._pick_next_runnable()
        self.assertEqual((pick[1], pick[2], pick[3]), (v, [], True))

    def test_evicts_idle_lru_to_fit(self):
        a = FakeHarness("ComfyUI", 20, 480_000); a.state = "loaded"; a.last_used = 100  # older → LRU victim
        b = FakeHarness("vLLM", 20, 30_000)                                              # wants in; budget 24
        _install(a, b)
        _enqueue("j1", "vLLM")
        pick = runner._pick_next_runnable()
        self.assertEqual(pick[1], b)
        self.assertEqual(pick[2], [a])   # A evicted to make room
        self.assertTrue(pick[3])

    def test_cannot_evict_busy_harness_job_waits(self):
        a = FakeHarness("ComfyUI", 20, 480_000); a.state = "loaded"; a.busy = True   # busy → not evictable
        b = FakeHarness("vLLM", 20, 30_000)
        _install(a, b)
        _enqueue("j1", "vLLM")   # needs 20, only 4 free, can't evict busy A
        self.assertIsNone(runner._pick_next_runnable())

    def test_shortest_expected_first(self):
        c = FakeHarness("ComfyUI", 10, 480_000); c.state = "loaded"
        v = FakeHarness("vLLM", 10, 30_000); v.state = "loaded"   # both resident, both fit
        _install(c, v)
        _enqueue("slow", "ComfyUI")
        _enqueue("fast", "vLLM")
        pick = runner._pick_next_runnable()
        self.assertEqual(pick[0], "fast")   # vLLM (30s) flies past ComfyUI (8min)

    def test_aging_lets_a_starved_long_job_overtake(self):
        c = FakeHarness("ComfyUI", 10, 480_000); c.state = "loaded"
        v = FakeHarness("vLLM", 10, 30_000); v.state = "loaded"
        _install(c, v)
        now = runner._now_ms()
        _enqueue("slow", "ComfyUI", enqueued=now - 600_000)   # waited 600s → priority 480000-600000 < 0
        _enqueue("fast", "vLLM", enqueued=now)                 # fresh → priority 30000
        pick = runner._pick_next_runnable()
        self.assertEqual(pick[0], "slow")   # aging beats raw shortest-job-first

    def test_concurrency_two_idle_harnesses_both_runnable(self):
        c = FakeHarness("ComfyUI", 10, 480_000); c.state = "loaded"
        v = FakeHarness("vLLM", 10, 30_000); v.state = "loaded"
        _install(c, v)
        _enqueue("slow", "ComfyUI")
        _enqueue("fast", "vLLM")
        # first pick = fast (vLLM); simulate committing it (busy), then the slow job is STILL runnable
        p1 = runner._pick_next_runnable()
        self.assertEqual(p1[0], "fast")
        v.busy = True; runner._wait.remove("fast")
        p2 = runner._pick_next_runnable()
        self.assertEqual(p2[0], "slow")   # different harness → runs concurrently

    def test_unknown_runtime_is_skipped(self):
        v = FakeHarness("vLLM", 10, 30_000); v.state = "loaded"
        _install(v)
        _enqueue("j1", "nope")
        self.assertIsNone(runner._pick_next_runnable())


class VramAccountingTests(unittest.TestCase):
    def setUp(self):
        self._saved = (runner.EXECUTORS, runner._HARNESSES)

    def tearDown(self):
        runner.EXECUTORS, runner._HARNESSES = self._saved

    def test_reserved_vram_counts_loaded_and_loading(self):
        a = FakeHarness("ComfyUI", 16, 1); a.state = "loaded"
        b = FakeHarness("vLLM", 20, 1); b.state = "loading"
        c = FakeHarness("x", 5, 1); c.state = "unloaded"
        _install(a, b, c)
        self.assertEqual(runner._reserved_vram(), 36)
        self.assertEqual(runner._reserved_vram(exclude=b), 16)

    def test_idle_lru_to_free_picks_oldest_first_and_skips_busy(self):
        a = FakeHarness("a", 8, 1); a.state = "loaded"; a.last_used = 300
        b = FakeHarness("b", 8, 1); b.state = "loaded"; b.last_used = 100   # oldest
        busy = FakeHarness("c", 8, 1); busy.state = "loaded"; busy.busy = True
        target = FakeHarness("t", 8, 1)
        _install(a, b, busy, target)
        picked = runner._idle_lru_to_free(8, exclude=target)
        self.assertEqual(picked, [b])                       # oldest, just enough
        self.assertIsNone(runner._idle_lru_to_free(100, exclude=target))   # busy can't be freed → impossible


# ─────────────────────────────────────────────────────────────────────────────
# _run_job — delivery + lifecycle (call directly; _wait empty so the trailing _schedule is a no-op)
# ─────────────────────────────────────────────────────────────────────────────

class RunJobTests(unittest.TestCase):
    def setUp(self):
        self._saved = (runner.EXECUTORS, runner._HARNESSES, runner._send_webhook, runner._upload_to_r2)
        _reset()
        self._sent = []
        runner._send_webhook = lambda url, payload: self._sent.append(payload)

    def tearDown(self):
        runner.EXECUTORS, runner._HARNESSES, runner._send_webhook, runner._upload_to_r2 = self._saved
        _reset()

    def _seed(self, job_id, spec):
        runner._jobs[job_id] = {"jobId": job_id, "status": "running", "events": [], "result": None,
                                "runtime": spec.get("runtime", "vLLM"), "enqueued": runner._now_ms(), "spec": spec}

    def test_text_output_inline(self):
        ex = FakeHarness("vLLM", 20, 30_000); ex.state = "loaded"; ex.busy = True
        self._seed("j1", {"jobId": "j1"})
        runner._run_job("j1", ex, [], False)
        self.assertEqual(runner._jobs["j1"]["status"], "completed")
        self.assertEqual(runner._jobs["j1"]["result"]["output"], [{"kind": "text", "text": "ok"}])
        self.assertFalse(ex.busy)   # released in finally

    def test_file_output_with_r2_uploads(self):
        ex = FakeHarness("ComfyUI", 16, 480_000); ex.state = "loaded"; ex.busy = True
        ex.outputs = [{"kind": "image", "path": "/out/cat.png"}]
        up = []
        runner._upload_to_r2 = lambda r2, p: (up.append(p) or {"url": f"https://cdn/{os.path.basename(p)}"})
        self._seed("j2", {"jobId": "j2", "r2": {"bucket": "b"}})
        runner._run_job("j2", ex, [], False)
        self.assertEqual(up, ["/out/cat.png"])
        self.assertEqual(runner._jobs["j2"]["result"]["output"][0], {"kind": "image", "url": "https://cdn/cat.png"})

    def test_file_output_without_r2_proxy(self):
        ex = FakeHarness("ComfyUI", 16, 480_000); ex.state = "loaded"; ex.busy = True
        ex.outputs = [{"kind": "image", "path": "/out/cat.png"}]
        self._seed("j3", {"jobId": "j3"})
        runner._run_job("j3", ex, [], False)
        item = runner._jobs["j3"]["result"]["output"][0]
        self.assertIn("proxyUrl", item)
        self.assertEqual(item["kind"], "image")

    def test_failure_marks_failed_and_webhooks(self):
        ex = FakeHarness("vLLM", 20, 30_000); ex.state = "loaded"; ex.busy = True; ex.fail = True
        self._seed("j4", {"jobId": "j4", "webhook": "http://hook"})
        runner._run_job("j4", ex, [], False)
        self.assertEqual(runner._jobs["j4"]["status"], "failed")
        self.assertIn("boom", runner._jobs["j4"]["result"]["error"])
        self.assertEqual(self._sent[-1]["status"], "FAILED")
        self.assertFalse(ex.busy)

    def test_evicts_then_loads(self):
        victim = FakeHarness("ComfyUI", 16, 480_000); victim.state = "unloading"
        ex = FakeHarness("vLLM", 20, 30_000); ex.state = "loading"; ex.busy = True
        _install(victim, ex)
        self._seed("j5", {"jobId": "j5"})
        runner._run_job("j5", ex, [victim], True)
        self.assertEqual(victim.unload_calls, 1)            # evicted
        self.assertEqual(victim.state, "unloaded")
        self.assertGreaterEqual(ex.load_calls, 1)           # loaded
        self.assertEqual(ex.state, "loaded")
        self.assertEqual(runner._jobs["j5"]["status"], "completed")


# ─────────────────────────────────────────────────────────────────────────────
# Preserved pure bits
# ─────────────────────────────────────────────────────────────────────────────

class RegistryTests(unittest.TestCase):
    def test_registry_shares_harnesses_by_runtime(self):
        registry, unique = runner._build_harnesses()
        self.assertIs(registry["vLLM"], registry["llm"])              # vLLM/llm = one harness
        self.assertIs(registry["sglang"], registry["transformers"])  # sglang/transformers = one harness
        self.assertEqual(len(unique), 4)                              # comfy, vllm, sglang, modelcard
        self.assertIsInstance(registry["ComfyUI"], runner.ComfyUIExecutor)
        self.assertIsInstance(registry["vLLM"], runner.VllmExecutor)
        self.assertIsInstance(registry["sglang"], runner.SGLangExecutor)
        self.assertIsInstance(registry["python-modelcard"], runner.PythonModelcardExecutor)
        # both serving executors share the OpenAI-compatible base
        self.assertIsInstance(registry["vLLM"], runner.OpenAIServerExecutor)
        self.assertIsInstance(registry["sglang"], runner.OpenAIServerExecutor)


class ServeCmdTests(unittest.TestCase):
    def test_vllm_serve_cmd(self):
        ex = runner.VllmExecutor()
        cmd = ex._serve_cmd("/m/qwen")
        self.assertEqual(cmd[:3], ["vllm", "serve", "/m/qwen"])
        self.assertIn("--gpu-memory-utilization", cmd)
        self.assertIn("--max-model-len", cmd)
        self.assertEqual(ex._serve_env().get("VLLM_USE_DEEP_GEMM"), "0")

    def test_sglang_serve_cmd_has_trust_remote_code(self):
        ex = runner.SGLangExecutor()
        cmd = ex._serve_cmd("/m/moss")
        self.assertIn("sglang.launch_server", cmd)
        self.assertIn("--trust-remote-code", cmd)        # the whole point — loads MOSS's custom arch
        self.assertIn("--model-path", cmd)
        self.assertIn("/m/moss", cmd)
        self.assertIn("--mem-fraction-static", cmd)

    def test_both_share_the_openai_run_path(self):
        # SGLang inherits run() from the base — same /v1/chat/completions request as vLLM
        self.assertEqual(runner.SGLangExecutor.run, runner.OpenAIServerExecutor.run)
        self.assertEqual(runner.VllmExecutor.run, runner.OpenAIServerExecutor.run)


class VllmRequestShapeTests(unittest.TestCase):
    def setUp(self):
        self._orig = runner._http_post
        self.captured = {}
        def _fake_post(url, body, timeout=15):
            self.captured["url"], self.captured["body"] = url, body
            return {"choices": [{"message": {"content": "the answer"}}]}
        runner._http_post = _fake_post

    def tearDown(self):
        runner._http_post = self._orig

    def test_chat_request_shape(self):
        ex = runner.VllmExecutor()
        runner._jobs["jv"] = {"events": []}
        out = ex.run({"inference": {"systemPrompt": "You are a cinematographer.", "prompt": "shot size?",
                                    "media": [{"type": "image", "ref": "r2://f.png"}],
                                    "genParams": {"max_tokens": 256, "temperature": 0.2, "top_p": 0.9}}}, "jv")
        self.assertEqual(out, [{"kind": "text", "text": "the answer"}])
        body = self.captured["body"]
        self.assertEqual(body["max_tokens"], 256)
        self.assertEqual(body["top_p"], 0.9)
        self.assertEqual(body["messages"][0], {"role": "system", "content": "You are a cinematographer."})
        self.assertIn({"type": "image_url", "image_url": {"url": "r2://f.png"}}, body["messages"][1]["content"])


class ComfyOutputMappingTests(unittest.TestCase):
    def test_images_gifs_videos_map_to_kinds(self):
        ex = runner.ComfyUIExecutor()
        outputs = {"9": {"images": [{"filename": "a.png", "subfolder": ""}]},
                   "10": {"gifs": [{"filename": "b.gif", "subfolder": "sub"}]},
                   "11": {"videos": [{"filename": "c.mp4", "subfolder": ""}]}}
        mapped = sorted((m["kind"], os.path.basename(m["path"])) for m in ex._output_paths(outputs))
        self.assertEqual(mapped, [("image", "a.png"), ("video", "b.gif"), ("video", "c.mp4")])


if __name__ == "__main__":
    unittest.main(verbosity=2)
