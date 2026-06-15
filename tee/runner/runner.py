#!/usr/bin/env python3
"""
TEE Runner — generic compute executor.

Accepts an Essentia definition through the WireGuard tunnel and executes it
using the Fundamentum's launchTemplate. No model-specific or runtime-specific
code lives here — all specificity is in the Essentia+Fundamentum data.

Environment:
  SESSION_ID           assigned by platform at pod boot
  PLATFORM_CALLBACK    URL of platform stub (or real platform endpoint)
  RUNNER_BIND          address to bind the runner API (default: 10.13.0.1:7998)
  WG_INTERFACE         WireGuard interface name (default: wg-tee-server)
  WG_ENDPOINT          public endpoint returned to peers (default: 127.0.0.1:51820)
  ATTESTATION_STUB     set to "true" to skip hardware attestation (local dev)
"""

import asyncio
import logging
import os
import shlex
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass

import aiohttp
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [runner] %(message)s")
log = logging.getLogger(__name__)

SESSION_ID        = os.environ.get("SESSION_ID", "local-dev-session")
PLATFORM_CALLBACK = os.environ.get("PLATFORM_CALLBACK", "http://127.0.0.1:7999")
RUNNER_BIND       = os.environ.get("RUNNER_BIND", "10.13.0.1:7998")
WG_INTERFACE      = os.environ.get("WG_INTERFACE", "wg-tee-server")
WG_ENDPOINT       = os.environ.get("WG_ENDPOINT", "127.0.0.1:51820")
ATTESTATION_STUB  = os.environ.get("ATTESTATION_STUB", "true").lower() == "true"
HEARTBEAT_INTERVAL = int(os.environ.get("HEARTBEAT_INTERVAL", "60"))

session_start = time.time()
_next_port = 8000
_next_peer_octet = 2   # 10.13.0.2, .3, .4 …

managed: dict[str, "ServerProcess"] = {}


# — Process handle —

@dataclass
class ServerProcess:
    essentiaId: str
    port: int
    process: subprocess.Popen


def _stop(proc: ServerProcess):
    if proc.process.returncode is None:
        proc.process.terminate()
        try:
            proc.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.process.kill()


def _alloc_port() -> int:
    global _next_port
    p = _next_port
    _next_port += 1
    return p


# — Platform signals —

async def signal_ready():
    payload = {
        "sessionId": SESSION_ID,
        "endpoint": WG_ENDPOINT,
        "wgPublicKey": _read_wg_pubkey(),
        "attestation": "stub" if ATTESTATION_STUB else await _get_attestation(),
    }
    async with aiohttp.ClientSession() as s:
        async with s.post(f"{PLATFORM_CALLBACK}/runner/ready", json=payload) as r:
            log.info(f"ready → platform: {r.status}")


async def signal_heartbeat() -> bool:
    hours = (time.time() - session_start) / 3600
    payload = {"sessionId": SESSION_ID, "gpuHours": round(hours, 6), "status": "active"}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(f"{PLATFORM_CALLBACK}/runner/heartbeat", json=payload,
                              timeout=aiohttp.ClientTimeout(total=10)) as r:
                return (await r.json()).get("continue", True)
    except Exception as e:
        log.warning(f"heartbeat failed: {e} — continuing")
        return True


async def signal_ended(reason: str):
    hours = (time.time() - session_start) / 3600
    payload = {"sessionId": SESSION_ID, "gpuHours": round(hours, 6), "status": reason}
    async with aiohttp.ClientSession() as s:
        await s.post(f"{PLATFORM_CALLBACK}/runner/ended", json=payload)
    log.info(f"ended: {reason}")


async def _get_attestation() -> str:
    raise NotImplementedError("Hardware attestation requires a real TEE pod.")


# — Heartbeat loop —

async def _heartbeat_loop():
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        if not await signal_heartbeat():
            log.info("platform said stop — terminating")
            for proc in list(managed.values()):
                _stop(proc)
            managed.clear()
            await signal_ended("terminated")
            sys.exit(0)


