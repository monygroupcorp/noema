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

A second MODE runs on the same rails. With NOEMA_JOB_MODE=caption the script stops after
step 2b: it stages the manifest, runs the captioner over it, harvests each `NNN.txt` sidecar
into a {media id: caption} map (keyed by the id the manifest carried, never by position),
uploads that map as one JSON object and fires the SAME completion webhook with its URL. No
training config, no Job row, no run.py, no polling. An ABSENT NOEMA_JOB_MODE is 'train' and
behaves exactly as it always has.

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


def _tail(path: str, lines: int = 40, limit: int = 4000) -> str:
    """Last few lines of a log file (bounded) — for surfacing a run.py crash in the failure."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return "(no run log)"
    text = data.decode("utf-8", errors="replace")
    return "\n".join(text.splitlines()[-lines:])[-limit:]


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
        # Optional source identity (a dataset media id). Staged files are named by manifest
        # INDEX, so the id is the only handle a harvested caption can carry back to the exact
        # item it describes. Absent on the training path, which has no ids to supply.
        media_id = item.get("id")
        if isinstance(media_id, str) and media_id:
            entry["id"] = media_id
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


def count_uncaptioned(dataset_dir: str) -> int:
    """How many image files in the dir lack a sibling .txt caption — what the captioner will fill.
    Dataset-provided captions (written by stage_dataset) already have a .txt, so they're skipped."""
    try:
        names = os.listdir(dataset_dir)
    except OSError:
        return 0
    n = 0
    for name in names:
        stem, ext = os.path.splitext(name)
        if ext.lower() in _IMG_EXTS and not os.path.exists(os.path.join(dataset_dir, f"{stem}.{CAPTION_EXT}")):
            n += 1
    return n


def harvest_captions(manifest: list, dataset_dir: str):
    """Collect the captioner's output as a {media id: caption} MAP — the wire shape the host
    finalizer consumes.

    The captioner writes `<stem>.txt` beside each image, and `stage_dataset` names every stem by
    manifest INDEX. An index is not an identity: the host's dataset media list is append-only and
    can grow while this pod runs, so an index resolved back to a media item after the fact can
    land on a different item than the one that was staged. The manifest carries each item's `id`
    out, so the harvest carries it back and the host never computes a position.

    An item with no `id`, or with no readable caption sidecar, is OMITTED from the map and
    COUNTED — the host then sees honest coverage instead of a silently short map. No id is ever
    invented for one. Returns (captions, missing).
    """
    captions = {}
    missing = 0
    for i, item in enumerate(manifest):
        media_id = item.get("id")
        path = os.path.join(dataset_dir, f"{i:04d}.{CAPTION_EXT}")
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read().strip()
        except OSError:
            text = ""
        if not isinstance(media_id, str) or not media_id or not text:
            missing += 1
            continue
        captions[media_id] = text
    return captions, missing


def caption_key(job_id: str) -> str:
    """R2 key the harvested caption map lands under — mirrors `training/<job>/...`'s shape."""
    return f"captions/{job_id}/captions.json"


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


def build_webhook_payload(pod_id: str, status: str, lora_url=None, execution_time=0, error=None, sample_urls=None) -> dict:
    """The completion webhook body — matches RunPodPayload (executionWebhook.ts). COMPLETED
    carries the LoRA URL in output[0]; preview samples ride the SAME output[] tagged
    kind:'sample' (the host finalizer splits LoRA vs samples). The host re-hosts the LoRA,
    registers the Intella, and persists the samples as first-class previews.

    A caption job reports on this same shape — `lora_url` carries the harvested caption map's
    URL — so both modes ride one webhook contract and the host's resolvers pick by ministerium."""
    if status == "COMPLETED":
        output = [{"url": lora_url}] if lora_url else []
        output += [{"url": u, "kind": "sample"} for u in (sample_urls or [])]
        return {"id": pod_id, "status": "COMPLETED", "output": output, "executionTime": execution_time}
    return {"id": pod_id, "status": "FAILED", "error": error or "training failed"}


