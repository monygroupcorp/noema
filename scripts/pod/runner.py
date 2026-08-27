#!/usr/bin/env python3
"""
runner.py — multi-harness job server for RunPod SECURE pods (ADR-0007).

The runtime-INVARIANT shell: an HTTP job server, parallel model download (per-dest locks,
progress), R2 upload, completion webhooks, an SSE event stream — AND a VRAM-budget harness
manager. The runner holds an `Executor` per runtime (ComfyUI, vLLM) and runs as many harnesses
as fit in the pod's VRAM at once, dispatching each job to its runtime's harness. The
runtime-SPECIFIC half lives behind the `Executor` interface; the shell never changes per runtime.

The manager (this is the whole of it):
    ensure_resident(harness): evict idle (loaded, not busy) harnesses LRU-to-fit, then load.
    jobs run against whatever's resident → concurrency across distinct harnesses falls out for free.
    a busy harness is never evicted → its waiters queue.
    the wait queue is ordered shortest-expected-first WITH aging, so a fast vLLM request flies past
    a long ComfyUI job without starving it. Durations are an EWMA seeded with priors (a hint, not a
    guarantee). All bounded by VRAM reality — it reorders/biases, it can't run what doesn't fit.

Successor to comfyrunner.py. While the live gen path still ships comfyrunner.py, runner.py is
verified alongside; the SSH-bootstrap cutover (SecurePodClient) is a separate, deliberate step.

Endpoints (shell contract, stable):
  GET  /health              — runner/pod status (+ resident harnesses)
  POST /job                 — enqueue a job (body carries `runtime` + its form: workflow|inference)
  GET  /job/<id>            — poll job status
  GET  /job/<id>/stream     — SSE stream of job events
  POST /install             — download-only model apply for a runtime (no run)

Started by bootstrap:
  RUNPOD_POD_ID=xxx RUNNER_VRAM_GB=24 python3 /root/runner.py
"""

import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── Config (shell) ───────────────────────────────────────────────────────────

