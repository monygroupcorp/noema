# Vestigium Embedding — Design Spec

**Status:** Implemented (vestigium embedding stack shipped; see `src/api/vestigia/`, `src/execution/hooks/`, `src/crystal/`, `scripts/corpus-space/`)  
**Last updated:** 2026-07-07  
**Scope:** Self-hosted CLIP embedding service + search API + smart migration

---

## Model: OpenCLIP ViT-B/32 — locked in

512-dimensional vectors. Committed. If we upgrade the model later we re-embed everything and rebuild Atlas indexes — that's fine, old vestigia are all the same content anyway.

**Why this model:**
- 150MB on disk, CPU inference (~50ms), no GPU required
- Text and image embeddings live in the **same vector space** — this is the whole point
- "I remember what it looked like" works by typing a text description and getting visual matches, even if the original prompt was completely different
- No licensing issues, well-supported via `open-clip-torch`

**Dimension is fixed at 512.** Atlas Search indexes are built to this number. Document it and don't change it without re-embedding everything.

---

## Service Design

A minimal Python FastAPI service. Runs as a Docker container alongside the main server. CPU-only.

### Endpoints

```
POST /embed/text
Body: { "text": "a cat on a beach at sunset" }
Response: { "embedding": [0.021, -0.134, ..., 0.087] }   # 512 floats, L2-normalised

POST /embed/image
Body: { "url": "https://cdn.noema.io/outputs/abc123.png" }
Response: { "embedding": [0.021, -0.134, ..., 0.087] }   # 512 floats, L2-normalised
```

Vectors are L2-normalised before returning. Cosine similarity = dot product.

### Error codes

```
400  text/url empty or missing
422  failed to fetch image (404, timeout, etc.)
500  model inference error
```

### Implementation sketch

```python
# requirements: open-clip-torch, fastapi, uvicorn[standard], Pillow, httpx
import open_clip, torch, httpx
from PIL import Image
from io import BytesIO
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')
tokenizer = open_clip.get_tokenizer('ViT-B-32')
model.eval()

class TextReq(BaseModel): text: str
class ImageReq(BaseModel): url: str

def normalise(vec): return (vec / vec.norm(dim=-1, keepdim=True)).squeeze(0).tolist()

@app.post('/embed/text')
async def embed_text(body: TextReq):
    if not body.text.strip():
        raise HTTPException(400, 'text must be non-empty')
    with torch.no_grad():
        return { 'embedding': normalise(model.encode_text(tokenizer([body.text]))) }

@app.post('/embed/image')
async def embed_image(body: ImageReq):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(body.url)
        if r.status_code != 200:
            raise HTTPException(422, f'failed to fetch image: {r.status_code}')
    img = preprocess(Image.open(BytesIO(r.content))).unsqueeze(0)
    with torch.no_grad():
        return { 'embedding': normalise(model.encode_image(img)) }
```

### Dockerfile

```dockerfile
FROM python:3.11-slim
RUN pip install --no-cache-dir open-clip-torch fastapi uvicorn[standard] Pillow httpx
WORKDIR /app
COPY clip_service.py .
# Pre-download model weights at build time (~150MB)
RUN python -c "import open_clip; open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')"
CMD ["uvicorn", "clip_service:app", "--host", "0.0.0.0", "--port", "8080"]
```

**Files:** `clip_service/clip_service.py`, `clip_service/Dockerfile`, `clip_service/requirements.txt`

---

## Integration: index.ts

When `CLIP_SERVICE_URL` is set, build `embed` and `embedImage` and pass them to `createContainer`. No changes to `vestigiumHook.ts` needed — it already fires the three index calls fire-and-forget.

```ts
const CLIP_SERVICE_URL = process.env.CLIP_SERVICE_URL

let embed: ((text: string) => Promise<number[]>) | undefined
let embedImage: ((url: string) => Promise<number[]>) | undefined

if (CLIP_SERVICE_URL) {
  const clipPost = async (path: string, body: unknown): Promise<number[]> => {
    const res = await fetch(`${CLIP_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`CLIP service ${path} failed: ${res.status}`)
    return (await res.json() as { embedding: number[] }).embedding
  }
  embed = (text) => clipPost('/embed/text', { text })
  embedImage = (url) => clipPost('/embed/image', { url })
}

