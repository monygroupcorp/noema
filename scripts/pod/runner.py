#!/usr/bin/env python3
"""
runner.py — persistent HTTP job server for a ComfyUI pod.

Accepts ComfyUI workflow jobs via HTTP, runs them against the local ComfyUI
instance, and fires a webhook when done. Runs on port 8080 alongside ComfyUI.
No SSH needed for job submission or polling — all communication is via
the RunPod HTTP proxy (https://{podId}-8080.proxy.runpod.net).

Usage (started by bootstrap during pod provisioning):
    RUNPOD_POD_ID=xxx python3 /root/runner.py
"""

import json
import logging
import os
import sys
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode

# ── Config ────────────────────────────────────────────────────────────────────

COMFYUI_URL = "http://localhost:8188"
PORT = int(os.environ.get("RUNNER_PORT", "8080"))
POD_ID = os.environ.get("RUNPOD_POD_ID", "")
COMFY_READY_TIMEOUT = int(os.environ.get("COMFY_READY_TIMEOUT", "300"))  # seconds
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "900"))  # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [runner] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("runner")

# ── State ─────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_job_queue: list = []
_current_job: dict | None = None
_job_results: dict = {}   # jobId → { status, output, error, executionTime }

# ── ComfyUI helpers ───────────────────────────────────────────────────────────

def _http_get(url: str, timeout: int = 5) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def _http_post(url: str, body: dict, timeout: int = 15) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _wait_for_comfy(timeout: int = COMFY_READY_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            data = _http_get(f"{COMFYUI_URL}/system_stats")
            if "system" in data:
                log.info("ComfyUI ready")
                return True
        except Exception:
            pass
        time.sleep(3)
    return False


def _submit_workflow(workflow: dict) -> str:
    result = _http_post(f"{COMFYUI_URL}/prompt", {"prompt": workflow})
    prompt_id = result.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI /prompt returned no prompt_id: {result}")
    return prompt_id


def _poll_history(prompt_id: str, timeout: int = JOB_TIMEOUT) -> dict:
    """Poll /history/{prompt_id} until status.completed is true."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            data = _http_get(f"{COMFYUI_URL}/history/{prompt_id}")
            entry = data.get(prompt_id, {})
            if entry.get("status", {}).get("completed"):
                return entry.get("outputs", {})
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"Job {prompt_id} did not complete within {timeout}s")


def _output_urls(outputs: dict) -> list[str]:
    """Build RunPod proxy view URLs from ComfyUI history outputs."""
    proxy_base = f"https://{POD_ID}-8188.proxy.runpod.net" if POD_ID else COMFYUI_URL
    urls = []
    for node in outputs.values():
        for kind in ("images", "gifs", "videos"):
            for item in node.get(kind, []):
                params = urlencode({
                    "filename": item["filename"],
                    "subfolder": item.get("subfolder", ""),
                    "type": "output",
                })
                urls.append(f"{proxy_base}/view?{params}")
    return urls

# ── Job processor ─────────────────────────────────────────────────────────────

def _send_webhook(webhook: str, payload: dict) -> None:
    try:
        _http_post(webhook, payload, timeout=15)
    except Exception as e:
        log.error(f"webhook delivery failed: {e}")
        # Retry once after 5s
        time.sleep(5)
        try:
            _http_post(webhook, payload, timeout=15)
        except Exception as e2:
            log.error(f"webhook retry also failed: {e2}")


def _process_job(job: dict) -> None:
    global _current_job
    job_id = job["jobId"]
    webhook = job.get("webhook")
    workflow = job["workflow"]
    start = time.time()

    log.info(f"starting job {job_id}")

    try:
        with _lock:
            _job_results[job_id] = {"status": "running"}

        prompt_id = _submit_workflow(workflow)
        log.info(f"job {job_id} queued in ComfyUI as {prompt_id}")

        outputs = _poll_history(prompt_id)
        urls = _output_urls(outputs)
        execution_time = int((time.time() - start) * 1000)

        log.info(f"job {job_id} done in {execution_time}ms, {len(urls)} output(s)")

        with _lock:
            _job_results[job_id] = {
                "status": "completed",
                "output": [{"url": u} for u in urls],
                "executionTime": execution_time,
            }

        if webhook:
            _send_webhook(webhook, {
                "id": job_id,
                "status": "COMPLETED",
                "output": [{"url": u} for u in urls],
                "executionTime": execution_time,
            })

    except Exception as e:
        log.error(f"job {job_id} failed: {e}")
        with _lock:
            _job_results[job_id] = {"status": "failed", "error": str(e)}
        if webhook:
            _send_webhook(webhook, {
                "id": job_id,
                "status": "FAILED",
                "error": str(e),
            })
    finally:
        # Clear current job and atomically pick up the next one — all under the
        # lock to prevent a concurrent POST handler from double-dequeuing.
        next_job = None
        with _lock:
            _current_job = None
            if _job_queue:
                next_job = _job_queue.pop(0)
                _current_job = next_job
        if next_job:
            threading.Thread(target=_process_job, args=(next_job,), daemon=True).start()


def _process_next() -> None:
    global _current_job
    next_job = None
    with _lock:
        if _current_job is not None or not _job_queue:
            return
        next_job = _job_queue.pop(0)
        _current_job = next_job
    if next_job:
        threading.Thread(target=_process_job, args=(next_job,), daemon=True).start()

# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default per-request logs

    def _send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            with _lock:
                status = "busy" if _current_job else "ready"
                queue_size = len(_job_queue)
            self._send_json(200, {
                "status": status,
                "queueSize": queue_size,
                "podId": POD_ID,
            })
        elif self.path.startswith("/job/"):
            job_id = self.path[5:]  # strip leading "/job/"
            with _lock:
                result = _job_results.get(job_id)
            if result is None:
                # Check if it's queued or running
                with _lock:
                    queued = any(j["jobId"] == job_id for j in _job_queue)
                    running = _current_job and _current_job.get("jobId") == job_id
                if queued or running:
                    self._send_json(200, {"status": "running"})
                else:
                    self._send_json(404, {"error": "job not found"})
            else:
                self._send_json(200, result)
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/job":
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length))
            except Exception:
                self._send_json(400, {"error": "invalid JSON"})
                return

            for field in ("jobId", "workflow"):
                if field not in body:
                    self._send_json(400, {"error": f"missing field: {field}"})
                    return

            with _lock:
                _job_queue.append(body)
                queue_pos = len(_job_queue)

            _process_next()

            self._send_json(202, {"jobId": body["jobId"], "queued": queue_pos})
            log.info(f"job {body['jobId']} enqueued (position {queue_pos})")
        else:
            self._send_json(404, {"error": "not found"})

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info(f"waiting for ComfyUI at {COMFYUI_URL} (up to {COMFY_READY_TIMEOUT}s)...")
    if not _wait_for_comfy():
        log.error("ComfyUI not ready, exiting")
        sys.exit(1)

    server = HTTPServer(("0.0.0.0", PORT), Handler)
    log.info(f"listening on :{PORT} (pod {POD_ID or 'unknown'})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