PORT           = int(os.environ.get("RUNNER_PORT", "8080"))
POD_ID         = os.environ.get("RUNPOD_POD_ID", "")
JOB_TIMEOUT    = int(os.environ.get("JOB_TIMEOUT", "900"))
VRAM_BUDGET_GB = float(os.environ.get("RUNNER_VRAM_GB", "24"))   # pod's usable VRAM (minus headroom)
# Aging weight: priority = expected_ms − waited_ms × AGING. 1.0 = a job that has waited as long as
# its own expected runtime draws even with a fresh job of that length. Higher = more anti-starvation.
AGING          = float(os.environ.get("RUNNER_AGING_WEIGHT", "1.0"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [runner] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("runner")

# ── Shell state ────────────────────────────────────────────────────────────────

_lock = threading.Lock()

# jobId → { status, events[], result, runtime, enqueued }  status: queued|running|completed|failed
_jobs: dict = {}
_wait: list = []           # jobIds waiting for a slot (ordered by the scheduler, not insertion)

def _now_ms() -> float:
    return time.time() * 1000.0

# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _http_get(url: str, timeout: int = 5) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def _http_post(url: str, body: dict, timeout: int = 15) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {e.code} from {url}: {detail}") from e


def _append_event(job_id: str, event: dict) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        event["seq"] = len(job["events"])
        job["events"].append(event)

# ─────────────────────────────────────────────────────────────────────────────
# Executor interface (the runtime-specific half — ADR-0007)
# ─────────────────────────────────────────────────────────────────────────────

class Executor:
    """One runtime's harness. The manager owns residency; the executor owns its subprocess + how a
    job runs on it. State machine: 'unloaded' → 'loading' → 'loaded' → 'unloading' → 'unloaded'.
    `busy` marks an in-flight job (a busy harness is never evicted). `vram_gb` is the reservation
    it holds while loaded (declared conservatively on PEAK working memory).

    load(job_spec, job_id):  bring the harness to a serving state for THIS job (start subprocess,
                             download models in the runtime-correct order). Idempotent when serving.
    run(job_spec, job_id):   execute the job on the loaded harness → kind-tagged outputs.
    unload():                stop the subprocess, free VRAM."""

    runtime: str = "abstract"
    default_ewma_ms: float = 60_000.0

    def __init__(self) -> None:
        self.state = "unloaded"     # unloaded | loading | loaded | unloading
        self.busy = False
        self.vram_gb = 0.0
        self.ewma_ms = self.default_ewma_ms
        self.last_used = 0.0        # ms — for LRU eviction

    # residency
    def is_loaded(self) -> bool:
        return self.state == "loaded"

    # lifecycle — overridden by concrete executors
    def model_root(self) -> str:
        raise NotImplementedError

    def is_present(self, model: dict) -> bool:
        raise NotImplementedError

    def fetch_one(self, model: dict, job_id: str) -> None:
        raise NotImplementedError

    def load(self, job_spec: dict, job_id: str) -> None:
        raise NotImplementedError

    def run(self, job_spec: dict, job_id: str) -> list[dict]:
        raise NotImplementedError

    def unload(self) -> None:
        raise NotImplementedError

    def model_path(self, dest: str) -> str:
        return os.path.join(self.model_root(), dest)

    def record_duration(self, ms: float) -> None:
        # EWMA, alpha 0.3 — a few real jobs pull it off the prior quickly.
        self.ewma_ms = 0.7 * self.ewma_ms + 0.3 * ms

# ── Shared model download (shell) ────────────────────────────────────────────

_DEST_LOCKS_GUARD = threading.Lock()
_DEST_LOCKS: dict = {}


def _dest_lock(dest: str) -> threading.Lock:
    with _DEST_LOCKS_GUARD:
        lk = _DEST_LOCKS.get(dest)
        if lk is None:
            lk = threading.Lock()
            _DEST_LOCKS[dest] = lk
        return lk


def _download_model(executor: Executor, model: dict, job_id: str) -> "str | None":
    """Download one model via the executor's fetch_one, serialized per-dest. Re-checks presence
    inside the lock. Returns an error string, or None on success."""
    with _dest_lock(model["dest"]):
        if executor.is_present(model):
            return None
        t0 = time.time()
        _append_event(job_id, {"type": "downloading", "dest": model["dest"], "total": model.get("sizeBytes", 0)})
        try:
            executor.fetch_one(model, job_id)
            _append_event(job_id, {"type": "downloaded", "dest": model["dest"], "elapsedMs": int((time.time() - t0) * 1000)})
            return None
        except Exception as e:
            return f"{model['dest']}: {e}"


def _ensure_models(executor: Executor, models: list, job_id: str) -> None:
    """Download missing weights in parallel (per-dest locks, periodic progress). Raises on failure."""
    if not models:
        return
    missing = [m for m in models if not executor.is_present(m)]
    present = len(models) - len(missing)
    _append_event(job_id, {"type": "preflight-models", "missing": len(missing), "present": present, "total": len(models)})
    if not missing:
        _append_event(job_id, {"type": "models-ready", "downloaded": 0, "reused": present})
        return

    errors: list = []
    dl_start = time.time()
    total_bytes = sum(m.get("sizeBytes", 0) for m in missing)
    stop_progress = threading.Event()

    def _download(model: dict) -> None:
        err = _download_model(executor, model, job_id)
        if err:
            errors.append(err)

    def _progress_emitter() -> None:
        while not stop_progress.wait(15):
            done = 0
            for m in missing:
                try:
                    done += os.path.getsize(executor.model_path(m["dest"]))
                except OSError:
                    pass
            _append_event(job_id, {"type": "download-progress", "bytesDownloaded": done,
                                   "bytesTotal": total_bytes, "elapsedMs": int((time.time() - dl_start) * 1000)})

    pe = threading.Thread(target=_progress_emitter, daemon=True)
    pe.start()
    threads = [threading.Thread(target=_download, args=(m,), daemon=True) for m in missing]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    stop_progress.set()

    if errors:
        raise RuntimeError(f"model download failed: {'; '.join(errors)}")
    _append_event(job_id, {"type": "models-ready", "downloaded": len(missing), "reused": present})


def _install_models(executor: Executor, models: list) -> dict:
    """Download-only apply (no run). Idempotent. Shares the per-dest lock with jobs."""
    if not models:
        return {"modelsDownloaded": 0, "modelsReused": 0, "downloadMs": 0, "downloadBytes": 0}
    missing = [m for m in models if not executor.is_present(m)]
    reused = len(models) - len(missing)
    t0 = time.time()
    errors: list = []

    def _dl(model: dict) -> None:
        err = _download_model(executor, model, "live-install")
        if err:
            errors.append(err)

    threads = [threading.Thread(target=_dl, args=(m,), daemon=True) for m in missing]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise RuntimeError(f"install failed: {'; '.join(errors)}")
    return {"modelsDownloaded": len(missing), "modelsReused": reused,
            "downloadMs": int((time.time() - t0) * 1000), "downloadBytes": sum(m.get("sizeBytes", 0) for m in missing)}

# ── R2 upload + webhook (shell) ───────────────────────────────────────────────

_CONTENT_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif",
    "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime",
    "mp3": "audio/mpeg", "wav": "audio/wav", "flac": "audio/flac", "ogg": "audio/ogg",
    "glb": "model/gltf-binary", "gltf": "model/gltf+json", "obj": "text/plain",
}


def _r2_key(r2: dict, filename: str, ext: str) -> str:
    """The object key for one upload.

    Default: the public `outputs/<epoch_ms>-<filename>` naming. When the job body carries a
    `keyPrefix` (an owner-scoped namespace), the object is named `<prefix><uuid>.<ext>` instead
    — the original filename is not part of the key, so the path leaks nothing about the run.
    """
    prefix = r2.get("keyPrefix")
    if prefix:
        suffix = f".{ext}" if ext else ""
        return f"{prefix}{uuid.uuid4()}{suffix}"
    return f"outputs/{int(time.time() * 1000)}-{filename}"


def _r2_result(r2: dict, key: str) -> dict:
    """What we hand back for one uploaded object.

    A bucket bound to a public base URL yields a URL. A bucket with NO `publicUrl` has no
    public binding at all, so there is no URL to build — we return the KEY and let the host
    decide how (and to whom) to hand out a link. No `r2.dev` fallback: guessing a public
    hostname for a bucket that was deliberately given none would publish the object.
    """
    base = r2.get("publicUrl")
    if not base:
        return {"key": key}
    return {"url": f"{base.rstrip('/')}/{key}"}


def _upload_to_r2(r2: dict, path: str) -> dict:
    try:
        import boto3
    except ImportError:
        raise RuntimeError("boto3 not installed — cannot upload to R2")
    client = boto3.client("s3", endpoint_url=r2["endpoint"], aws_access_key_id=r2["accessKeyId"],
                          aws_secret_access_key=r2["secretAccessKey"], region_name="auto")
    filename = os.path.basename(path)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    key = _r2_key(r2, filename, ext)
    with open(path, "rb") as f:
        client.put_object(Bucket=r2["bucket"], Key=key, Body=f,
                          ContentType=_CONTENT_TYPES.get(ext, "application/octet-stream"))
    log.info(f"uploaded {filename} → {key}")
    return _r2_result(r2, key)


def _send_webhook(url: str, payload: dict) -> None:
    for attempt in range(3):
        if attempt:
            time.sleep(5 * attempt)
        try:
            _http_post(url, payload, timeout=15)
            return
        except Exception as e:
            log.warning(f"webhook attempt {attempt + 1}/3 failed: {e}")
    log.error("webhook delivery failed after 3 attempts")

# ─────────────────────────────────────────────────────────────────────────────
# ComfyUIExecutor — the graph harness (logic preserved from comfyrunner.py)
# ─────────────────────────────────────────────────────────────────────────────

class ComfyUIExecutor(Executor):
    runtime = "ComfyUI"
    default_ewma_ms = 8 * 60 * 1000.0   # ~8 min prior

    def __init__(self) -> None:
        super().__init__()
        self.vram_gb = float(os.environ.get("COMFYUI_VRAM_GB", "16"))
        self.dir          = os.environ.get("COMFYUI_DIR", "/root/ComfyUI")
        self.args         = os.environ.get("COMFYUI_ARGS", "--listen 0.0.0.0 --port 8188")
        self.url          = "http://localhost:8188"
        self.ws_url       = "ws://localhost:8188/ws"
        self.client_id    = uuid.uuid4().hex
        self.ready_timeout = int(os.environ.get("COMFY_READY_TIMEOUT", "300"))
        self.node_install_timeout = int(os.environ.get("NODE_INSTALL_TIMEOUT", "600"))
        self._proc: subprocess.Popen | None = None
        self._log_fh = None
        self._ready = threading.Event()
        self._ws_connected = threading.Event()
        self._pending: dict = {}            # prompt_id → {event, complete, error, job_id}
        self._pending_lock = threading.Lock()
        self._ws_started = False

    # ── server lifecycle ──
    def _start(self) -> None:
        args = ["python3", "main.py"] + self.args.split()
        log.info(f"starting ComfyUI: {' '.join(args)}")
        self._log_fh = open("/tmp/comfyui.log", "a")
        self._proc = subprocess.Popen(args, cwd=self.dir, stdout=self._log_fh, stderr=subprocess.STDOUT)
        if not self._ws_started:
            threading.Thread(target=self._ws_listener, daemon=True).start()
            self._ws_started = True

    def _stop(self) -> None:
        self._ready.clear()
        self._ws_connected.clear()
        if self._proc:
            log.info("terminating ComfyUI")
            self._proc.terminate()
            try:
                self._proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait()
            self._proc = None
        if self._log_fh:
            try:
                self._log_fh.close()
            except OSError:
                pass
            self._log_fh = None

    def _wait_for_http(self, timeout: "int | None" = None) -> bool:
        deadline = time.time() + (timeout if timeout is not None else self.ready_timeout)
        while time.time() < deadline:
            try:
                if "system" in _http_get(f"{self.url}/system_stats", timeout=5):
                    log.info("ComfyUI HTTP ready")
                    self._ready.set()
                    return True
            except Exception:
                pass
            time.sleep(3)
        return False

    def _restart(self) -> None:
        log.info("restarting ComfyUI")
        self._stop()
        time.sleep(2)
        self._start()
        if not self._wait_for_http():
            raise RuntimeError("ComfyUI did not restart within timeout")
        if not self._ws_connected.wait(timeout=30):
            raise RuntimeError("ComfyUI WS did not reconnect within 30s after restart")

    def _tail_log(self, n: int = 40) -> str:
        try:
            with open("/tmp/comfyui.log", "r", errors="replace") as f:
                return "".join(f.readlines()[-n:]).strip()
        except Exception:
            return "(comfyui.log unavailable)"

    # ── WS completion signaling (keyed by prompt_id) ──
    def _pending_for(self, prompt_id: str) -> dict:
        with self._pending_lock:
            p = self._pending.get(prompt_id)
            if p is None:
                p = {"event": threading.Event(), "complete": False, "error": None, "job_id": None}
                self._pending[prompt_id] = p
            return p

    def _signal(self, prompt_id: str, *, complete: bool = False, error: "str | None" = None) -> None:
        p = self._pending_for(prompt_id)
        if complete:
            p["complete"] = True
        if error:
            p["error"] = error
        p["event"].set()

    def _check_history_complete(self, prompt_id: str) -> bool:
        try:
            hist = _http_get(f"{self.url}/history/{prompt_id}", timeout=5)
        except Exception:
            return False
        entry = hist.get(prompt_id)
        if not entry:
            return False
        status = entry.get("status", {})
        str_status = status.get("status_str")
        if str_status == "error":
            self._signal(prompt_id, error="ComfyUI reported an execution error")
            return True
        if status.get("completed") or str_status == "success":
            self._signal(prompt_id, complete=True)
            return True
        return False

    def _ws_listener(self) -> None:
        while True:
            self._ready.wait()
            try:
                import websocket
                ws = websocket.create_connection(f"{self.ws_url}?clientId={self.client_id}", timeout=10)
                log.info("ComfyUI WS connected")
                self._ws_connected.set()
                while True:
                    raw = ws.recv()
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    etype, data = msg.get("type"), msg.get("data", {})
                    prompt_id = data.get("prompt_id")
                    if not prompt_id:
                        continue
                    with self._pending_lock:
                        p = self._pending.get(prompt_id)
                    if not p:
                        continue
                    job_id = p.get("job_id")
                    if etype == "executing":
                        node = data.get("node")
                        if node and job_id:
                            _append_event(job_id, {"type": "node", "node": node})
                        elif not node:
                            self._signal(prompt_id, complete=True)
                    elif etype == "progress" and job_id:
                        _append_event(job_id, {"type": "progress", "value": data.get("value"),
                                               "max": data.get("max"), "node": data.get("node")})
                    elif etype in ("execution_success", "execution_complete"):
                        self._signal(prompt_id, complete=True)
                    elif etype == "execution_error":
                        self._signal(prompt_id, error=data.get("exception_message", "ComfyUI execution error"))
            except Exception as e:
                log.warning(f"ComfyUI WS error: {e}; reconnecting in 5s")
            self._ws_connected.clear()
            time.sleep(5)

    # ── custom nodes ──
    def _custom_node_dir(self, name: str) -> str:
        return os.path.join(self.dir, "custom_nodes", name)

    @staticmethod
    def _node_name_from_url(url: str) -> str:
        return url.rstrip("/").split("/")[-1].removesuffix(".git")

    def _ensure_custom_nodes(self, nodes: list, job_id: str) -> bool:
        if not nodes:
            return False
        missing = [n for n in nodes
                   if not os.path.isdir(self._custom_node_dir(n.get("name") or self._node_name_from_url(n["url"])))]
        present = len(nodes) - len(missing)
        _append_event(job_id, {"type": "preflight-nodes", "missing": len(missing), "present": present, "total": len(nodes)})
        if not missing:
            return False
        for node in missing:
            name = node.get("name") or self._node_name_from_url(node["url"])
            dest = self._custom_node_dir(name)
            log.info(f"installing custom node: {name}")
            _append_event(job_id, {"type": "installing-node", "name": name})
            t0 = time.time()
            subprocess.run(["git", "clone", "--depth", "1", node["url"], dest], check=True, timeout=120, capture_output=True)
            reqs = os.path.join(dest, "requirements.txt")
            if os.path.exists(reqs):
                subprocess.run(["pip", "install", "-r", reqs, "-q"], check=True, timeout=self.node_install_timeout, capture_output=True)
            _append_event(job_id, {"type": "installed-node", "name": name, "elapsedMs": int((time.time() - t0) * 1000)})
        return True

    def _output_paths(self, outputs: dict) -> list[dict]:
        out: list[dict] = []
        output_dir = os.path.join(self.dir, "output")
        for node in outputs.values():
            for kind, okind in (("images", "image"), ("gifs", "video"), ("videos", "video")):
                for item in node.get(kind, []):
                    sub = item.get("subfolder", "")
                    rel = f"{sub}/{item['filename']}" if sub else item["filename"]
                    out.append({"kind": okind, "path": os.path.join(output_dir, rel)})
        return out

    # ── Executor interface ──
    def model_root(self) -> str:
        return os.path.join(self.dir, "models")

    def is_present(self, model: dict) -> bool:
        p = self.model_path(model["dest"])
        return os.path.isfile(p) and os.path.getsize(p) > 0

    def fetch_one(self, model: dict, job_id: str) -> None:
        dest_path = self.model_path(model["dest"])
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        size_bytes = model.get("sizeBytes", 0)
        timeout = max(900, int(size_bytes / (5 * 1024 * 1024) * 1.5)) if size_bytes else 2400
        if shutil.which("aria2c"):
            subprocess.run(["aria2c", "-x16", "-s16", "--allow-overwrite=true", "-q", model["url"], "-o", dest_path],
                           check=True, timeout=timeout)
        else:
            subprocess.run(["wget", "-q", model["url"], "-O", dest_path], check=True, timeout=timeout)

    def load(self, job_spec: dict, job_id: str) -> None:
        # Start the server if down, install custom nodes (restart if needed), download weights.
        if not self._ready.is_set():
            self._start()
            if not self._wait_for_http():
                raise RuntimeError("ComfyUI never became ready")
            self._ws_connected.wait(timeout=30)
        if self._ensure_custom_nodes(job_spec.get("customNodes", []), job_id):
            _append_event(job_id, {"type": "restarting-comfy", "reason": "custom-nodes-installed"})
            self._restart()
        _ensure_models(self, job_spec.get("models", []), job_id)

    def run(self, job_spec: dict, job_id: str) -> list[dict]:
        workflow = job_spec["workflow"]
        start = time.time()
        result = _http_post(f"{self.url}/prompt", {"prompt": workflow, "client_id": self.client_id})
        prompt_id = result.get("prompt_id")
        if not prompt_id:
            raise RuntimeError(f"ComfyUI /prompt returned no prompt_id: {result}")
        pending = self._pending_for(prompt_id)
        pending["job_id"] = job_id
        _append_event(job_id, {"type": "workflow-submitted", "promptId": prompt_id})
        try:
            deadline = time.time() + JOB_TIMEOUT
            while not pending["event"].wait(timeout=15):
                if time.time() >= deadline:
                    raise RuntimeError(f"job {job_id} timed out after {JOB_TIMEOUT}s. comfyui.log tail:\n{self._tail_log()}")
                if self._check_history_complete(prompt_id):
                    break
                _append_event(job_id, {"type": "waiting", "elapsedS": int(time.time() - start)})
            if pending["error"]:
                raise RuntimeError(pending["error"])
            entry = _http_get(f"{self.url}/history/{prompt_id}").get(prompt_id, {})
            return self._output_paths(entry.get("outputs", {}))
        finally:
            with self._pending_lock:
                self._pending.pop(prompt_id, None)

    def unload(self) -> None:
        self._stop()

    def fail_detail(self, err_str: str) -> str:
        return err_str if "comfyui.log tail:" in err_str else f"{err_str}\ncomfyui.log tail:\n{self._tail_log()}"

# ─────────────────────────────────────────────────────────────────────────────
# VllmExecutor — the LLM/VLM serving harness (consumes spec.inference)
# ─────────────────────────────────────────────────────────────────────────────

class OpenAIServerExecutor(Executor):
    """Base for OpenAI-compatible serving harnesses (vLLM, SGLang). Model-BOUND: `load` downloads the
    repo then launches a server that serves /v1/chat/completions; a different model triggers relaunch
    (one model per harness). Subclasses provide `_serve_cmd` + `_serve_env` + `server_label`/`url`;
    everything else — download, lifecycle, the chat request — is shared."""

    server_label = "server"   # /tmp/<label>.log + messages

    def __init__(self) -> None:
        super().__init__()
        self.root          = os.environ.get("MODEL_ROOT", "/root/models")
        self.url           = "http://localhost:8000"   # subclass overrides in __init__
        self.ready_timeout = int(os.environ.get("SERVER_READY_TIMEOUT", "600"))
        self._proc: subprocess.Popen | None = None
        self._served_dir = ""

    @property
    def _log_path(self) -> str:
        return f"/tmp/{self.server_label}.log"

    # ── shared ──
    def model_root(self) -> str:
        return self.root

    def is_present(self, model: dict) -> bool:
        p = self.model_path(model["dest"])
        return os.path.isdir(p) and any(os.scandir(p))

    def fetch_one(self, model: dict, job_id: str) -> None:
        dest_path = self.model_path(model["dest"])
        os.makedirs(dest_path, exist_ok=True)
        repo = model.get("repo")
        if not repo:
            raise RuntimeError(f"model '{model['dest']}' has no 'repo' (HF repo id) to download")
        # `huggingface-cli` was removed in recent huggingface_hub — the CLI is now `hf`.
        subprocess.run(["hf", "download", repo, "--local-dir", dest_path],
                       check=True, timeout=int(model.get("downloadTimeout", 3600)))

    def _lm_dir(self, job_spec: dict) -> str:
        for m in job_spec.get("models", []):
            if m.get("role") == "lm":
                return self.model_path(m["dest"])
        models = job_spec.get("models", [])
        if not models:
            raise RuntimeError("inference job has no model to serve")
        return self.model_path(models[0]["dest"])

    def _wait_for_http(self) -> bool:
        deadline = time.time() + self.ready_timeout
        while time.time() < deadline:
            # Fail fast if the serve subprocess died (OOM, bad flag, KV refusal) instead of waiting out
            # the full ready timeout.
            if self._proc is not None and self._proc.poll() is not None:
                return False
            try:
                _http_get(f"{self.url}/v1/models", timeout=5)
                return True
            except Exception:
                pass
            time.sleep(3)
        return False

    def _tail_log(self, n: int = 30) -> str:
        # The serving frameworks bury the real cause (a ValueError/OOM in a worker subprocess) ABOVE a
        # generic wrapper, so a blind tail shows only the wrapper. Surface the real error lines + tail.
        try:
            with open(self._log_path, "r", errors="replace") as f:
                lines = f.readlines()
        except Exception:
            return f"({self.server_label}.log unavailable)"
        pat = ("ValueError", "RuntimeError", "OutOfMemory", "out of memory", "CUDA out of memory",
               "KV cache", "max seq len", "max_model_len", "no available memory", "OSError",
               "ImportError", "not supported", "trust_remote_code")
        cause = [ln.rstrip() for ln in lines if any(p in ln for p in pat) and "core.py:1165" not in ln]
        tail = "".join(lines[-n:]).strip()
        if cause:
            return "ROOT CAUSE:\n" + "\n".join(cause[-6:]) + "\n--- tail ---\n" + tail
        return tail

    def fail_detail(self, err_str: str) -> str:
        marker = f"{self.server_label}.log tail:"
        return err_str if marker in err_str else f"{err_str}\n{marker}\n{self._tail_log()}"

    # ── subclass hooks ──
    def _serve_cmd(self, model_dir: str) -> list:
        raise NotImplementedError

    def _serve_env(self) -> dict:
        return {**os.environ}

    # ── lifecycle ──
    def load(self, job_spec: dict, job_id: str) -> None:
        _ensure_models(self, job_spec.get("models", []), job_id)
        model_dir = self._lm_dir(job_spec)
        if self._proc and self._served_dir == model_dir:
            return   # already serving this model
        if self._proc:
            self._stop_server()   # serving a different model — relaunch
        cmd = self._serve_cmd(model_dir)
        log.info(f"launching {self.server_label}: {' '.join(cmd)}")
        _append_event(job_id, {"type": "loading-model", "dir": model_dir})
        self._proc = subprocess.Popen(cmd, stdout=open(self._log_path, "a"), stderr=subprocess.STDOUT,
                                      env=self._serve_env())
        self._served_dir = model_dir
        if not self._wait_for_http():
            died = self._proc is None or self._proc.poll() is not None
            self._stop_server()
            why = f"{self.server_label} server exited during startup" if died else f"{self.server_label} server never became ready"
            raise RuntimeError(f"{why}\n{self.server_label}.log tail:\n{self._tail_log()}")

    def _stop_server(self) -> None:
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait()
            self._proc = None
            self._served_dir = ""

    def run(self, job_spec: dict, job_id: str) -> list[dict]:
        inference = job_spec.get("inference") or {}
        gen = inference.get("genParams", {}) or {}
        content: list = [{"type": "text", "text": inference.get("prompt", "")}]
        for m in inference.get("media", []) or []:
            if m.get("type") == "image":
                content.append({"type": "image_url", "image_url": {"url": m["ref"]}})
            elif m.get("type") == "audio":
                content.append({"type": "audio_url", "audio_url": {"url": m["ref"]}})
            elif m.get("type") == "video":
                content.append({"type": "video_url", "video_url": {"url": m["ref"]}})
        messages: list = []
        if inference.get("systemPrompt"):
            messages.append({"role": "system", "content": inference["systemPrompt"]})
        messages.append({"role": "user", "content": content})
        body = {"model": "default", "messages": messages,
                "max_tokens": gen.get("max_tokens", 1024), "temperature": gen.get("temperature", 0.7)}
        for k in ("top_p", "top_k", "repeat_penalty", "presence_penalty", "frequency_penalty"):
            if k in gen:
                body[k] = gen[k]
        _append_event(job_id, {"type": "inference-submitted"})
        result = _http_post(f"{self.url}/v1/chat/completions", body, timeout=JOB_TIMEOUT)
        choices = result.get("choices") or []
        text = choices[0].get("message", {}).get("content", "") if choices else ""
        return [{"kind": "text", "text": text}]

    def unload(self) -> None:
        self._stop_server()


class VllmExecutor(OpenAIServerExecutor):
    """vLLM server — for architectures vLLM implements natively (Qwen-VL family, etc.)."""

    runtime = "vLLM"
    default_ewma_ms = 30_000.0
    server_label = "vllm"

    def __init__(self) -> None:
        super().__init__()
        self.vram_gb       = float(os.environ.get("VLLM_VRAM_GB", "20"))
        self.url           = os.environ.get("VLLM_URL", "http://localhost:8000")
        # 0.90 (vLLM's own 0.92 default refuses to start if any VRAM is held); co-residency later
        # derives this from RUNNER_VRAM_GB.
        self.gpu_util      = os.environ.get("VLLM_GPU_UTIL", "0.90")
        # 4096 keeps KV (~0.6GB) small enough to fit beside ~16.65GB weights on a ~20GB pod (16384's
        # 2.25GB KV did NOT fit on a live pod, 2026-06-11). Override up on bigger GPUs.
        self.max_model_len = os.environ.get("VLLM_MAX_MODEL_LEN", "4096")

    def _serve_cmd(self, model_dir: str) -> list:
        cmd = ["vllm", "serve", model_dir, "--served-model-name", "default"]
        if self.gpu_util:
            cmd += ["--gpu-memory-utilization", self.gpu_util]
        if self.max_model_len:
            cmd += ["--max-model-len", self.max_model_len]
        return cmd

    def _serve_env(self) -> dict:
        # Hopper GPUs try FP8 kernels via DeepGEMM, which isn't in the pip env → crash. The model is
        # BF16 (no quant), so disable the path. Env-overridable.
        return {**os.environ, "VLLM_USE_DEEP_GEMM": os.environ.get("VLLM_USE_DEEP_GEMM", "0")}


class SGLangExecutor(OpenAIServerExecutor):
    """SGLang server — for custom architectures vLLM can't serve (MOSS-Music: Qwen3-8B + audio
    encoder). `--trust-remote-code` loads the custom modeling code; the OpenAI-compatible API is the
    same as vLLM's, so the inference path is shared. SGLang is MOSS's own recommended serving path."""

    runtime = "sglang"
    default_ewma_ms = 30_000.0
    server_label = "sglang"

    def __init__(self) -> None:
        super().__init__()
        self.vram_gb        = float(os.environ.get("SGLANG_VRAM_GB", "22"))
        self.url            = os.environ.get("SGLANG_URL", "http://localhost:30000")
        self.port           = os.environ.get("SGLANG_PORT", "30000")
        self.mem_fraction   = os.environ.get("SGLANG_MEM_FRACTION", "0.85")
        self.context_length = os.environ.get("SGLANG_CONTEXT_LENGTH", "4096")

    def _serve_cmd(self, model_dir: str) -> list:
        cmd = ["python3", "-m", "sglang.launch_server", "--model-path", model_dir,
               "--served-model-name", "default", "--trust-remote-code",
               "--host", "0.0.0.0", "--port", self.port]
        if self.mem_fraction:
            cmd += ["--mem-fraction-static", self.mem_fraction]
        if self.context_length:
            cmd += ["--context-length", self.context_length]
        return cmd

    def _serve_env(self) -> dict:
        # sglang[all] pulls a CUDA-13 torch whose bundled libs (libnvrtc.so.13, libcudart.so.13, …)
        # ship under nvidia/cu13/lib but are NOT on the linker path → sgl_kernel/deep_gemm fail to
        # dlopen them on the CUDA-12.4 base. Prepend that dir (the driver is CUDA-13 forward-compatible,
        # so the cu13 userspace libs run fine). Verified-live-local 2026-06-12. SGLANG_ENABLE_JIT_DEEPGEMM
        # left off (BF16 doesn't need FP8). `libnuma.so.1` (apt libnuma1) is installed by the bootstrap.
        cu13 = os.environ.get("SGLANG_CU13_LIB", "/usr/local/lib/python3.11/dist-packages/nvidia/cu13/lib")
        existing = os.environ.get("LD_LIBRARY_PATH", "")
        env = {**os.environ, "SGLANG_ENABLE_JIT_DEEPGEMM": os.environ.get("SGLANG_ENABLE_JIT_DEEPGEMM", "0")}
        env["LD_LIBRARY_PATH"] = f"{cu13}:{existing}" if existing else cu13
        return env

# ─────────────────────────────────────────────────────────────────────────────
# PythonModelcardExecutor — a cloned repo run as a one-shot CLI (HeartMuLa) — ADR-0007
# ─────────────────────────────────────────────────────────────────────────────

class PythonModelcardExecutor(Executor):
    """Runs a modelcard repo's own inference as a one-shot CLI (no server). `load` clones the repo,
    `pip install -e .`s it, and downloads the weights INTO the repo tree (dest is repo-relative).
    `run` writes the spec's file inputs (e.g. lyrics.txt/tags.txt), runs `entry + args` from the
    repo root, and collects the output artifact. Bespoke per model via the compiled `spec.script`."""

    runtime = "python-modelcard"
    default_ewma_ms = 240_000.0   # ~4 min (music gen)
    server_label = "modelcard"

    def __init__(self) -> None:
        super().__init__()
        self.vram_gb = float(os.environ.get("MODELCARD_VRAM_GB", "24"))
        self.root    = os.environ.get("MODEL_ROOT", "/root/models")
        self._workdir: "str | None" = None   # the cloned repo dir
        self._repo = ""

    # weights download relative to the cloned repo (dest like 'ckpt/...'); model_root is the repo dir
    def model_root(self) -> str:
        return self._workdir or self.root

    def is_present(self, model: dict) -> bool:
        p = self.model_path(model["dest"])
        return os.path.isdir(p) and any(os.scandir(p))

    def fetch_one(self, model: dict, job_id: str) -> None:
        dest_path = self.model_path(model["dest"])
        os.makedirs(dest_path, exist_ok=True)
        repo = model.get("repo")
        if not repo:
            raise RuntimeError(f"model '{model['dest']}' has no 'repo' (HF repo id)")
        subprocess.run(["hf", "download", repo, "--local-dir", dest_path],
                       check=True, timeout=int(model.get("downloadTimeout", 3600)))

    def _tail_log(self, n: int = 40) -> str:
        try:
            with open("/tmp/modelcard.log", "r", errors="replace") as f:
                return "".join(f.readlines()[-n:]).strip()
        except Exception:
            return "(modelcard.log unavailable)"

    def fail_detail(self, err_str: str) -> str:
        return err_str if "modelcard.log tail:" in err_str else f"{err_str}\nmodelcard.log tail:\n{self._tail_log()}"

    def load(self, job_spec: dict, job_id: str) -> None:
        script = job_spec.get("script") or {}
        repo = script.get("repo")
        if not repo:
            raise RuntimeError("python-modelcard job has no script.repo")
        name = repo.rstrip("/").split("/")[-1].removesuffix(".git")
        self._workdir = os.path.join(self.root, name)
        if self._repo != repo or not os.path.isdir(os.path.join(self._workdir, ".git")):
            _append_event(job_id, {"type": "cloning-repo", "repo": repo})
            subprocess.run(["rm", "-rf", self._workdir], check=False, timeout=60)
            subprocess.run(["git", "clone", "--depth", "1", repo, self._workdir], check=True, timeout=300)
            install = (job_spec.get("script") or {}).get("install") or "pip install -e . -q"
            subprocess.run(install, shell=True, cwd=self._workdir, check=True, timeout=1800)
            self._repo = repo
        # weights download INTO the repo (model_root == workdir now)
        _ensure_models(self, job_spec.get("models", []), job_id)

    def run(self, job_spec: dict, job_id: str) -> list[dict]:
        script = job_spec["script"]
        wd = self._workdir
        # write file inputs (lyrics.txt, tags.txt, …)
        for rel, content in (script.get("fileInputs") or {}).items():
            full = os.path.join(wd, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w") as f:
                f.write(content)
        cmd = script["entry"].split() + list(script.get("args", []))
        log.info(f"modelcard run: {' '.join(cmd)} (cwd={wd})")
        _append_event(job_id, {"type": "generating"})
        # expandable_segments cuts CUDA fragmentation — the difference between fitting and OOMing at
        # a late allocation spike (e.g. HeartMuLa's codec decode). HF_HOME points `from_pretrained`
        # (Hunyuan3D) at the persistent model volume so weights cache across runs. Env-overridable.
        env = {**os.environ,
               "PYTORCH_CUDA_ALLOC_CONF": os.environ.get("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True"),
               "HF_HOME": os.environ.get("HF_HOME", os.path.join(self.root, "hf_cache"))}
        with open("/tmp/modelcard.log", "a") as logf:
            r = subprocess.run(cmd, cwd=wd, stdout=logf, stderr=subprocess.STDOUT, timeout=JOB_TIMEOUT, env=env)
        if r.returncode != 0:
            raise RuntimeError(f"modelcard CLI exited {r.returncode}\nmodelcard.log tail:\n{self._tail_log()}")
        out_path = os.path.join(wd, script["output"])
        if not os.path.isfile(out_path):
            raise RuntimeError(f"modelcard produced no output at {script['output']}\nmodelcard.log tail:\n{self._tail_log()}")
        return [{"kind": script.get("outputKind", "audio"), "path": out_path}]

    def unload(self) -> None:
        # one-shot CLI — no persistent server/VRAM to free (weights+repo stay on disk for reuse).
        pass

# ── Harness registry ──────────────────────────────────────────────────────────

def _build_harnesses() -> "tuple[dict, list]":
    comfy = ComfyUIExecutor()
    vllm = VllmExecutor()
    sglang = SGLangExecutor()
    modelcard = PythonModelcardExecutor()
    registry = {"ComfyUI": comfy, "vLLM": vllm, "llm": vllm,   # vLLM/llm share one harness
                "sglang": sglang, "transformers": sglang,       # custom-arch models (MOSS)
                "python-modelcard": modelcard}                   # one-shot CLI models (HeartMuLa)
    unique = [comfy, vllm, sglang, modelcard]
    return registry, unique


EXECUTORS, _HARNESSES = _build_harnesses()

# ─────────────────────────────────────────────────────────────────────────────
# VRAM-budget scheduler (the manager)
# ─────────────────────────────────────────────────────────────────────────────

def _reserved_vram(exclude: "Executor | None" = None) -> float:
    """VRAM held by harnesses that are loaded or loading (i.e. committed)."""
    return sum(h.vram_gb for h in _HARNESSES if h is not exclude and h.state in ("loaded", "loading"))


def _idle_lru_to_free(need_gb: float, exclude: Executor) -> "list[Executor] | None":
    """Pick idle (loaded, not busy) harnesses, LRU first, until `need_gb` is freed. None if it
    can't be freed (the rest is held by busy harnesses — the job must wait)."""
    idle = sorted((h for h in _HARNESSES if h is not exclude and h.state == "loaded" and not h.busy),
                  key=lambda h: h.last_used)
    freed, picked = 0.0, []
    for h in idle:
        if freed >= need_gb:
            break
        picked.append(h)
        freed += h.vram_gb
    return picked if freed >= need_gb else None


def _priority(job_id: str, now: float) -> float:
    """Lower runs first: expected duration minus aging credit. A job's wait time lowers its number,
    so a long-starved job eventually overtakes a stream of fast ones (anti-starvation)."""
    job = _jobs[job_id]
    ex = EXECUTORS.get(job["runtime"])
    ewma = ex.ewma_ms if ex else 60_000.0
    waited_ms = now - job["enqueued"]
    return ewma - waited_ms * AGING


def _pick_next_runnable() -> "tuple | None":
    """PURE decision (no side effects) — caller holds _lock. Returns (job_id, executor, evictees,
    need_load) for the highest-priority waiting job that can run NOW, or None. Ordered shortest-
    expected-first with aging; bounded by VRAM (evict idle-LRU to fit; never evict a busy harness)."""
    now = _now_ms()
    for job_id in sorted(_wait, key=lambda j: _priority(j, now)):
        ex = EXECUTORS.get(_jobs[job_id]["runtime"])
        if ex is None or ex.busy:
            continue                                  # unknown runtime, or harness occupied → wait
        if ex.state == "loaded":
            return (job_id, ex, [], False)            # resident + idle → run (may be concurrent)
        free = VRAM_BUDGET_GB - _reserved_vram(exclude=ex)
        if ex.vram_gb <= free:
            return (job_id, ex, [], True)             # fits as-is → load + run
        evictees = _idle_lru_to_free(ex.vram_gb - free, exclude=ex)
        if evictees is not None:
            return (job_id, ex, evictees, True)       # evict idle to fit
        # else: room is held by busy harnesses — this job waits; try the next candidate
    return None


def _schedule() -> None:
    """Admit as many runnable jobs as VRAM allows, dispatching each to its own worker thread."""
    while True:
        with _lock:
            cand = _pick_next_runnable()
            if cand is None:
                return
            job_id, ex, evictees, need_load = cand
            for e in evictees:
                e.state = "unloading"
            if need_load:
                ex.state = "loading"
            ex.busy = True
            _jobs[job_id]["status"] = "running"
            _wait.remove(job_id)
        threading.Thread(target=_run_job, args=(job_id, ex, evictees, need_load), daemon=True).start()


def _run_job(job_id: str, ex: Executor, evictees: list, need_load: bool) -> None:
    job_spec = _jobs[job_id]["spec"]
    webhook, r2 = job_spec.get("webhook"), job_spec.get("r2")
    start = time.time()
    log.info(f"starting job {job_id} on {ex.runtime} (evict={[e.runtime for e in evictees]}, load={need_load})")
    try:
        for e in evictees:
            log.info(f"evicting idle harness {e.runtime} to free {e.vram_gb}GB")
            e.unload()
            with _lock:
                e.state = "unloaded"
        if need_load:
            ex.load(job_spec, job_id)
            with _lock:
                ex.state = "loaded"
        else:
            # already-loaded harness may still need this job's (newly-pinned) weights
            ex.load(job_spec, job_id)

        outputs = ex.run(job_spec, job_id)
        execution_time = int((time.time() - start) * 1000)
        log.info(f"job {job_id} done in {execution_time}ms, {len(outputs)} output(s)")

        output_items: list = []
        for o in outputs:
            if o.get("kind") == "text":
                output_items.append({"kind": "text", "text": o.get("text", "")})
            elif "path" in o and r2:
                output_items.append({"kind": o.get("kind", "image"), **_upload_to_r2(r2, o["path"])})
            elif "path" in o:
                proxy = f"https://{POD_ID}-8188.proxy.runpod.net" if POD_ID else ex.model_root()
                output_items.append({"kind": o.get("kind", "image"), "path": o["path"],
                                     "proxyUrl": f"{proxy}/view?filename={os.path.basename(o['path'])}&type=output"})

        with _lock:
            job = _jobs[job_id]
            job["status"] = "completed"
            job["result"] = {"status": "completed", "output": output_items, "executionTime": execution_time}
            job["events"].append({"type": "complete", "output": output_items,
                                  "executionTimeMs": execution_time, "seq": len(job["events"])})
        if webhook:
            _send_webhook(webhook, {"id": job_id, "status": "COMPLETED", "output": output_items, "executionTime": execution_time})

    except Exception as e:
        log.error(f"job {job_id} failed: {e}")
        err_str = str(e)
        detail = getattr(ex, "fail_detail", None)
        if callable(detail):
            err_str = detail(err_str)
        with _lock:
            job = _jobs[job_id]
            job["status"] = "failed"
            job["result"] = {"status": "failed", "error": err_str}
            job["events"].append({"type": "error", "error": err_str, "seq": len(job["events"])})
        if webhook:
            _send_webhook(webhook, {"id": job_id, "status": "FAILED", "error": err_str})

    finally:
        with _lock:
            ex.busy = False
            ex.last_used = _now_ms()
            ex.record_duration((time.time() - start) * 1000)
        _schedule()   # a slot/VRAM freed — admit waiting jobs

# ── HTTP handler (shell) ─────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _write_sse(self, event: dict, seq: int) -> bool:
        try:
            self.wfile.write(f"id: {seq}\ndata: {json.dumps(event)}\n\n".encode())
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            return False

    def _parse_path(self) -> "tuple[str, str | None]":
        p = self.path
        if p == "/health":
            return ("health", None)
        parts = p.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "job":
            if len(parts) == 3 and parts[2] == "stream":
                return ("job-stream", parts[1])
            if len(parts) == 2:
                return ("job-poll", parts[1])
        if p == "/job":
            return ("job-list", None)
        if p == "/install":
            return ("install", None)
        return ("unknown", None)

    def do_GET(self):
        route, job_id = self._parse_path()
        if route == "health":
            with _lock:
                resident = [h.runtime for h in _HARNESSES if h.state == "loaded"]
                busy = any(h.busy for h in _HARNESSES)
                queued = len(_wait)
            self._send_json(200, {"status": "busy" if busy else "ready", "resident": resident,
                                  "queued": queued, "podId": POD_ID, "vramBudgetGb": VRAM_BUDGET_GB})

        elif route == "job-poll":
            with _lock:
                job = _jobs.get(job_id)
            if job is None:
                self._send_json(404, {"error": "job not found"})
            else:
                self._send_json(200, job.get("result") or {"status": job["status"]})

        elif route == "job-stream":
            try:
                next_seq = int(self.headers.get("Last-Event-ID", "")) + 1
            except (ValueError, TypeError):
                next_seq = 0
            with _lock:
                job = _jobs.get(job_id)
            if job is None:
                self._send_json(404, {"error": "job not found"})
                return
            self.send_response(200)
            for h, v in (("Content-Type", "text/event-stream"), ("Cache-Control", "no-cache"),
                         ("Connection", "keep-alive"), ("X-Accel-Buffering", "no")):
                self.send_header(h, v)
            self.end_headers()
            last_heartbeat = time.time()
            while True:
                with _lock:
                    events_snapshot = list(job["events"][next_seq:])
                    is_terminal = job["status"] in ("completed", "failed")
                for evt in events_snapshot:
                    if not self._write_sse(evt, evt["seq"]):
                        return
                    next_seq = evt["seq"] + 1
                    if evt["type"] in ("complete", "error"):
                        return
                if is_terminal:
                    return
                if time.time() - last_heartbeat > 25:
                    try:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        last_heartbeat = time.time()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        return
                time.sleep(0.3)
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        route, _ = self._parse_path()
        if route not in ("job-list", "install"):
            self._send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._send_json(400, {"error": "invalid JSON"})
            return

        if route == "install":
            runtime = body.get("runtime", "ComfyUI")
            ex = EXECUTORS.get(runtime)
            if ex is None:
                self._send_json(400, {"error": f"unknown runtime: {runtime}"})
                return
            models = body.get("models") or []
            if not isinstance(models, list):
                self._send_json(400, {"error": "models must be a list"})
                return
            try:
                result = _install_models(ex, models)
                self._send_json(200, result)
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return

        # POST /job
        if "jobId" not in body:
            self._send_json(400, {"error": "missing field: jobId"})
            return
        runtime = body.get("runtime", "ComfyUI")
        ex = EXECUTORS.get(runtime)
        if ex is None:
            self._send_json(400, {"error": f"unknown runtime: {runtime}"})
            return
        # ComfyUI jobs carry a graph (`workflow`); every serving runtime (vLLM, SGLang) carries an
        # `inference` body. Keying on "is it ComfyUI" (not "is it vLLM") is what makes sglang work.
        # Each runtime carries its own form: ComfyUI a graph, python-modelcard a CLI script, the
        # serving runtimes (vLLM/SGLang) an inference body.
        form_field = {"ComfyUI": "workflow", "python-modelcard": "script"}.get(ex.runtime, "inference")
        if form_field not in body:
            self._send_json(400, {"error": f"missing field: {form_field}"})
            return

        job_id = body["jobId"]
        with _lock:
            if job_id in _jobs:
                self._send_json(409, {"error": "job already exists"})
                return
            _jobs[job_id] = {"jobId": job_id, "status": "queued", "events": [], "result": None,
                             "runtime": runtime, "enqueued": _now_ms(), "spec": body}
            _wait.append(job_id)
            queued = len(_wait)
        _schedule()
        self._send_json(202, {"jobId": job_id, "queued": queued})
        log.info(f"job {job_id} enqueued (runtime={runtime}, waiting={queued})")

# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info(f"runner starting — vramBudget={VRAM_BUDGET_GB}GB pod={POD_ID or 'unknown'} "
             f"harnesses={[h.runtime for h in _HARNESSES]}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log.info(f"listening on :{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        for h in _HARNESSES:
            try:
                h.unload()
            except Exception:
                pass
