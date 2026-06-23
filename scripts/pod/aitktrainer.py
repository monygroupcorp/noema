#!/usr/bin/env python3
"""
aitktrainer.py — pod-side one-shot LoRA trainer (remote arm of the crystal training modus).

A SINGLE long job, not the multiplexed VRAM scheduler (runner.py). The host launcher
(RemoteAitkLauncher) provisions a SECURE pod on the ai-toolkit image, SSH-bootstraps this
script, and hands it everything via env. On boot it:

  1. writes the handed config (AITK_CONFIG_B64) → <AITK_DIR>/config/<job>.yaml
  2. pulls the dataset MANIFEST (AITK_MANIFEST_B64 = [{url,caption?}]) — downloads each
     image to <AITK_DATASET_DIR>/NNN.<ext> + writes the NNN.txt caption sidecar ai-toolkit
     pairs by basename (the same shape the LOCAL path trains on)
  3. seeds the SQLite Job row (ai-toolkit's `ui_trainer` updates it by name)
  4. runs `python run.py <config>` and POLLS the Job row → POSTs a minimal Progressus to
     NOEMA_STATUS_URL (/runner/status) keyed by NOEMA_ACTUM_ID (bulletin renders Slice A)
  5. on completion uploads <output>/<job>/<job>.safetensors to R2 → fires the completion
     webhook {id, status:'COMPLETED', output:[{url}], executionTime}; on error → FAILED.

The rich `aitkJobToProgressus` projection stays host-side (TS); this posts only the few
fields the bulletin needs. The webhook payload matches RunPodPayload (executionWebhook.ts)
byte-for-byte so the SAME async completion rail + training finalizer the local path proves
runs unchanged — the host re-hosts the LoRA from output[].url and registers the Intella.

Run (on the pod, via the bootstrap):
  AITK_JOB_ID=koh AITK_DIR=/aitk ... python3 /root/aitktrainer.py

Tests:  python3 -m unittest test_aitktrainer   (from scripts/pod)
"""

import base64
import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(asctime)s aitktrainer %(levelname)s %(message)s")
log = logging.getLogger("aitktrainer")

# Caption extension ai-toolkit pairs with each image (matches buildAitkConfig caption_ext).
CAPTION_EXT = "txt"
_IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


# ─────────────────────────────────────────────────────────────────────────────
# HTTP seams (injectable in tests) — mirror runner.py
# ─────────────────────────────────────────────────────────────────────────────

def _http_post(url: str, body: dict, timeout: int = 15) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {e.code} from {url}: {detail}") from e


def _send_webhook(url: str, payload: dict) -> None:
    """Deliver the completion webhook with a few retries — losing it strands the Actum."""
    for attempt in range(3):
        if attempt:
            time.sleep(5 * attempt)
        try:
            _http_post(url, payload, timeout=15)
            return
        except Exception as e:  # noqa: BLE001
            log.warning(f"webhook attempt {attempt + 1}/3 failed: {e}")
    log.error("webhook delivery failed after 3 attempts")


def _post_status(url: str, signal: dict) -> None:
    """Fire-and-forget a /runner/status Progressus — never let a status hiccup kill a train."""
    if not url:
        return
    try:
        _http_post(url, signal, timeout=10)
    except Exception as e:  # noqa: BLE001
        log.warning(f"status post failed (ignored): {e}")


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "noema-aitktrainer"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        f.write(r.read())


def _upload_to_r2(r2: dict, path: str, key: str) -> str:
    try:
        import boto3
    except ImportError:
        raise RuntimeError("boto3 not installed — cannot upload to R2")
    client = boto3.client("s3", endpoint_url=r2["endpoint"], aws_access_key_id=r2["accessKeyId"],
                          aws_secret_access_key=r2["secretAccessKey"], region_name="auto")
    with open(path, "rb") as f:
        client.put_object(Bucket=r2["bucket"], Key=key, Body=f, ContentType="application/octet-stream")
    base = (r2.get("publicUrl") or f"https://{r2['bucket']}.r2.dev").rstrip("/")
    return f"{base}/{key}"


# ─────────────────────────────────────────────────────────────────────────────
# Pure helpers — the wire contract (unit-tested)
# ─────────────────────────────────────────────────────────────────────────────

def parse_manifest(raw: str) -> list:
    """Parse the dataset manifest — a JSON array of {url, caption?}. Raises on a bad shape."""
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or not parsed:
        raise ValueError("manifest must be a non-empty JSON array")
    out = []
    for item in parsed:
        url = item.get("url") if isinstance(item, dict) else None
        if not isinstance(url, str) or not url:
            raise ValueError(f"manifest item missing url: {item!r}")
        entry = {"url": url}
        caption = item.get("caption")
        if isinstance(caption, str) and caption.strip():
            entry["caption"] = caption.strip()
        out.append(entry)
    return out


