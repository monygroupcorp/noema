#!/usr/bin/env python3
"""
captioner.py — pod-side caption pass (remote arm of the dataset caption modus).

A caption pass loads one vision-language model and runs a bounded forward pass per media
item. That is the whole job, so this script carries the whole job and nothing else: it needs
transformers, a torch runtime (already on the base image) and boto3, and it neither clones nor
imports a training toolkit.

The host launcher (CaptionPodLauncher) provisions a pod, SSH-bootstraps this script and hands
it everything via env. On boot it:

  1. parses the dataset MANIFEST (NOEMA_MANIFEST_B64 = [{url, id}]) — one entry per media item
  2. loads the captioner model named by NOEMA_CAPTION_MODEL (a load failure FAILS the run:
     see below)
  3. downloads and captions EVERY manifest entry, posting periodic progress to
     NOEMA_STATUS_URL keyed by NOEMA_ACTUM_ID
  4. writes the collected `{media id: caption}` map as one JSON object, uploads it to
     `captions/<job>/captions.json` in R2 and fires the completion webhook
     {id, status:'COMPLETED', output:[{url}], executionTime}; on error → FAILED.

Three properties this file owns, each bound by a test in `test_captioner.py`:

  · THE WALK IS THE WHOLE SET. Every manifest entry is captioned. A pass that captioned only
    part of the set would change what coverage means and what the run charges for, while still
    reporting success.

  · IDENTITY IS ECHOED, NEVER COMPUTED. Each caption is keyed by the `id` the manifest carried
    for that item. An item with no id, or with no caption produced for it, is OMITTED from the
    map and COUNTED, so the host sees honest coverage instead of a silently short map. No id is
    ever invented.

  · A MODEL THAT WILL NOT LOAD FAILS THE RUN. The map is only uploaded after the walk, and the
    walk only begins after the model is loaded. An empty-but-well-formed map would validate at
    the host and settle as a completed pass that captioned nothing.

The `{media id: caption}` map, the R2 key and the webhook payload are the host's existing
contract (captionFinalizer) and are matched exactly; nothing host-side changes for this script.

Run (on the pod, via the bootstrap):
  NOEMA_JOB_ID=job-1 NOEMA_MANIFEST_B64=... python3 /root/captioner.py

Tests:  python3 -m unittest test_captioner   (from scripts/pod)
"""

import base64
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(asctime)s captioner %(levelname)s %(message)s")
log = logging.getLogger("captioner")

_IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

#: Captioner model when the launcher names none.
DEFAULT_MODEL = "Qwen/Qwen3-VL-8B-Instruct"

#: Caption instruction when the launcher names none — one dense, comma-separated caption.
DEFAULT_PROMPT = (
    "Describe this image in one dense, comma-separated caption — subject, attributes, style, and "
    "composition. No preamble, no markdown, no quotes."
)

DEFAULT_MAX_NEW_TOKENS = 256


# ─────────────────────────────────────────────────────────────────────────────
# HTTP seams (injectable in tests) — mirror aitktrainer.py
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
    """Fire-and-forget a /runner/status Progressus — a status hiccup never kills a pass."""
    if not url:
        return
    try:
        _http_post(url, signal, timeout=10)
    except Exception as e:  # noqa: BLE001
        log.warning(f"status post failed (ignored): {e}")


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "noema-captioner"})
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
        client.put_object(Bucket=r2["bucket"], Key=key, Body=f, ContentType="application/json")
    base = (r2.get("publicUrl") or f"https://{r2['bucket']}.r2.dev").rstrip("/")
    return f"{base}/{key}"


# ─────────────────────────────────────────────────────────────────────────────
# Pure helpers — the wire contract (unit-tested)
# ─────────────────────────────────────────────────────────────────────────────

def parse_manifest(raw: str) -> list:
    """Parse the dataset manifest — a JSON array of {url, id}. Raises on a bad shape.

    `id` is optional on the wire (an item without one is carried through and omitted from the
    harvest, counted), but `url` is required: an entry with nothing to fetch is a malformed
    manifest, not a media item to skip."""
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or not parsed:
        raise ValueError("manifest must be a non-empty JSON array")
    out = []
    for item in parsed:
        url = item.get("url") if isinstance(item, dict) else None
        if not isinstance(url, str) or not url:
            raise ValueError(f"manifest item missing url: {item!r}")
        entry = {"url": url}
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


