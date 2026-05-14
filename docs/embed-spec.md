# Vestigium Embedding — Design Spec

**Status:** Specced, not implemented  
**Last updated:** 2026-05-14  
**Scope:** Self-hosted CLIP embedding service + wiring into vestigium pipeline + backfill migration

---

## Problem

`vestigiumHook.ts` fires three index calls fire-and-forget after every completed actum:

```ts
vestigiorum.indexPromptum(v.id).catch(() => {})   // "I remember what I typed"
vestigiorum.indexImago(v.id).catch(() => {})       // "I remember what it looked like"
vestigiorum.indexIntella(v.id).catch(() => {})     // "I remember which model I used"
```

`MongoVestigiorum` silently no-ops all three because `embed` and `embedImage` are never passed to `createContainer()` in `index.ts`. Every vestigium is stored with empty embedding fields. Search works only by metadata filters — not semantically.

Two distinct goals:
1. **New vestigia** — embed automatically on every completed actum going forward
2. **Old vestigia** — backfill existing records in the DB for the full corpus

---

## Model Choice: OpenCLIP ViT-B/32

**Why CLIP specifically:**  
CLIP (Contrastive Language-Image Pretraining) encodes both text and images into the *same* vector space. This means:
- `embeddingPromptum` (text) and `embeddingImago` (image) are **directly comparable** — you can search images by typing text and get visual matches, even if the prompt used to generate them was different
- "I remember what it looked like" works with a text query describing the visual, not just matching keywords from the original prompt

**Why ViT-B/32 specifically:**  
- 150MB on disk — no GPU required for inference
- ~50ms per request on CPU
- 512-dimensional output vectors for both text and image
- `openclip` ViT-B/32 trained on LAION-2B is the canonical small CLIP baseline
- Well-supported, no licensing issues

**Dimension:** 512 floats per vector. This is fixed — Atlas Search indexes must be built to this dimension.

**Not using:** OpenAI's embedding API (no image support), sentence-transformers text-only models (can't compare to image embeddings), larger CLIP variants (unnecessary for this use case).

---

## Service Design

A minimal Python HTTP service wrapping OpenCLIP inference.

### Endpoints

```
POST /embed/text
Body: { "text": "a cat on a beach at sunset" }
Response: { "embedding": [0.021, -0.134, ..., 0.087] }   # 512 floats
```

```
POST /embed/image
Body: { "url": "https://cdn.noema.io/outputs/abc123.png" }
Response: { "embedding": [0.021, -0.134, ..., 0.087] }   # 512 floats
```

Both endpoints return a 512-float array. Both live in the same embedding space.

### Error responses

```
{ "error": "text must be non-empty" }           # 400
{ "error": "failed to fetch image: 404" }       # 422
{ "error": "internal error" }                   # 500
```

### Implementation notes

```python
# requirements: open-clip-torch, fastapi, uvicorn, Pillow, httpx
import open_clip, torch, httpx
from PIL import Image
from io import BytesIO
from fastapi import FastAPI

model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')
tokenizer = open_clip.get_tokenizer('ViT-B-32')
model.eval()

@app.post('/embed/text')
async def embed_text(body: TextRequest):
    tokens = tokenizer([body.text])
    with torch.no_grad():
        vec = model.encode_text(tokens)
        vec = vec / vec.norm(dim=-1, keepdim=True)  # L2 normalise
    return { 'embedding': vec[0].tolist() }

@app.post('/embed/image')
async def embed_image(body: ImageRequest):
    img_bytes = await httpx.AsyncClient().get(body.url)
    img = preprocess(Image.open(BytesIO(img_bytes.content))).unsqueeze(0)
    with torch.no_grad():
        vec = model.encode_image(img)
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return { 'embedding': vec[0].tolist() }
```

Vectors are L2-normalised before returning — cosine similarity is then equivalent to dot product, which is what Atlas Vector Search computes.

### Deployment

Runs as a Docker container alongside the main server. CPU-only — no GPU required.

```dockerfile
FROM python:3.11-slim
RUN pip install open-clip-torch fastapi uvicorn[standard] Pillow httpx
COPY clip_service.py .
# First run downloads the model (~150MB) — pre-download in build for prod:
RUN python -c "import open_clip; open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')"
CMD ["uvicorn", "clip_service:app", "--host", "0.0.0.0", "--port", "8080"]
```

