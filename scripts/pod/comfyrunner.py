#!/usr/bin/env python3
"""
comfyrunner.py — ComfyUI job server for RunPod SECURE pods.

Owns the ComfyUI subprocess, handles job preflight (custom nodes + models),
drives inference via ComfyUI WebSocket events, uploads outputs to R2, and fires
completion webhooks. After bootstrap, all job communication is via HTTP — no SSH
required from the calling process.

Endpoints:
  GET  /health              — runner/pod status
  POST /job                 — enqueue a job
  GET  /job/<id>            — poll job status
  GET  /job/<id>/stream     — SSE stream of job events

Started by bootstrap:
  RUNPOD_POD_ID=xxx COMFYUI_DIR=/root/ComfyUI python3 /root/comfyrunner.py

Job POST body:
  {
    "jobId":       str,
    "workflow":    dict,               # ComfyUI input template
    "models":      [...],              # optional — { url, dest, sizeBytes? }
    "customNodes": [...],              # optional — { url, name? }
    "webhook":     str,                # optional — fires on complete/fail
    "r2":          { endpoint, accessKeyId, secretAccessKey, bucket, publicUrl? }
  }
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

# ── Config ─────────────────────────────────────────────────────────────────────

COMFYUI_DIR          = os.environ.get("COMFYUI_DIR", "/root/ComfyUI")
COMFYUI_ARGS         = os.environ.get("COMFYUI_ARGS", "--listen 0.0.0.0 --port 8188")
COMFYUI_URL          = "http://localhost:8188"
COMFYUI_WS_URL       = "ws://localhost:8188/ws"
# ComfyUI routes execution events (executing/progress/execution_success) only to
# the WS client whose clientId matches the /prompt submission. The WS connection
# and every /prompt MUST share this id or we receive zero execution events.
CLIENT_ID            = uuid.uuid4().hex
PORT                 = int(os.environ.get("RUNNER_PORT", "8080"))
POD_ID               = os.environ.get("RUNPOD_POD_ID", "")
JOB_TIMEOUT          = int(os.environ.get("JOB_TIMEOUT", "900"))
COMFY_READY_TIMEOUT  = int(os.environ.get("COMFY_READY_TIMEOUT", "300"))
NODE_INSTALL_TIMEOUT = int(os.environ.get("NODE_INSTALL_TIMEOUT", "600"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [comfyrunner] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("comfyrunner")

# ── Global state ───────────────────────────────────────────────────────────────

_lock = threading.Lock()

# jobId → {
#   status:         "queued"|"running"|"completed"|"failed"
#   events:         list[dict]    — append-only; each event has a "seq" int
#   comfy_event:    threading.Event  — set by WS listener on completion/error
#   comfy_complete: bool
#   comfy_error:    str | None
#   prompt_id:      str | None
#   result:         dict | None
# }
_jobs: dict = {}
_job_queue: list = []
_current_job: dict | None = None
_prompt_to_job: dict = {}   # prompt_id → jobId

_comfyui_proc: subprocess.Popen | None = None
_comfyui_log_fh = None          # file handle for ComfyUI log — kept to avoid fd leak on restart
_comfyui_ready = threading.Event()
_ws_connected   = threading.Event()  # set when WS listener has an active connection

# ── HTTP helpers ───────────────────────────────────────────────────────────────

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
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {e.code} from {url}: {detail}") from e

# ── ComfyUI lifecycle ──────────────────────────────────────────────────────────

def _start_comfyui() -> None:
    global _comfyui_proc, _comfyui_log_fh
    args = ["python3", "main.py"] + COMFYUI_ARGS.split()
    log.info(f"starting ComfyUI: {' '.join(args)}")
    # Keep file handle so we can close it explicitly on restart (avoids fd leak)
    _comfyui_log_fh = open("/tmp/comfyui.log", "a")
    _comfyui_proc = subprocess.Popen(
        args,
        cwd=COMFYUI_DIR,
        stdout=_comfyui_log_fh,
        stderr=subprocess.STDOUT,
    )


def _stop_comfyui() -> None:
    global _comfyui_proc, _comfyui_log_fh
    _comfyui_ready.clear()
    _ws_connected.clear()
    if _comfyui_proc:
        log.info("terminating ComfyUI")
        _comfyui_proc.terminate()
        try:
            _comfyui_proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            _comfyui_proc.kill()
            _comfyui_proc.wait()
        _comfyui_proc = None
    if _comfyui_log_fh:
        try:
            _comfyui_log_fh.close()
        except OSError:
            pass
        _comfyui_log_fh = None


def _restart_comfyui() -> None:
    log.info("restarting ComfyUI")
    _stop_comfyui()
    time.sleep(2)
    _start_comfyui()
    if not _wait_for_comfy_http():
        raise RuntimeError("ComfyUI did not restart within timeout")
    # Wait for WS listener to reconnect before returning — prevents a race where
    # the workflow is submitted before execution_complete events can be received.
    if not _ws_connected.wait(timeout=30):
        raise RuntimeError("ComfyUI WS did not reconnect within 30s after restart")


def _wait_for_comfy_http(timeout: int = COMFY_READY_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            data = _http_get(f"{COMFYUI_URL}/system_stats", timeout=5)
            if "system" in data:
                log.info("ComfyUI HTTP ready")
                _comfyui_ready.set()
                return True
        except Exception:
            pass
        time.sleep(3)
    log.error("ComfyUI HTTP never became ready")
    return False


def _tail_comfy_log(n: int = 40) -> str:
    """Last n lines of ComfyUI's log — attached to errors so a stalled/dead pod
    is still diagnosable from the failure event/webhook."""
    try:
        with open("/tmp/comfyui.log", "r", errors="replace") as f:
            return "".join(f.readlines()[-n:]).strip()
    except Exception:
        return "(comfyui.log unavailable)"


def _check_history_complete(job_id: str, prompt_id: str) -> bool:
    """Authoritative completion backstop: poll ComfyUI /history. The WS terminal
    event (execution_success/error) can be missed — scoped to a clientId or lost
    across a reconnect — leaving the job hung while ComfyUI has actually finished.
    Returns True if the prompt is done (success or error), having set comfy_event."""
    try:
        hist = _http_get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=5)
    except Exception:
        return False
    entry = hist.get(prompt_id)
    if not entry:
        return False
    status = entry.get("status", {})
    str_status = status.get("status_str")
    if str_status == "error":
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job["comfy_error"] = "ComfyUI reported an execution error"
                job["comfy_event"].set()
        return True
    if status.get("completed") or str_status == "success":
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job["comfy_complete"] = True
                job["comfy_event"].set()
        return True
    return False

# ── ComfyUI WebSocket listener ─────────────────────────────────────────────────

def _append_event(job_id: str, event: dict) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        event["seq"] = len(job["events"])
        job["events"].append(event)


def _ws_listener_thread() -> None:
    """Reconnecting WebSocket listener — routes ComfyUI events to job queues."""
    while True:
        _comfyui_ready.wait()
        try:
            import websocket  # websocket-client
            ws = websocket.create_connection(f"{COMFYUI_WS_URL}?clientId={CLIENT_ID}", timeout=10)
            log.info("ComfyUI WS connected")
            _ws_connected.set()
            while True:
                raw = ws.recv()
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue

                etype = msg.get("type")
                data  = msg.get("data", {})
                prompt_id = data.get("prompt_id")
                if not prompt_id:
                    continue

                with _lock:
                    job_id = _prompt_to_job.get(prompt_id)
                if not job_id:
                    continue

                if etype == "executing":
                    node = data.get("node")
                    if node:
                        _append_event(job_id, {"type": "node", "node": node})
                    else:
                        # null node is ComfyUI's classic "prompt finished" signal
                        with _lock:
                            job = _jobs.get(job_id)
                            if job:
                                job["comfy_complete"] = True
                                job["comfy_event"].set()
                elif etype == "progress":
                    _append_event(job_id, {
                        "type":  "progress",
                        "value": data.get("value"),
                        "max":   data.get("max"),
                        "node":  data.get("node"),
                    })
                elif etype in ("execution_success", "execution_complete"):
                    # Modern ComfyUI emits execution_success; older builds emitted
                    # execution_complete. Either is the terminal success signal.
                    with _lock:
                        job = _jobs.get(job_id)
                        if job:
                            job["comfy_complete"] = True
                            job["comfy_event"].set()
                elif etype == "execution_error":
                    err = data.get("exception_message", "ComfyUI execution error")
                    with _lock:
                        job = _jobs.get(job_id)
                        if job:
                            job["comfy_error"] = err
                            job["comfy_event"].set()

        except Exception as e:
            log.warning(f"ComfyUI WS error: {e}; reconnecting in 5s")
        _ws_connected.clear()
        time.sleep(5)

# ── Custom node preflight ──────────────────────────────────────────────────────

def _custom_node_dir(name: str) -> str:
    return os.path.join(COMFYUI_DIR, "custom_nodes", name)


def _node_name_from_url(url: str) -> str:
    return url.rstrip("/").split("/")[-1].removesuffix(".git")


def _ensure_custom_nodes(nodes: list, job_id: str) -> bool:
    """Install missing custom nodes. Returns True if any were installed (ComfyUI restart needed)."""
    if not nodes:
        return False

    missing = [n for n in nodes
               if not os.path.isdir(_custom_node_dir(n.get("name") or _node_name_from_url(n["url"])))]
    present = len(nodes) - len(missing)
    _append_event(job_id, {"type": "preflight-nodes", "missing": len(missing), "present": present, "total": len(nodes)})

    if not missing:
        return False

    for node in missing:
        name = node.get("name") or _node_name_from_url(node["url"])
        dest = _custom_node_dir(name)
        log.info(f"installing custom node: {name}")
        _append_event(job_id, {"type": "installing-node", "name": name})
        t0 = time.time()
        subprocess.run(
            ["git", "clone", "--depth", "1", node["url"], dest],
            check=True, timeout=120, capture_output=True,
        )
        reqs = os.path.join(dest, "requirements.txt")
        if os.path.exists(reqs):
            subprocess.run(
                ["pip", "install", "-r", reqs, "-q"],
                check=True, timeout=NODE_INSTALL_TIMEOUT, capture_output=True,
            )
        elapsed = int((time.time() - t0) * 1000)
        log.info(f"installed {name} in {elapsed}ms")
        _append_event(job_id, {"type": "installed-node", "name": name, "elapsedMs": elapsed})

    return True

# ── Model preflight ────────────────────────────────────────────────────────────

def _model_path(dest: str) -> str:
    return os.path.join(COMFYUI_DIR, "models", dest)


def _model_present(model: dict) -> bool:
    p = _model_path(model["dest"])
    return os.path.isfile(p) and os.path.getsize(p) > 0


# Per-dest download locks — serialize fetches of the SAME file so the live-apply install (/install)
# and a job's preflight (_ensure_models) can never download the same weight concurrently (which
# would corrupt it or waste bandwidth). Different files still download in parallel.
_DEST_LOCKS_GUARD = threading.Lock()
_DEST_LOCKS: dict = {}


def _dest_lock(dest: str) -> threading.Lock:
    with _DEST_LOCKS_GUARD:
        lk = _DEST_LOCKS.get(dest)
        if lk is None:
            lk = threading.Lock()
            _DEST_LOCKS[dest] = lk
        return lk


def _download_model(model: dict, job_id: str) -> "str | None":
    """Download one model to its dest, serialized per-dest. Re-checks presence inside the lock so a
    file another path just finished is skipped. Returns an error string, or None on success."""
    dest_path = _model_path(model["dest"])
    with _dest_lock(model["dest"]):
        if os.path.isfile(dest_path) and os.path.getsize(dest_path) > 0:
            return None  # finished by another path (a concurrent job/install) while we waited
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        t0 = time.time()
        _append_event(job_id, {"type": "downloading", "dest": model["dest"], "total": model.get("sizeBytes", 0)})
        MIN_BPS = 5 * 1024 * 1024
        size_bytes = model.get("sizeBytes", 0)
        timeout = max(900, int(size_bytes / MIN_BPS * 1.5)) if size_bytes else 2400
        try:
            if shutil.which("aria2c"):
                subprocess.run(
                    ["aria2c", "-x16", "-s16", "--allow-overwrite=true", "-q", model["url"], "-o", dest_path],
                    check=True, timeout=timeout,
                )
            else:
                subprocess.run(["wget", "-q", model["url"], "-O", dest_path], check=True, timeout=timeout)
            _append_event(job_id, {"type": "downloaded", "dest": model["dest"], "elapsedMs": int((time.time() - t0) * 1000)})
            return None
        except Exception as e:
            return f"{model['dest']}: {e}"


def _install_models(models: list, job_id: str = "live-install") -> dict:
    """Download-only model apply (B1) — fetch any missing models in parallel and return the tally,
    WITHOUT running a workflow. Idempotent (present files are skipped, partial fetches resume).
    Mirrors `_ensure_models`' download path; shares the per-dest lock so it never races a job."""
    if not models:
        return {"modelsDownloaded": 0, "modelsReused": 0, "downloadMs": 0, "downloadBytes": 0}
    missing = [m for m in models if not _model_present(m)]
    reused = len(models) - len(missing)
    t0 = time.time()
    errors: list = []
    threads: list = []

    def _dl(model: dict) -> None:
        err = _download_model(model, job_id)
        if err:
            errors.append(err)

    for m in missing:
        t = threading.Thread(target=_dl, args=(m,), daemon=True)
        threads.append(t)
        t.start()
    for t in threads:
        t.join()

    if errors:
        raise RuntimeError(f"install failed: {'; '.join(errors)}")
    return {
        "modelsDownloaded": len(missing),
        "modelsReused": reused,
        "downloadMs": int((time.time() - t0) * 1000),
        "downloadBytes": sum(m.get("sizeBytes", 0) for m in missing),
    }