def lora_path(output_dir: str, job_id: str) -> str:
    """ai-toolkit writes the LoRA to <training_folder>/<name>/<name>.safetensors."""
    return os.path.join(output_dir, job_id, f"{job_id}.safetensors")


def sample_paths(output_dir: str, job_id: str) -> list:
    """End-of-run preview images ai-toolkit writes to <training_folder>/<name>/samples/.
    Returns the image paths sorted by name (so they pair with the config's prompt order)."""
    sample_dir = os.path.join(output_dir, job_id, "samples")
    try:
        names = sorted(n for n in os.listdir(sample_dir) if os.path.splitext(n)[1].lower() in _IMG_EXTS)
    except OSError:
        return []
    return [os.path.join(sample_dir, n) for n in names]


def latest_checkpoint(output_dir: str, job_id: str):
    """The highest-step LoRA checkpoint ai-toolkit has written so far → (path, step), or
    (None, 0). ai-toolkit names step checkpoints <name>_<zero-padded step>.safetensors; we
    rescue the newest to durable storage mid-run so a hard-killed pod is still resumable."""
    d = os.path.join(output_dir, job_id)
    prefix, suffix = f"{job_id}_", ".safetensors"
    best_path, best_step = None, -1
    try:
        names = os.listdir(d)
    except OSError:
        return None, 0
    for n in names:
        if n.startswith(prefix) and n.endswith(suffix):
            stem = n[len(prefix):-len(suffix)]
            if stem.isdigit() and int(stem) > best_step:
                best_step, best_path = int(stem), os.path.join(d, n)
    return best_path, (best_step if best_step >= 0 else 0)


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

