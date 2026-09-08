"""
CLIP embedding service — OpenCLIP ViT-B/32 (512-dim, L2-normalised).

Text and image embeddings live in the same vector space: cosine similarity
between a text embed and an image embed is meaningful. That's the point.

Endpoints:
  GET  /health                  open — readiness, and whether the token gate is armed
  POST /embed/text              { "text": str }
  POST /embed/text/batch        { "texts": [str, …] }   (max 64)
  POST /embed/image             { "url": str }
  POST /embed/image/batch       { "urls": [str, …] }    (max 16)

All responses: { "embedding": [512 floats] } or { "embeddings": [[…], …] }
Vectors are L2-normalised — cosine similarity == dot product.

AUTH. Set CLIP_JOB_TOKEN and every /embed route requires `Authorization: Bearer
<token>`; anything else is 401. The service is reached over a public proxy hostname,
so without the token every embed route is an open inference endpoint that will also
fetch any URL it is handed. /health stays open: it is what a provisioner polls before
it has any standing to ask for work, and it reports whether the gate is armed so a
service that came up with an unset token can be caught rather than used.

Unset, the gate is OFF and the service behaves exactly as it did before — that is the
in-cluster deployment, reachable only on a private network.
"""

import asyncio
import logging
import os
import secrets
from contextlib import asynccontextmanager
from io import BytesIO

import httpx
import open_clip
import torch
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

JOB_TOKEN    = os.environ.get("CLIP_JOB_TOKEN", "").strip()

MODEL_NAME   = "ViT-B-32"
PRETRAINED   = "openai"
DIMS         = 512
MAX_TEXT_BATCH  = 64
MAX_IMAGE_BATCH = 16   # each image is fetched over the network
IMAGE_FETCH_TIMEOUT_S = 15

# ── Globals (loaded once at startup via lifespan) ─────────────────────────────

_model     = None
_preprocess = None
_tokenizer  = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _model, _preprocess, _tokenizer
    log.info("Loading %s (%s)…", MODEL_NAME, PRETRAINED)
    _model, _, _preprocess = open_clip.create_model_and_transforms(
        MODEL_NAME, pretrained=PRETRAINED
    )
    _tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    _model.eval()
    log.info("Model ready — dims=%d, embed routes %s", DIMS, "token-gated" if JOB_TOKEN else "OPEN")
    yield
    log.info("Shutting down")


app = FastAPI(title="noema-clip", lifespan=lifespan)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalise(t: torch.Tensor) -> list:
    """L2-normalise a (N, D) batch → nested list of floats."""
    n = t / t.norm(dim=-1, keepdim=True)
    return n.tolist()


async def _fetch_image(url: str) -> Image.Image:
    async with httpx.AsyncClient(timeout=IMAGE_FETCH_TIMEOUT_S) as client:
        try:
            r = await client.get(url, follow_redirects=True)
        except httpx.TimeoutException:
            raise HTTPException(422, f"timed out fetching image: {url}")
        except httpx.RequestError as e:
            raise HTTPException(422, f"network error fetching image: {e}")
    if r.status_code != 200:
        raise HTTPException(422, f"image fetch returned HTTP {r.status_code}: {url}")
    try:
        return Image.open(BytesIO(r.content)).convert("RGB")
    except UnidentifiedImageError:
        raise HTTPException(422, f"URL did not return a recognisable image: {url}")


# ── Auth ──────────────────────────────────────────────────────────────────────

def require_job_token(request: Request) -> None:
    """Refuse an embed request that does not carry the pod's job token.

    A no-op when CLIP_JOB_TOKEN is unset (private-network deployment). Compared with
    `secrets.compare_digest` so a wrong token takes the same time as a right one, and
    the 401 body names no token — neither the one sent nor the one expected.
    """
    if not JOB_TOKEN:
        return
    header = request.headers.get("authorization", "")
    scheme, _, presented = header.partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(presented.strip(), JOB_TOKEN):
        raise HTTPException(401, "a valid job token is required")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    # `auth` is what a provisioner checks before it hands the pod any work: "token" says
    # the gate is armed, "open" says this service would embed for anyone who reaches it.
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "pretrained": PRETRAINED,
        "dims": DIMS,
        "auth": "token" if JOB_TOKEN else "open",
    }


# ── Text endpoints ────────────────────────────────────────────────────────────

class TextReq(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must be non-empty")
        return v


class TextBatchReq(BaseModel):
    texts: list[str]

    @field_validator("texts")
    @classmethod
    def validate_list(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("texts must not be empty")
        if len(v) > MAX_TEXT_BATCH:
            raise ValueError(f"batch size {len(v)} exceeds maximum {MAX_TEXT_BATCH}")
        for i, t in enumerate(v):
            if not t.strip():
                raise ValueError(f"texts[{i}] is empty")
        return v


@app.post("/embed/text", dependencies=[Depends(require_job_token)])
def embed_text(body: TextReq):
    tokens = _tokenizer([body.text])
    with torch.inference_mode():
        vecs = _model.encode_text(tokens)
    return {"embedding": _normalise(vecs)[0]}


@app.post("/embed/text/batch", dependencies=[Depends(require_job_token)])
def embed_text_batch(body: TextBatchReq):
    tokens = _tokenizer(body.texts)
    with torch.inference_mode():
        vecs = _model.encode_text(tokens)
    return {"embeddings": _normalise(vecs)}


# ── Image endpoints ───────────────────────────────────────────────────────────

class ImageReq(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("url must be non-empty")
        return v


class ImageBatchReq(BaseModel):
    urls: list[str]

    @field_validator("urls")
    @classmethod
    def validate_list(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("urls must not be empty")
        if len(v) > MAX_IMAGE_BATCH:
            raise ValueError(f"batch size {len(v)} exceeds maximum {MAX_IMAGE_BATCH}")
        return v


@app.post("/embed/image", dependencies=[Depends(require_job_token)])
async def embed_image(body: ImageReq):
    img = await _fetch_image(body.url)
    tensor = _preprocess(img).unsqueeze(0)
    with torch.inference_mode():
        vecs = _model.encode_image(tensor)
    return {"embedding": _normalise(vecs)[0]}


@app.post("/embed/image/batch", dependencies=[Depends(require_job_token)])
async def embed_image_batch(body: ImageBatchReq):
    # Fetch all images concurrently, then run a single batched forward pass
    images = await asyncio.gather(*[_fetch_image(url) for url in body.urls])
    tensors = torch.stack([_preprocess(img) for img in images])
    with torch.inference_mode():
        vecs = _model.encode_image(tensors)
    return {"embeddings": _normalise(vecs)}


# ── Validation error → 400 ────────────────────────────────────────────────────

from fastapi.exceptions import RequestValidationError

@app.exception_handler(RequestValidationError)
async def validation_error_handler(_req, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={"error": "; ".join(str(e["msg"]) for e in exc.errors())},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