def _ensure_models(models: list, job_id: str) -> None:
    if not models:
        return

    missing = [m for m in models if not _model_present(m)]
    present = len(models) - len(missing)
    _append_event(job_id, {"type": "preflight-models", "missing": len(missing), "present": present, "total": len(models)})

    if not missing:
        _append_event(job_id, {"type": "models-ready", "downloaded": 0, "reused": present})
        return

    errors: list[str] = []
    threads: list[threading.Thread] = []

    def _download(model: dict) -> None:
        err = _download_model(model, job_id)   # per-dest lock shared with the /install path
        if err:
            errors.append(err)

    # Periodic aggregate progress so the client can detect a throttled pod mid-download
    # (the per-file downloaded events only fire on completion — far too late on a crawl).
    dl_start = time.time()
    total_bytes = sum(m.get("sizeBytes", 0) for m in missing)
    stop_progress = threading.Event()

    def _progress_emitter() -> None:
        while not stop_progress.wait(15):
            done = 0
            for m in missing:
                try:
                    done += os.path.getsize(_model_path(m["dest"]))
                except OSError:
                    pass
            _append_event(job_id, {
                "type": "download-progress",
                "bytesDownloaded": done,
                "bytesTotal": total_bytes,
                "elapsedMs": int((time.time() - dl_start) * 1000),
            })

    pe = threading.Thread(target=_progress_emitter, daemon=True)
    pe.start()

    for m in missing:
        t = threading.Thread(target=_download, args=(m,), daemon=True)
        threads.append(t)
        t.start()
    for t in threads:
        t.join()
    stop_progress.set()

    if errors:
        raise RuntimeError(f"model download failed: {'; '.join(errors)}")

    _append_event(job_id, {"type": "models-ready", "downloaded": len(missing), "reused": present})