def caption_key(job_id: str) -> str:
    """R2 key the caption map lands under — the key the host finalizer reads back."""
    return f"captions/{job_id}/captions.json"


def build_status_signal(actum_id: str, done: int, total: int) -> dict:
    """The /runner/status Progressus for a pass in flight — same taxonomy the trainer posts."""
    return {"actumId": actum_id,
            "progressus": {"phase": "executing", "progress": {"done": done, "total": total, "unit": "images"}}}


def build_webhook_payload(pod_id: str, status: str, captions_url=None, execution_time=0, error=None) -> dict:
    """The completion webhook body — matches RunPodPayload (executionWebhook.ts). COMPLETED
    carries the caption map's URL in output[0], which is where the caption finalizer reads it."""
    if status == "COMPLETED":
        output = [{"url": captions_url}] if captions_url else []
        return {"id": pod_id, "status": "COMPLETED", "output": output, "executionTime": execution_time}
    return {"id": pod_id, "status": "FAILED", "error": error or "captioning failed"}


def caption_manifest(manifest: list, work_dir: str, caption_one, fetch=_download, on_progress=None):
    """Caption EVERY item in the manifest → ({media id: caption}, uncollected).

    The walk is total by construction: it iterates the manifest itself, so there is no gap count,
    no sidecar-presence check and no other way for an item to be skipped before it is attempted.
    A per-item download or caption failure is logged and counted rather than aborting the pass —
    one unreadable media item does not cost the other captions — while a failure that affects the
    whole pass (the model itself) is raised by the caller before this walk begins.

    An item with no `id`, or for which no non-empty caption was produced, is OMITTED and COUNTED.
    """
    os.makedirs(work_dir, exist_ok=True)
    captions = {}
    uncollected = 0
    total = len(manifest)
    for i, item in enumerate(manifest):
        media_id = item.get("id")
        text = ""
        try:
            path = os.path.join(work_dir, f"{i:04d}{_ext_for(item['url'])}")
            fetch(item["url"], path)
            text = (caption_one(path) or "").strip()
        except Exception as e:  # noqa: BLE001
            log.warning(f"item {i + 1}/{total} not captioned: {e}")
        if not isinstance(media_id, str) or not media_id or not text:
            uncollected += 1
        else:
            captions[media_id] = text
        if on_progress:
            on_progress(i + 1, total)
    return captions, uncollected


# ─────────────────────────────────────────────────────────────────────────────
# The model — the untestable shell (GPU + weights)
# ─────────────────────────────────────────────────────────────────────────────

def load_captioner(model_name: str, prompt: str, max_new_tokens: int):
    """Load the VL model and return `caption_one(path) -> str`.

    Raises if the model cannot be loaded. The caller lets that failure fail the run: a pass whose
    model never loaded has nothing to say about any image, and an empty map uploaded in its place
    would validate at the host and settle as a completed pass.
    """
    import torch
    from PIL import Image
    from transformers import AutoModelForImageTextToText, AutoProcessor

    log.info(f"loading captioner {model_name}")
    processor = AutoProcessor.from_pretrained(model_name)
    model = AutoModelForImageTextToText.from_pretrained(
        model_name, dtype=torch.bfloat16, device_map="auto")
    model.eval()
    log.info("captioner ready")

    def caption_one(path: str) -> str:
        image = Image.open(path).convert("RGB")
        messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt}]}]
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = processor(text=[text], images=[image], return_tensors="pt").to(model.device)
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
        trimmed = generated[0][inputs["input_ids"].shape[1]:]
        return processor.decode(trimmed, skip_special_tokens=True).strip()

    return caption_one


# ─────────────────────────────────────────────────────────────────────────────
# The job — drive the pass (seams injected, so the ordering is testable)
# ─────────────────────────────────────────────────────────────────────────────

