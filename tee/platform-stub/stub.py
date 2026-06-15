#!/usr/bin/env python3
"""
Platform stub — receives lifecycle signals from the TEE runner during local validation.

In production these signals go to our REST allocutio and trigger Signorum settle/lock.
Here they just log and respond, so the runner can complete its flow.

Runs on http://127.0.0.1:7999
"""

import logging
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [platform] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI()

# Flip to False to simulate credit exhaustion and test graceful teardown
CREDITS_OK = True


class ReadySignal(BaseModel):
    sessionId: str
    endpoint: str
    wgPublicKey: str
    attestation: str = ""


class HeartbeatSignal(BaseModel):
    sessionId: str
    gpuHours: float
    status: str


class EndedSignal(BaseModel):
    sessionId: str
    gpuHours: float
    status: str


@app.post("/runner/ready")
async def runner_ready(signal: ReadySignal):
    log.info(f"READY  session={signal.sessionId} endpoint={signal.endpoint} pubkey={signal.wgPublicKey[:16]}...")
    return {"ok": True}


@app.post("/runner/heartbeat")
async def runner_heartbeat(signal: HeartbeatSignal):
    log.info(f"HEARTBEAT  session={signal.sessionId} gpuHours={signal.gpuHours:.4f}")
    return {"continue": CREDITS_OK}


@app.post("/runner/ended")
async def runner_ended(signal: EndedSignal):
    log.info(f"ENDED  session={signal.sessionId} gpuHours={signal.gpuHours:.4f} reason={signal.status}")
    return {"ok": True}


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=7999, log_level="info")