Environment variable: `CLIP_SERVICE_URL=http://localhost:8080` (or the service hostname in Docker compose)

---

## Integration: index.ts

When `CLIP_SERVICE_URL` is set, build `embed` and `embedImage` functions and pass them to `createContainer`:

```ts
const CLIP_SERVICE_URL = process.env.CLIP_SERVICE_URL

let embed: ((text: string) => Promise<number[]>) | undefined
let embedImage: ((url: string) => Promise<number[]>) | undefined

if (CLIP_SERVICE_URL) {
  embed = async (text: string) => {
    const res = await fetch(`${CLIP_SERVICE_URL}/embed/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(`CLIP service embed/text failed: ${res.status}`)
    return (await res.json() as { embedding: number[] }).embedding
  }

  embedImage = async (url: string) => {
    const res = await fetch(`${CLIP_SERVICE_URL}/embed/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) throw new Error(`CLIP service embed/image failed: ${res.status}`)
    return (await res.json() as { embedding: number[] }).embedding
  }
}

// In createContainer call:
...(embed ? { embed } : {}),
...(embedImage ? { embedImage } : {}),
```

`vestigiumHook.ts` already fires the index calls fire-and-forget. No changes needed there — once `embed`/`embedImage` are present, they start working automatically.

---

## Atlas Vector Search Indexes

Three separate vector search indexes are required on the `vestigia` collection. Each maps to one embedding field.

```json
// embeddingPromptum index
{
  "fields": [{
    "type": "vector",
    "path": "embeddingPromptum",
    "numDimensions": 512,
    "similarity": "cosine",
    "filters": [{ "type": "filter", "path": "visibilitas" }]
  }]
}
```

Same structure for `embeddingImago` and `embeddingIntella` — just change `path`.

The in-memory cosine fallback in `MongoVestigiorum.search()` works for small datasets and local dev. The `$vectorSearch` replacement (marked TODO in the code) should be wired in once these indexes exist on Atlas.

---

## Migration / Backfill

Script: `scripts/migration/backfill-vestigia-embeddings.ts`

Strategy:
- Find all vestigia where `embeddingPromptum` is absent → call `indexPromptum`
- Find all vestigia where `embeddingIntella` is absent and `intellaDescription` exists → call `indexIntella`
- Find all vestigia where `embeddingImago` is absent and `imagoUrl` exists → call `indexImago`
- Resume-safe: already-indexed records are skipped
- Rate-limited: 100ms delay between requests to avoid overloading the service
- Dry-run mode: `--dry-run` reports counts without writing

The script requires `CLIP_SERVICE_URL` and connects directly to MongoDB. It instantiates `MongoVestigiorum` with the embed functions and calls the existing `index*` methods — no new write paths needed.

---

## Open Questions

1. **Service location in prod**: Single instance on the app server, or a dedicated container? The app server is the simplest starting point; promote to a dedicated instance if embed latency becomes a bottleneck.

2. **Image fetch auth**: `indexImago` calls `embedImage(v.imagoUrl)`. If `imagoUrl` is an S3 pre-signed URL, it may expire before backfill runs. The backfill script should generate fresh URLs or skip expired ones.

3. **`$vectorSearch` migration**: The current `search()` does a full collection scan. Once Atlas Search indexes are live, the `// TODO: replace with $vectorSearch` comment in `MongoVestigiorum.search()` needs to be implemented. This is a separate task from wiring the embed functions.

4. **Model upgrade path**: ViT-B/32 at 512 dims is the starting point. Moving to ViT-L/14 (768 dims) or SigLIP (1152 dims) would require re-embedding all vestigia and updating the Atlas index dimension — not a trivial migration. Commit to the dimension you want before building the Atlas indexes.

---

## Files to create/modify

| File | Change |
|------|--------|
| `clip_service/clip_service.py` | New — the FastAPI service |
| `clip_service/Dockerfile` | New — service container |
| `clip_service/requirements.txt` | New |
| `src/index.ts` | Wire `embed` / `embedImage` from `CLIP_SERVICE_URL` |
| `scripts/migration/backfill-vestigia-embeddings.ts` | New — backfill script |
| `docs/atlas-indexes.md` | New (or update) — Atlas Search index definitions |
