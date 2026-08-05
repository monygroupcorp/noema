# ComfyUI Deploy — pre-migration archive

Tooling to pull everything ComfyDeploy hosts for us before we migrate off.

## API map (live-probed 2026-06-23)

ComfyDeploy runs a FastAPI backend at `https://api.comfydeploy.com`. Two surfaces:

- **Public API = 3 routes only** (`GET /openapi.json`): `GET /run/{id}`,
  `POST /run/deployment/queue`, `POST /run/{id}/cancel`.
- **Dashboard endpoints** (unschematized but work with the bearer key) — what we
  actually archive from: `GET /api/deployments`, `GET /api/workflows`,
  `GET /api/workflow/{id}`, `GET /api/machines`, `GET /api/machine/{id}`,
  `GET /api/volume/private-models`, `GET /api/search/model`.

Auth: `Authorization: Bearer $COMFY_DEPLOY_API_KEY` (from `.env`).

## What's archivable, and what isn't

| Data | Path | Status |
|---|---|---|
| Deployments / workflows (+graph) / machines | dashboard API | ✅ pulled as JSON |
| Private model volume **manifest** (821 entries, 489 GB) | `/api/volume/private-models` | ✅ listing only |
| Private model **bytes** | — | ❌ **no download endpoint exists** |
| Run history (list) | — | ❌ no list endpoint — drive from our Mongo run-ids |
| Run outputs | `comfy-deploy-output` S3 bucket | via stored URLs in Mongo |

The 489 GB volume breaks down as ~415 GB of **public base models**
(checkpoints/unet/clip/LLM/etc. — re-download free from HF/Civitai, don't pull
from CD) and **74 GB / 296 LoRAs** that are ours and uniquely at risk.

## Byte recovery for the 296 LoRAs (no API path)

The volume lives on ComfyDeploy's own Modal workspace and is inbound-only.
Confirmed no export/download/CLI via the live API, `/openapi.json`, the
open-source backend (`BennyKok/comfyui-deploy`), and `docs/models/download`.
Recovery options, in order:

1. **Reconcile first** — most LoRAs already live on R2 + HuggingFace (written by
   `TrainingFinalizationService`). Cross the 296 against R2/HF/Mongo `loRAModels`
   to find the true orphan set. *(build #2, not yet written)*
2. **CD support export** — ask ComfyDeploy to `modal volume get`-dump our private
   volume. Most reliable for raw bytes.
3. **Self-service emit** — run a trivial workflow on a machine with the volume
   mounted at `comfyui/models` that reads each orphan LoRA and emits it as an
   output (→ lands on the S3 output bucket → we download). Costs GPU, needs no CD help.

## Usage

```bash
# metadata + full volume manifest -> ./comfydeploy-archive (gitignored)
node scripts/migration/comfydeploy-export/export-metadata.mjs

# point output at the HDD mount
node scripts/migration/comfydeploy-export/export-metadata.mjs --out /mnt/hdd/comfydeploy-archive
# or:  ARCHIVE_DIR=/mnt/hdd/comfydeploy-archive node .../export-metadata.mjs
```

Read-only against ComfyDeploy. Does not boot the app or touch Mongo. Idempotent.
Output: `_summary.json`, `deployments/`, `workflows/<id>/`, `machines/`,
`volume/private-models.manifest.json` + `.rollup.json`, `catalogue/`.
