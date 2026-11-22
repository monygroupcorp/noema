#!/usr/bin/env python3
"""
Hermetic contract tests for comfyrunner.py — the pod-side ComfyUI runner.

No GPU, no ComfyUI, no network beyond loopback. Pins how the runner's outbound POSTs
identify themselves: the webhook URL sits behind an edge proxy that refuses urllib's
default "Python-urllib/3.x" signature (HTTP 403, "error code: 1010"), and a completion
refused there strands a run that rendered fine. So every POST must carry an explicit
User-Agent, and that is asserted on the wire, against a real local server.

Run:  python3 -m unittest test_comfyrunner   (from scripts/pod)
"""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comfyrunner as r  # noqa: E402


class _Recorder(BaseHTTPRequestHandler):
    received: list = []

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        type(self).received.append({"ua": self.headers.get("User-Agent"), "body": json.loads(body)})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *_):
        pass


class OutboundUserAgentTests(unittest.TestCase):
    def setUp(self):
        _Recorder.received = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Recorder)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/webhooks/runpod/nonce"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def _assert_named(self, ua):
        self.assertIsNotNone(ua)
        self.assertFalse(ua.startswith("Python-urllib"), f"urllib default signature sent: {ua}")
        self.assertEqual(ua, r.USER_AGENT)

    def test_completion_webhook_names_itself(self):
        err = r._send_webhook_fast(self.url, {"id": "job-1", "status": "COMPLETED", "output": []})
        self.assertIsNone(err)
        self.assertEqual(len(_Recorder.received), 1)
        self._assert_named(_Recorder.received[0]["ua"])
        self.assertEqual(_Recorder.received[0]["body"]["status"], "COMPLETED")

    def test_failure_webhook_names_itself(self):
        r._send_webhook(self.url, {"id": "job-2", "status": "FAILED", "error": "OOM"})
        self.assertEqual(len(_Recorder.received), 1)
        self._assert_named(_Recorder.received[0]["ua"])
        self.assertEqual(_Recorder.received[0]["body"]["status"], "FAILED")


if __name__ == "__main__":
    unittest.main()