// In createContainer call:
...(embed ? { embed } : {}),
...(embedImage ? { embedImage } : {}),
```

---

## Search API Endpoint

The `Vestigiorum.search()` method is already implemented. It needs a REST surface.

### Route

```
GET /api/vestigia/search
```

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Text to embed and search against |
| `per` | `promptum` \| `imago` \| `intella` | `promptum` | Which embedding dimension to search |
| `limit` | number | 20 | Max results |
| `minSim` | number | 0.7 | Minimum cosine similarity threshold |
| `modusId` | string | — | Filter to one modus |
| `genus` | string | — | `image`, `video`, `text`, `audio` |
| `visibilitas` | string (comma-separated) | — | `privata,communis,publica` |

### Auth

- No auth: returns `publica` vestigia only
- Authenticated as anima: also returns their own `privata` and `communis`
- `auctorKey` is derived from the authenticated session, never passed as a query param

### Response

```json
{
  "results": [
    {
      "vestigium": { "id": "...", "promptum": "...", "imagoUrl": "...", ... },
      "similaritas": 0.891
    }
  ]
}
```

### Error cases

- `embed` not configured (no CLIP service): `503 Service Unavailable`
- `per: 'imago'` but no `embeddingImago` exists on any records: returns empty results (not an error)
- Empty `q`: `400 Bad Request`

### Notes

- `search()` currently does a full in-memory collection scan. This is fine for hundreds of records. Atlas `$vectorSearch` replaces it when scale demands — that's a separate task from this spec.
- The `per: 'imago'` dimension is the most interesting one: query with text, match by visual content.

---

## Migration Strategy: Prompt-Guided Regen Decisions

Old vestigia have no embeddings. Not all are worth regenerating — some outputs are generic, some are unique.

### Phase 1: Embed all prompts first (always possible, no regen needed)

Run `indexPromptum` and `indexIntella` on everything. These only need text, which we always have. Fast, cheap, no image fetches.

### Phase 2: Use prompt embedding to decide what's worth regenerating

Once `embeddingPromptum` exists for all records, compute a **rarity score** for each vestigium in the prompt embedding space. Rare embeddings = interesting/unique generations worth recovering. Dense clusters = generic/common outputs.

**Rarity metric:** k-nearest-neighbour distance in the prompt embedding space.

```
rarity(v) = mean distance to v's k nearest neighbours (k=5)
```

High rarity → isolated in embedding space → unique prompt → worth regening  
Low rarity → clustered with many similar prompts → generic → skip

The migration script will:
1. Load all `embeddingPromptum` vectors
2. Compute pairwise kNN distances (or use a fast ANN library like `hnswlib`)
3. Score each vestigium
4. Produce two lists: `regen_candidates.json` and `skipped.json`
5. Optionally trigger regen jobs for candidates

### Threshold

Start with the top 20% by rarity score. Tune based on what you see — the cluster visualization (t-SNE or UMAP projection) will make it obvious where the interesting content lives.

### Phase 3: For regen candidates — regen + index imago

A regen triggers a new actum with the same modus + aditus. On completion, `vestigiumHook` auto-indexes the new imago. No special migration code needed for this step — it goes through the normal cast flow.

### Phase 4: Index imago for vestigia that already have a valid imagoUrl

Some old vestigia may have a valid CDN URL for their image. Run `indexImago` on those first before triggering any regens.

**Script:** `scripts/migration/backfill-vestigia-embeddings.ts`  
Flags: `--phase 1|2|3|4`, `--dry-run`, `--limit N`

---

## Atlas Vector Search Indexes

Three separate indexes on the `vestigia` collection, one per embedding field.

```json
{
  "fields": [{
    "type": "vector",
    "path": "embeddingPromptum",
    "numDimensions": 512,
    "similarity": "cosine",
    "filters": [
      { "type": "filter", "path": "visibilitas" },
      { "type": "filter", "path": "auctorKey.animaId" }
    ]
  }]
}
```

Same structure for `embeddingImago` and `embeddingIntella`.

The `$vectorSearch` replacement in `MongoVestigiorum.search()` is a separate task — current in-memory fallback works fine until the collection grows past ~10k records.

---

## Build Order

1. `clip_service/` — Python service, Docker image
2. `src/index.ts` — wire `CLIP_SERVICE_URL` → `embed` / `embedImage`
3. `src/api/vestigia/searchRouter.ts` — `GET /api/vestigia/search`
4. Wire search router into `index.ts`
5. `scripts/migration/backfill-vestigia-embeddings.ts` — phase 1 (promptum + intella)
6. Phase 2 analysis: rarity scoring script
7. Atlas indexes + `$vectorSearch` upgrade (when scale demands)