def _ext_for(url: str) -> str:
    """Image extension from a URL basename — default .png when absent/unknown."""
    base = url.split("?", 1)[0].rsplit("/", 1)[-1]
    dot = base.rfind(".")
    ext = base[dot:].lower() if dot >= 0 else ""
    return ext if ext in _IMG_EXTS else ".png"


def stage_dataset(manifest: list, dataset_dir: str, fetch=_download) -> int:
    """Download each manifest image to dataset_dir/NNN.<ext> and write its NNN.txt caption
    sidecar (ai-toolkit pairs image+caption by basename). Returns the image count."""
    os.makedirs(dataset_dir, exist_ok=True)
    for i, item in enumerate(manifest):
        stem = f"{i:04d}"
        img = os.path.join(dataset_dir, f"{stem}{_ext_for(item['url'])}")
        fetch(item["url"], img)
        caption = item.get("caption")
        if caption:
            with open(os.path.join(dataset_dir, f"{stem}.{CAPTION_EXT}"), "w", encoding="utf-8") as f:
                f.write(caption)
    return len(manifest)


def build_status_signal(actum_id: str, row: dict, cfg_steps=None) -> dict:
    """Project a Job row → the minimal Progressus signal POSTed to /runner/status. Maps to the
    SAME Phasis taxonomy aitkJobToProgressus uses (terminal done/failed; executing on steps)."""
    status = row.get("status", "")
    step = int(row.get("step", 0) or 0)
    info = (row.get("info") or "").strip()
    if status == "completed":
        prog = {"phase": "done"}
    elif status in ("error", "stopped"):
        prog = {"phase": "failed"}
        if info:
            prog["message"] = info
    elif status == "queued":
        prog = {"phase": "queued"}
    else:  # running
        mensura = {"done": step, "unit": "steps"}
        if isinstance(cfg_steps, int) and cfg_steps > 0:
            mensura["total"] = cfg_steps
        prog = {"phase": "executing", "progress": mensura}
    return {"actumId": actum_id, "progressus": prog}


def build_webhook_payload(pod_id: str, status: str, lora_url=None, execution_time=0, error=None) -> dict:
    """The completion webhook body — matches RunPodPayload (executionWebhook.ts). COMPLETED
    carries the LoRA URL in output[]; the host finalizer re-hosts it + registers the Intella."""
    if status == "COMPLETED":
        return {"id": pod_id, "status": "COMPLETED",
                "output": [{"url": lora_url}] if lora_url else [],
                "executionTime": execution_time}
    return {"id": pod_id, "status": "FAILED", "error": error or "training failed"}


def lora_path(output_dir: str, job_id: str) -> str:
    """ai-toolkit writes the LoRA to <training_folder>/<name>/<name>.safetensors."""
    return os.path.join(output_dir, job_id, f"{job_id}.safetensors")


def seed_job_row(db_path: str, job_id: str, gpu_ids: str = "0", job_config: str = "{}") -> None:
    """Seed the SQLite Job row ai-toolkit's ui_trainer updates by name — same schema + INSERT
    as the host SqliteAitkJobStore.seed (AitkJobStore.ts), so local and remote share one shape."""
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS Job ("
            "id TEXT PRIMARY KEY, name TEXT UNIQUE, gpu_ids TEXT DEFAULT '0', "
            "job_config TEXT DEFAULT '{}', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'stopped', "
            "stop INTEGER DEFAULT 0, return_to_queue INTEGER DEFAULT 0, step INTEGER DEFAULT 0, "
            "info TEXT DEFAULT '', speed_string TEXT DEFAULT '', queue_position INTEGER DEFAULT 0)"
        )
        conn.execute(
            "INSERT INTO Job (id, name, gpu_ids, job_config, status, info) "
            "VALUES (?, ?, ?, ?, 'queued', 'seeded by crystal') "
            "ON CONFLICT(id) DO UPDATE SET status='queued', stop=0, info='re-run', updated_at=CURRENT_TIMESTAMP",
            (job_id, job_id, gpu_ids, job_config),
        )
        conn.commit()
    finally:
        conn.close()


def read_job_row(db_path: str, job_id: str) -> dict:
    """Read the live Job row the trainer updates — {status, step, info, speed_string} or {}."""
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute("SELECT status, step, info, speed_string FROM Job WHERE id = ?", (job_id,))
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return {}
    return {"status": str(row[0] or ""), "step": int(row[1] or 0),
            "info": str(row[2] or ""), "speed_string": str(row[3] or "")}