def run_caption_job(cfg: dict, loader=load_captioner, fetch=_download, upload=_upload_to_r2,
                    send_webhook=_send_webhook, post_status=_post_status) -> int:
    """Load → caption the whole manifest → upload the map → report. Returns a process exit code.

    The ORDER here is the contract: the model is loaded before the walk and the map is uploaded
    only after it, so no failure short of a completed walk can produce an upload.
    """
    t0 = time.time()
    actum_id = cfg["actumId"]
    status_url = cfg["statusUrl"]
    try:
        manifest = parse_manifest(cfg["manifest"])
        total = len(manifest)
        post_status(status_url, {"actumId": actum_id,
                                 "progressus": {"phase": "downloading", "target": "model"}})
        caption_one = loader(cfg["model"], cfg["prompt"], cfg["maxNewTokens"])

        post_status(status_url, build_status_signal(actum_id, 0, total))
        last = [0.0]

        def on_progress(done: int, n: int) -> None:
            # Bounded chatter: a heartbeat at most every few seconds, plus the final item.
            now = time.time()
            if done == n or now - last[0] >= 5:
                last[0] = now
                post_status(status_url, build_status_signal(actum_id, done, n))

        captions, uncollected = caption_manifest(manifest, cfg["workDir"], caption_one,
                                                 fetch=fetch, on_progress=on_progress)
        log.info(f"captioned {len(captions)} of {total} items ({uncollected} not collected)")

        os.makedirs(cfg["workDir"], exist_ok=True)
        harvest_path = os.path.join(cfg["workDir"], "captions.json")
        with open(harvest_path, "w", encoding="utf-8") as f:
            json.dump(captions, f, ensure_ascii=False)
        url = upload(cfg["r2"], harvest_path, caption_key(cfg["jobId"]))
        log.info(f"uploaded captions → {url}")

        send_webhook(cfg["webhookUrl"], build_webhook_payload(
            cfg["podId"], "COMPLETED", captions_url=url, execution_time=int((time.time() - t0) * 1000)))
        post_status(status_url, {"actumId": actum_id, "progressus": {"phase": "done"}})
        log.info("done.")
        return 0
    except Exception as e:  # noqa: BLE001
        log.error(f"FAILED: {e}")
        send_webhook(cfg["webhookUrl"], build_webhook_payload(cfg["podId"], "FAILED", error=str(e)))
        post_status(status_url, {"actumId": actum_id,
                                 "progressus": {"phase": "failed", "message": str(e)}})
        return 1


def config_from_env(environ) -> dict:
    """Read the launcher's env into the job config. Config rides as environment variables — the
    caption pod parses no toolkit config format."""
    def get(name, default=None, required=False):
        v = environ.get(name, default)
        if required and not v:
            raise RuntimeError(f"missing required env {name}")
        return v

    job_id = get("NOEMA_JOB_ID", required=True)
    raw_tokens = get("NOEMA_CAPTION_MAX_NEW_TOKENS", "") or ""
    return {
        "jobId": job_id,
        "podId": get("RUNPOD_POD_ID", "") or job_id,
        "workDir": get("NOEMA_WORK_DIR", "/caption"),
        "manifest": base64.b64decode(get("NOEMA_MANIFEST_B64", required=True)).decode("utf-8"),
        "model": get("NOEMA_CAPTION_MODEL", "") or DEFAULT_MODEL,
        "prompt": get("NOEMA_CAPTION_PROMPT", "") or DEFAULT_PROMPT,
        "maxNewTokens": int(raw_tokens) if raw_tokens.strip().isdigit() else DEFAULT_MAX_NEW_TOKENS,
        "actumId": get("NOEMA_ACTUM_ID", "") or "",
        "statusUrl": get("NOEMA_STATUS_URL", "") or "",
        "webhookUrl": get("NOEMA_WEBHOOK_URL", required=True),
        "r2": {
            "endpoint": get("R2_ENDPOINT", required=True),
            "accessKeyId": get("R2_ACCESS_KEY_ID", required=True),
            "secretAccessKey": get("R2_SECRET_ACCESS_KEY", required=True),
            "bucket": get("R2_BUCKET_NAME", required=True),
            "publicUrl": get("R2_PUBLIC_URL", "") or "",
        },
    }


def main() -> int:
    return run_caption_job(config_from_env(os.environ))


if __name__ == "__main__":
    sys.exit(main())