# ── R2 upload ──────────────────────────────────────────────────────────────────

_CONTENT_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "webp": "image/webp", "gif": "image/gif",
    "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime",
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


def _upload_to_r2(r2: dict, paths: list[str]) -> list[dict]:
    try:
        import boto3
    except ImportError:
        raise RuntimeError("boto3 not installed — cannot upload to R2")

    client = boto3.client(
        "s3",
        endpoint_url=r2["endpoint"],
        aws_access_key_id=r2["accessKeyId"],
        aws_secret_access_key=r2["secretAccessKey"],
        region_name="auto",
    )
    results = []
    for path in paths:
        filename = os.path.basename(path)
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        key = _r2_key(r2, filename, ext)
        with open(path, "rb") as f:
            client.put_object(
                Bucket=r2["bucket"],
                Key=key,
                Body=f,
                ContentType=_CONTENT_TYPES.get(ext, "application/octet-stream"),
            )
        results.append(_r2_result(r2, key))
        log.info(f"uploaded {filename} → {key}")
    return results

# ── Webhook ────────────────────────────────────────────────────────────────────

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

# ── Output path collection ─────────────────────────────────────────────────────

def _output_paths(outputs: dict) -> list[str]:
    paths = []
    output_dir = os.path.join(COMFYUI_DIR, "output")
    for node in outputs.values():
        for kind in ("images", "gifs", "videos"):
            for item in node.get(kind, []):
                sub = item.get("subfolder", "")
                rel = f"{sub}/{item['filename']}" if sub else item["filename"]
                paths.append(os.path.join(output_dir, rel))
    return paths