# ─────────────────────────────────────────────────────────────────────────────
# Main — drive the run (the untestable shell: subprocess + GPU + network)
# ─────────────────────────────────────────────────────────────────────────────

def _env(name: str, default=None, required: bool = False) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        raise RuntimeError(f"missing required env {name}")
    return v


def main() -> int:
    aitk_dir = _env("AITK_DIR", "/aitk")
    job_id = _env("AITK_JOB_ID", required=True)
    dataset_dir = _env("AITK_DATASET_DIR", f"{aitk_dir}/dataset")
    output_dir = _env("AITK_OUTPUT_DIR", f"{aitk_dir}/output")
    db_path = _env("AITK_DB", f"{aitk_dir}/aitk_db.db")
    gpu_ids = _env("AITK_GPU_IDS", "0")
    steps = int(_env("AITK_STEPS", "0") or 0)
    poll_s = max(1.0, int(_env("AITK_POLL_MS", "2000")) / 1000.0)

    actum_id = _env("NOEMA_ACTUM_ID", "")
    status_url = _env("NOEMA_STATUS_URL", "")
    webhook_url = _env("NOEMA_WEBHOOK_URL", required=True)
    pod_id = _env("RUNPOD_POD_ID", job_id)

    r2 = {
        "endpoint": _env("R2_ENDPOINT", required=True),
        "accessKeyId": _env("R2_ACCESS_KEY_ID", required=True),
        "secretAccessKey": _env("R2_SECRET_ACCESS_KEY", required=True),
        "bucket": _env("R2_BUCKET_NAME", required=True),
        "publicUrl": _env("R2_PUBLIC_URL", ""),
    }

    t0 = time.time()
    try:
        # 1. write the handed config.
        config_dir = os.path.join(aitk_dir, "config")
        os.makedirs(config_dir, exist_ok=True)
        config_path = os.path.join(config_dir, f"{job_id}.yaml")
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(base64.b64decode(_env("AITK_CONFIG_B64", required=True)).decode("utf-8"))

        # 2. pull the dataset manifest → images + caption sidecars.
        _post_status(status_url, {"actumId": actum_id,
                                  "progressus": {"phase": "downloading", "target": "dataset"}})
        manifest = parse_manifest(base64.b64decode(_env("AITK_MANIFEST_B64", required=True)).decode("utf-8"))
        n = stage_dataset(manifest, dataset_dir)
        log.info(f"staged {n} images → {dataset_dir}")

        # 3. seed the Job row, then 4. run the trainer.
        seed_job_row(db_path, job_id, gpu_ids)
        log.info(f"launching run.py {config_path} (job={job_id}, steps={steps})")
        proc = subprocess.Popen(["python", "-u", "run.py", config_path], cwd=aitk_dir)

        # 4b. poll the Job row → POST status until terminal (or the process dies).
        last_phase = None
        while True:
            time.sleep(poll_s)
            row = read_job_row(db_path, job_id)
            if row:
                signal = build_status_signal(actum_id, row, steps if steps > 0 else None)
                phase = signal["progressus"]["phase"]
                if phase != last_phase or phase == "executing":
                    _post_status(status_url, signal)
                    last_phase = phase
                if row.get("status") == "completed":
                    break
                if row.get("status") in ("error", "stopped"):
                    raise RuntimeError(f"training {row.get('status')} at step {row.get('step')}: {row.get('info')}")
            if proc.poll() is not None and (not row or row.get("status") not in ("running", "completed")):
                raise RuntimeError(f"run.py exited ({proc.returncode}) before completion")

        # 5. upload the LoRA → fire the completion webhook.
        path = lora_path(output_dir, job_id)
        if not os.path.exists(path):
            raise RuntimeError(f"completed but no safetensors at {path}")
        url = _upload_to_r2(r2, path, f"training/{job_id}/{job_id}.safetensors")
        log.info(f"uploaded LoRA → {url}")
        _send_webhook(webhook_url, build_webhook_payload(
            pod_id, "COMPLETED", lora_url=url, execution_time=int((time.time() - t0) * 1000)))
        _post_status(status_url, {"actumId": actum_id, "progressus": {"phase": "done"}})
        log.info("done.")
        return 0
    except Exception as e:  # noqa: BLE001
        log.error(f"FAILED: {e}")
        _send_webhook(webhook_url, build_webhook_payload(pod_id, "FAILED", error=str(e)))
        _post_status(status_url, {"actumId": actum_id,
                                  "progressus": {"phase": "failed", "message": str(e)}})
        return 1


if __name__ == "__main__":
    sys.exit(main())