# — API models —

class SetupRequest(BaseModel):
    essentiaId: str
    essentia: dict     # full EssentiaDefinition pushed inline by browser
    options: dict = {}


class StopRequest(BaseModel):
    essentiaId: str


class PeerRegisterRequest(BaseModel):
    wgPublicKey: str


# — App lifecycle —

@asynccontextmanager
async def lifespan(app: FastAPI):
    await signal_ready()
    task = asyncio.create_task(_heartbeat_loop())
    log.info(f"runner up — session {SESSION_ID}")
    yield
    task.cancel()
    for proc in list(managed.values()):
        _stop(proc)
    managed.clear()
    await signal_ended("ended")


app = FastAPI(lifespan=lifespan)


# — Endpoints —

@app.post("/peer/register")
async def peer_register(req: PeerRegisterRequest):
    global _next_peer_octet
    tunnel_ip = f"10.13.0.{_next_peer_octet}"
    _next_peer_octet += 1
    result = subprocess.run(
        ["wg", "set", WG_INTERFACE, "peer", req.wgPublicKey, "allowed-ips", f"{tunnel_ip}/32"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise HTTPException(500, f"wg set failed: {result.stderr.strip()}")
    log.info(f"registered peer {req.wgPublicKey[:12]}… → {tunnel_ip}")
    return {"serverPublicKey": _read_wg_pubkey(), "endpoint": WG_ENDPOINT, "tunnelIp": tunnel_ip}


@app.get("/peer/info")
async def peer_info():
    return {"serverPublicKey": _read_wg_pubkey(), "endpoint": WG_ENDPOINT}


@app.post("/setup")
async def setup(req: SetupRequest):
    if req.essentiaId in managed:
        raise HTTPException(400, f"{req.essentiaId} already running — stop it first")

    fund = req.essentia.get("fundamentum", {})
    port = _alloc_port()

    # 1. Install — no-op when image already has it; bare-metal/local-dev runs these
    for cmd in fund.get("install") or []:
        log.info(f"[install] {cmd}")
        await _run(shlex.split(cmd))

    # 2. Resolve model from intellae
    model = await _resolve_model(fund, req.options)

    # 3. Launch — fill launchTemplate vars, spawn process
    template = fund.get("launchTemplate", "")
    if not template:
        raise HTTPException(400, "fundamentum.launchTemplate is required")
    cmd_str = template.format(model=model, port=port, vramGb=fund.get("vramGb", 24))
    log.info(f"[launch] {cmd_str}")
    process = subprocess.Popen(shlex.split(cmd_str))

    # 4. Probe — poll readyProbe until HTTP 200
    probe = fund.get("readyProbe", "")
    if probe:
        await _probe_ready(probe.format(port=port))

    # 5. Form half — configure the running server from Essentia
    if req.essentia.get("workflowTemplate"):
        await _post_workflow(port, req.essentia["workflowTemplate"])
    elif req.essentia.get("script"):
        await _run_script(req.essentia["script"], req.options)
    # inferentia: no-op — server is ready for direct API calls

    managed[req.essentiaId] = ServerProcess(req.essentiaId, port, process)
    log.info(f"[setup] {req.essentiaId} ready on port {port}")
    return {"status": "ready", "essentiaId": req.essentiaId, "port": port}


@app.post("/stop")
async def stop(req: StopRequest):
    proc = managed.pop(req.essentiaId, None)
    if not proc:
        raise HTTPException(404, f"{req.essentiaId} not running")
    _stop(proc)
    return {"status": "stopped", "essentiaId": req.essentiaId}


@app.get("/status")
async def status():
    return {
        "essentiae": [
            {"essentiaId": p.essentiaId,
             "status": "running" if p.process.returncode is None else "stopped",
             "port": p.port}
            for p in managed.values()
        ],
        "gpu": _gpu_stats(),
        "sessionId": SESSION_ID,
        "gpuHours": round((time.time() - session_start) / 3600, 6),
    }


@app.get("/health")
async def health():
    return {"ok": True}


# — Helpers —

async def _resolve_model(fund: dict, options: dict) -> str:
    intellae = fund.get("intellae") or []
    if not intellae:
        return options.get("model", "")
    model_id = intellae[0]["id"]
    if os.path.isabs(model_id):
        return model_id   # local absolute path — use as-is
    if model_id.count("/") >= 2 and model_id.endswith(".gguf"):
        return await _download_gguf(model_id)
    return model_id       # HuggingFace ID — vLLM/llama-server pull it themselves


async def _probe_ready(probe: str, timeout: int = 120):
    _method, url = probe.split(" ", 1)
    deadline = time.time() + timeout
    async with aiohttp.ClientSession() as s:
        while time.time() < deadline:
            try:
                async with s.get(url) as r:
                    if r.status == 200:
                        return
            except Exception:
                pass
            await asyncio.sleep(2)
    raise TimeoutError(f"readyProbe {probe!r} did not return 200 within {timeout}s")


async def _post_workflow(port: int, template: dict):
    async with aiohttp.ClientSession() as s:
        async with s.post(f"http://127.0.0.1:{port}/prompt", json={"prompt": template}) as r:
            log.info(f"[form] workflow posted: {r.status}")


async def _run_script(script: dict, options: dict):
    repo = script.get("repo", "")
    dest = f"/tmp/modelcard/{repo.rstrip('/').split('/')[-1]}"
    if not os.path.exists(dest):
        await _run(["git", "clone", repo, dest])
    await _run(shlex.split(script.get("install", "pip install -e . -q")), cwd=dest)
    for key, path in (script.get("fileInputs") or {}).items():
        full = os.path.join(dest, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "w").write(str(options.get(key, "")))
    for path, content in (script.get("fixedFiles") or {}).items():
        full = os.path.join(dest, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "w").write(content)
    args = [*shlex.split(script["entry"]), *(script.get("fixedArgs") or [])]
    for key, flag in (script.get("argMap") or {}).items():
        if key in options:
            args += [flag, str(options[key])]
    await _run(args, cwd=dest)


async def _run(cmd: list[str], cwd: str = None):
    proc = await asyncio.create_subprocess_exec(*cmd, cwd=cwd)
    rc = await proc.wait()
    if rc != 0:
        raise RuntimeError(f"command failed (rc={rc}): {' '.join(cmd)}")


async def _download_gguf(model: str) -> str:
    parts = model.split("/")
    filename = parts[-1]
    dest = f"/tmp/models/{filename}"
    os.makedirs("/tmp/models", exist_ok=True)
    if os.path.exists(dest):
        log.info(f"model cached at {dest}")
        return dest
    try:
        await _run(["huggingface-cli", "download", "/".join(parts[:-1]), filename, "--local-dir", "/tmp/models"])
    except Exception:
        url = f"https://huggingface.co/{'/'.join(parts[:-1])}/resolve/main/{filename}"
        await _run(["wget", "-O", dest, url])
    return dest


def _read_wg_pubkey() -> str:
    if ATTESTATION_STUB:
        try:
            return open("/tmp/tee-wg-server.pub").read().strip()
        except FileNotFoundError:
            return "LOCAL_DEV_NO_WG_KEY"
    return subprocess.run(
        ["wg", "show", WG_INTERFACE, "public-key"], capture_output=True, text=True
    ).stdout.strip()


def _gpu_stats() -> dict:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True,
        ).stdout.strip()
        util, used, total = out.split(", ")
        return {"utilizationPct": int(util),
                "vramUsedGiB": round(int(used) / 1024, 2),
                "vramTotalGiB": round(int(total) / 1024, 2)}
    except Exception:
        return {}


if __name__ == "__main__":
    host, port = RUNNER_BIND.rsplit(":", 1)
    uvicorn.run(app, host=host, port=int(port), log_level="info")