# ── Job processor ──────────────────────────────────────────────────────────────

def _ensure_media_inputs(media_inputs: list, job_id: str) -> None:
    """Fetch each i2i input file into ComfyUI's input/ dir before the workflow runs.
    The graph's LoadImage-style node references destFilename; we download url → that file.
    Mirrors the model-download idiom (aria2c/wget). Idempotent: a present file is reused
    (destFilename is a content-address of the source, so reuse is safe across jobs)."""
    if not media_inputs:
        return
    input_dir = os.path.join(COMFYUI_DIR, "input")
    os.makedirs(input_dir, exist_ok=True)
    for m in media_inputs:
        dest = os.path.join(input_dir, m["destFilename"])
        if os.path.isfile(dest) and os.path.getsize(dest) > 0:
            _append_event(job_id, {"type": "media-input-reused", "dest": m["destFilename"]})
            continue
        t0 = time.time()
        _append_event(job_id, {"type": "fetching-media-input", "dest": m["destFilename"]})
        try:
            if shutil.which("aria2c"):
                subprocess.run(
                    ["aria2c", "-x16", "-s16", "--allow-overwrite=true", "-q", m["url"], "-o", dest],
                    check=True, timeout=600,
                )
            else:
                subprocess.run(["wget", "-q", m["url"], "-O", dest], check=True, timeout=600)
            _append_event(job_id, {"type": "media-input-ready", "dest": m["destFilename"],
                                   "elapsedMs": int((time.time() - t0) * 1000)})
        except Exception as e:
            raise RuntimeError(f"media input fetch failed ({m['destFilename']}): {e}")