def run_caption(aitk_dir: str, caption_path: str) -> None:
    """Run ai-toolkit's Qwen3-VL captioner over the dataset dir (fills missing .txt sidecars).
    Runs as a plain directory captioner — AITK_JOB_ID is removed from its env so the captioner
    doesn't touch the training Job row we poll. Raises with the run.py tail on failure."""
    cap_log = os.path.join(aitk_dir, "caption.runlog")
    env = {k: v for k, v in os.environ.items() if k != "AITK_JOB_ID"}
    with open(cap_log, "wb") as lf:
        rc = subprocess.call(["python", "-u", "run.py", caption_path], cwd=aitk_dir, env=env,
                             stdout=lf, stderr=subprocess.STDOUT)
    if rc != 0:
        raise RuntimeError(f"captioning failed (run.py exit {rc}) | run.py tail:\n{_tail(cap_log)}")


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

    # Job mode. 'train' (the default, and what an ABSENT value means) is the full pipeline below,
    # unchanged. 'caption' is a caption-only pass: stage the dataset, run the captioner, harvest
    # the sidecars into a {media id: caption} map, upload it and report — no training config, no
    # Job row, no run.py, no polling loop.
    job_mode = (_env("NOEMA_JOB_MODE", "train") or "train").strip().lower()
    is_caption = job_mode == "caption"

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
        config_dir = os.path.join(aitk_dir, "config")
        os.makedirs(config_dir, exist_ok=True)
        config_path = os.path.join(config_dir, f"{job_id}.yaml")

        if not is_caption:
            # 1. write the handed training config. A caption job has no training config — its
            #    launcher deliberately sends none — so this is skipped entirely in caption mode.
            with open(config_path, "w", encoding="utf-8") as f:
                f.write(base64.b64decode(_env("AITK_CONFIG_B64", required=True)).decode("utf-8"))

            # 1b. resume/continue (weights-only): download the prior LoRA the config's
            #     network.pretrained_lora_path points at — ai-toolkit inits the network from it.
            resume_url = _env("AITK_RESUME_URL", "")
            if resume_url:
                resume_path = _env("AITK_RESUME_PATH", f"{aitk_dir}/resume.safetensors")
                log.info(f"resume: downloading prior weights → {resume_path}")
                _download(resume_url, resume_path)

        # 2. pull the dataset manifest → images + caption sidecars.
        _post_status(status_url, {"actumId": actum_id,
                                  "progressus": {"phase": "downloading", "target": "dataset"}})
        manifest = parse_manifest(base64.b64decode(_env("AITK_MANIFEST_B64", required=True)).decode("utf-8"))
        n = stage_dataset(manifest, dataset_dir)
        log.info(f"staged {n} images → {dataset_dir}")

        # 2b. captioning. In TRAIN mode this fills captions for images that arrived without one and
        #     is skipped when there is nothing missing. In CAPTION mode it is the job: run it
        #     directly rather than leaning on the gap count, which the manifest happens to make
        #     total. recaption:false in the config → any caption already on disk wins.
        caption_b64 = _env("AITK_CAPTION_CONFIG_B64", "")
        if is_caption:
            if not caption_b64:
                raise RuntimeError("caption mode: missing required env AITK_CAPTION_CONFIG_B64")
            _post_status(status_url, {"actumId": actum_id,
                                      "progressus": {"phase": "executing",
                                                     "progress": {"done": 0, "total": n, "unit": "images"}}})
            caption_path = os.path.join(config_dir, "caption.yaml")
            with open(caption_path, "w", encoding="utf-8") as f:
                f.write(base64.b64decode(caption_b64).decode("utf-8"))
            log.info(f"captioning {n} images via {caption_path}")
            run_caption(aitk_dir, caption_path)
            log.info("captioning done")

            # Harvest the sidecars into a {media id: caption} map, upload it as one JSON object,
            # and report it on the SAME completion webhook shape a training run uses — the host
            # reads the url off output[0] and runs caption finality against it.
            captions, uncollected = harvest_captions(manifest, dataset_dir)
            log.info(f"harvested {len(captions)} captions ({uncollected} not collected)")
            harvest_path = os.path.join(aitk_dir, "captions.json")
            with open(harvest_path, "w", encoding="utf-8") as f:
                json.dump(captions, f, ensure_ascii=False)
            url = _upload_to_r2(r2, harvest_path, caption_key(job_id))
            log.info(f"uploaded captions → {url}")

            _send_webhook(webhook_url, build_webhook_payload(
                pod_id, "COMPLETED", lora_url=url, execution_time=int((time.time() - t0) * 1000)))
            _post_status(status_url, {"actumId": actum_id, "progressus": {"phase": "done"}})
            log.info("done.")
            return 0

        missing = count_uncaptioned(dataset_dir)
        if caption_b64 and missing > 0:
            _post_status(status_url, {"actumId": actum_id,
                                      "progressus": {"phase": "downloading", "target": "dataset",
                                                     "message": f"captioning {missing} images"}})
            caption_path = os.path.join(config_dir, "caption.yaml")
            with open(caption_path, "w", encoding="utf-8") as f:
                f.write(base64.b64decode(caption_b64).decode("utf-8"))
            log.info(f"captioning {missing} uncaptioned images via {caption_path}")
            run_caption(aitk_dir, caption_path)
            log.info("captioning done")

        # 3. seed the Job row, then 4. run the trainer — capturing run.py's output so a startup
        #    crash (the reason it exited) travels back in the failure instead of a bare exit code.
        seed_job_row(db_path, job_id, gpu_ids)
        run_log = os.path.join(aitk_dir, f"{job_id}.runlog")
        log.info(f"launching run.py {config_path} (job={job_id}, steps={steps}) → {run_log}")
        run_fh = open(run_log, "wb")
        proc = subprocess.Popen(["python", "-u", "run.py", config_path], cwd=aitk_dir,
                                stdout=run_fh, stderr=subprocess.STDOUT)

        # 4b. poll the Job row → POST status until terminal (or the process dies). Each loop also
        #     RESCUES any new checkpoint off the ephemeral pod to R2 (overwrite-latest) and reports
        #     {url, step} on the status signal, so a hard kill is still resumable from durable storage.
        last_phase = None
        last_ckpt_step = 0
        while True:
            time.sleep(poll_s)
            row = read_job_row(db_path, job_id)

            checkpoint_sig = None
            ckpt_path, ckpt_step = latest_checkpoint(output_dir, job_id)
            if ckpt_path and ckpt_step > last_ckpt_step:
                try:
                    ckpt_url = _upload_to_r2(r2, ckpt_path, f"training/{job_id}/checkpoint.safetensors")
                    last_ckpt_step = ckpt_step
                    checkpoint_sig = {"url": ckpt_url, "step": ckpt_step}
                    log.info(f"rescued checkpoint step {ckpt_step} → {ckpt_url}")
                except Exception as e:  # noqa: BLE001
                    log.warning(f"checkpoint rescue failed (step {ckpt_step}): {e}")

            if row:
                signal = build_status_signal(actum_id, row, steps if steps > 0 else None)
                if checkpoint_sig:
                    signal["progressus"]["checkpoint"] = checkpoint_sig
                phase = signal["progressus"]["phase"]
                if phase != last_phase or phase == "executing" or checkpoint_sig:
                    _post_status(status_url, signal)
                    last_phase = phase
                if row.get("status") == "completed":
                    break
                if row.get("status") in ("error", "stopped"):
                    raise RuntimeError(f"training {row.get('status')} at step {row.get('step')}: "
                                       f"{row.get('info')} | run.py tail:\n{_tail(run_log)}")
            if proc.poll() is not None and (not row or row.get("status") not in ("running", "completed")):
                raise RuntimeError(f"run.py exited ({proc.returncode}) before completion | run.py tail:\n{_tail(run_log)}")

        # 5. upload the LoRA, then the end-of-run preview samples → fire the completion webhook.
        path = lora_path(output_dir, job_id)
        if not os.path.exists(path):
            raise RuntimeError(f"completed but no safetensors at {path}")
        url = _upload_to_r2(r2, path, f"training/{job_id}/{job_id}.safetensors")
        log.info(f"uploaded LoRA → {url}")

        # Preview samples — first-class previews on the Intella + the published card gallery.
        # Best-effort: a sampling/upload hiccup must never fail an otherwise-complete training.
        sample_urls = []
        for i, sp in enumerate(sample_paths(output_dir, job_id)):
            try:
                ext = os.path.splitext(sp)[1].lower() or ".jpg"
                sample_urls.append(_upload_to_r2(r2, sp, f"training/{job_id}/samples/{i:03d}{ext}"))
            except Exception as e:  # noqa: BLE001
                log.warning(f"sample upload failed ({sp}): {e}")
        log.info(f"uploaded {len(sample_urls)} preview samples")

        _send_webhook(webhook_url, build_webhook_payload(
            pod_id, "COMPLETED", lora_url=url, execution_time=int((time.time() - t0) * 1000), sample_urls=sample_urls))
        _post_status(status_url, {"actumId": actum_id, "progressus": {"phase": "done"}})
        log.info("done.")
        return 0
    except Exception as e:  # noqa: BLE001
        log.error(f"FAILED: {e}")
        # Best-effort final rescue: a graceful failure (run.py errored, pod still alive) gets one
        # last shot at the newest checkpoint — reported on the failed status so the resume anchor is
        # current. (A HARD kill never reaches here; the in-loop rescues above already cover it.)
        fail_prog = {"phase": "failed", "message": str(e)}
        try:
            ckpt_path, ckpt_step = latest_checkpoint(output_dir, job_id)
            if ckpt_path:
                ckpt_url = _upload_to_r2(r2, ckpt_path, f"training/{job_id}/checkpoint.safetensors")
                fail_prog["checkpoint"] = {"url": ckpt_url, "step": ckpt_step}
                log.info(f"rescued final checkpoint step {ckpt_step} → {ckpt_url}")
        except Exception as ce:  # noqa: BLE001
            log.warning(f"final checkpoint rescue failed: {ce}")
        _send_webhook(webhook_url, build_webhook_payload(pod_id, "FAILED", error=str(e)))
        _post_status(status_url, {"actumId": actum_id, "progressus": fail_prog})
        return 1


if __name__ == "__main__":
    sys.exit(main())