def _process_job(job_spec: dict) -> None:
    global _current_job
    job_id      = job_spec["jobId"]
    workflow    = job_spec["workflow"]
    models      = job_spec.get("models", [])
    custom_nodes = job_spec.get("customNodes", [])
    media_inputs = job_spec.get("mediaInputs", [])
    webhook     = job_spec.get("webhook")
    r2          = job_spec.get("r2")
    start       = time.time()

    log.info(f"starting job {job_id}")

    try:
        with _lock:
            _jobs[job_id]["status"] = "running"

        # 1. Custom node preflight
        nodes_installed = _ensure_custom_nodes(custom_nodes, job_id)
        if nodes_installed:
            _append_event(job_id, {"type": "restarting-comfy", "reason": "custom-nodes-installed"})
            _restart_comfyui()
            _append_event(job_id, {"type": "comfy-ready"})

        # 2. Model preflight
        _ensure_models(models, job_id)

        # 2b. Media-input preflight — fetch i2i input files into ComfyUI's input/ dir
        # so the graph's LoadImage node finds them by filename.
        _ensure_media_inputs(media_inputs, job_id)

        # 3. Submit workflow to ComfyUI
        result = _http_post(f"{COMFYUI_URL}/prompt", {"prompt": workflow, "client_id": CLIENT_ID})
        prompt_id = result.get("prompt_id")
        if not prompt_id:
            raise RuntimeError(f"ComfyUI /prompt returned no prompt_id: {result}")

        with _lock:
            _jobs[job_id]["prompt_id"] = prompt_id
            _prompt_to_job[prompt_id] = job_id

        log.info(f"job {job_id} submitted to ComfyUI as {prompt_id}")
        # Signal that ComfyUI accepted the prompt and execution has begun — lets the
        # client distinguish a download stall from a ComfyUI execution/load stall.
        _append_event(job_id, {"type": "workflow-submitted", "promptId": prompt_id})

        # 4. Wait for completion via WS push event, emitting a heartbeat while we
        #    wait. nodesExecuted staying 0 across heartbeats = stuck loading models
        #    (before any node runs); climbing = executing but slow.
        comfy_event = _jobs[job_id]["comfy_event"]
        deadline = time.time() + JOB_TIMEOUT
        while not comfy_event.wait(timeout=15):
            if time.time() >= deadline:
                raise RuntimeError(
                    f"job {job_id} timed out after {JOB_TIMEOUT}s waiting for ComfyUI. "
                    f"comfyui.log tail:\n{_tail_comfy_log()}"
                )
            # Backstop: the WS execution_success/error event can be missed (it's
            # scoped to a clientId / lost across a reconnect), leaving the job hung
            # while ComfyUI has actually finished. Poll /history authoritatively.
            if _check_history_complete(job_id, prompt_id):
                break
            with _lock:
                nodes_executed = sum(1 for e in _jobs[job_id]["events"] if e.get("type") == "node")
            _append_event(job_id, {"type": "waiting", "elapsedS": int(time.time() - start), "nodesExecuted": nodes_executed})

        with _lock:
            comfy_error = _jobs[job_id].get("comfy_error")
        if comfy_error:
            raise RuntimeError(comfy_error)

        # 5. Fetch outputs — single call, not a polling loop
        history = _http_get(f"{COMFYUI_URL}/history/{prompt_id}")
        entry   = history.get(prompt_id, {})
        paths   = _output_paths(entry.get("outputs", {}))
        execution_time = int((time.time() - start) * 1000)
        log.info(f"job {job_id} done in {execution_time}ms, {len(paths)} output(s)")

        # 6. R2 upload
        output_items: list[dict]
        if r2 and paths:
            _append_event(job_id, {"type": "uploading", "count": len(paths)})
            output_items = _upload_to_r2(r2, paths)
        else:
            proxy_base = f"https://{POD_ID}-8188.proxy.runpod.net" if POD_ID else COMFYUI_URL
            output_items = [{"path": p, "proxyUrl": f"{proxy_base}/view?filename={os.path.basename(p)}&type=output"} for p in paths]

        # 7. Terminal event — status and event appended atomically so SSE handler
        #    cannot see is_terminal=True before the "complete" event is in the list.
        with _lock:
            job = _jobs[job_id]
            job["status"] = "completed"
            job["result"] = {"status": "completed", "output": output_items, "executionTime": execution_time}
            evt = {"type": "complete", "output": output_items, "executionTimeMs": execution_time, "seq": len(job["events"])}
            job["events"].append(evt)

        if webhook:
            _send_webhook(webhook, {
                "id": job_id, "status": "COMPLETED",
                "output": output_items, "executionTime": execution_time,
            })

    except Exception as e:
        log.error(f"job {job_id} failed: {e}")
        err_str = str(e)
        # Ensure ComfyUI's last log lines ride along on any failure that doesn't
        # already include them (e.g. execution errors), so a dead pod stays diagnosable.
        if "comfyui.log tail:" not in err_str:
            err_str = f"{err_str}\ncomfyui.log tail:\n{_tail_comfy_log()}"
        with _lock:
            job = _jobs[job_id]
            job["status"] = "failed"
            job["result"] = {"status": "failed", "error": err_str}
            evt = {"type": "error", "error": err_str, "seq": len(job["events"])}
            job["events"].append(evt)
        if webhook:
            _send_webhook(webhook, {"id": job_id, "status": "FAILED", "error": err_str})

    finally:
        with _lock:
            _current_job = None
            pid = _jobs.get(job_id, {}).get("prompt_id")
            if pid:
                _prompt_to_job.pop(pid, None)
        _process_next()


def _process_next() -> None:
    global _current_job
    with _lock:
        if _current_job is not None or not _job_queue:
            return
        next_spec = _job_queue.pop(0)
        _current_job = next_spec
    threading.Thread(target=_process_job, args=(next_spec,), daemon=True).start()

# ── HTTP handler ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress per-request access logs

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

    def _parse_path(self) -> tuple[str, str | None]:
        """Returns (route, job_id). route is one of: health, job-list, job-poll, job-stream."""
        p = self.path
        if p == "/health":
            return ("health", None)
        parts = p.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "job":
            job_id = parts[1]
            if len(parts) == 3 and parts[2] == "stream":
                return ("job-stream", job_id)
            if len(parts) == 2:
                return ("job-poll", job_id)
        if p == "/job":
            return ("job-list", None)
        if p == "/install":
            return ("install", None)
        return ("unknown", None)

    def do_GET(self):
        route, job_id = self._parse_path()

        if route == "health":
            with _lock:
                status     = "starting" if not _comfyui_ready.is_set() else ("busy" if _current_job else "ready")
                queue_size = len(_job_queue)
            self._send_json(200, {"status": status, "queueSize": queue_size, "podId": POD_ID})

        elif route == "job-poll":
            with _lock:
                job = _jobs.get(job_id)
                in_flight = (
                    any(j["jobId"] == job_id for j in _job_queue) or
                    (_current_job and _current_job.get("jobId") == job_id)
                )
            if job is None and not in_flight:
                self._send_json(404, {"error": "job not found"})
            elif job is None:
                self._send_json(200, {"status": "running"})
            else:
                self._send_json(200, job.get("result") or {"status": job["status"]})

        elif route == "job-stream":
            last_id_hdr = self.headers.get("Last-Event-ID", "")
            try:
                next_seq = int(last_id_hdr) + 1
            except (ValueError, TypeError):
                next_seq = 0

            with _lock:
                job = _jobs.get(job_id)
            if job is None:
                self._send_json(404, {"error": "job not found"})
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
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

        # POST /install — download-only model apply (B1). No workflow run; returns the tally.
        if route == "install":
            if not _comfyui_ready.is_set():
                self._send_json(503, {"error": "ComfyUI not ready yet"})
                return
            models = body.get("models") or []
            if not isinstance(models, list):
                self._send_json(400, {"error": "models must be a list"})
                return
            try:
                result = _install_models(models)
                self._send_json(200, result)
                log.info(f"install complete: {result.get('modelsDownloaded')} downloaded, {result.get('modelsReused')} reused")
            except Exception as e:
                self._send_json(500, {"error": str(e)})
                log.error(f"install failed: {e}")
            return

        for field in ("jobId", "workflow"):
            if field not in body:
                self._send_json(400, {"error": f"missing field: {field}"})
                return

        if not _comfyui_ready.is_set():
            self._send_json(503, {"error": "ComfyUI not ready yet"})
            return

        job_id = body["jobId"]
        with _lock:
            if job_id in _jobs:
                self._send_json(409, {"error": "job already exists"})
                return
            _jobs[job_id] = {
                "jobId":          job_id,
                "status":         "queued",
                "events":         [],
                "comfy_event":    threading.Event(),
                "comfy_complete": False,
                "comfy_error":    None,
                "prompt_id":      None,
                "result":         None,
            }
            _job_queue.append(body)
            queue_pos = len(_job_queue)

        _process_next()
        self._send_json(202, {"jobId": job_id, "queued": queue_pos})
        log.info(f"job {job_id} enqueued (position {queue_pos})")

# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _start_comfyui()
    threading.Thread(target=_ws_listener_thread, daemon=True).start()

    if not _wait_for_comfy_http():
        log.error("ComfyUI never became ready, exiting")
        _stop_comfyui()
        sys.exit(1)

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log.info(f"listening on :{PORT} (pod {POD_ID or 'unknown'})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        _stop_comfyui()
