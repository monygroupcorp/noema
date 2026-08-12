# corpus-space — visualize & analyze the StationThis prompt corpus

Turns the archived ComfyDeploy generation corpus (~163k prompt+image pairs on the
HDD, see `scripts/migration/comfydeploy-export/`) into:

1. a **3D prompt-space** rendered in the web app's `/space` screen, and
2. a **marketing/behavioral analytics** report over account metadata.

Prompt-text embeddings (not image): "distance = prompt similarity". Runs locally
on the 4090. Read-only over the HDD corpus; no DB, no network at run time
(except the one-time embedding-model download from HuggingFace).

## Inputs

Set `CORPUS_ROOT` to the corpus directory — it lives on external storage, not in
this repo, and every script here refuses to run without it.

`$CORPUS_ROOT/index.jsonl`        (noema-era, ~17.6k)
`$CORPUS_ROOT/legacy/index.jsonl` (legacy 2024, ~145k)

Each line: `{ prompt, loras[], seed, checkpoint, width, height, date, user, service/type, ratings, srcUrl, file }`.

## Pipeline

```bash
python3 -m venv --system-site-packages .venv   # inherits the system CUDA torch + sklearn
. .venv/bin/activate
pip install sentence-transformers umap-learn

# A — embed prompts (GPU, ~1 min for 163k)  -> out/embeddings.f32.npy + out/meta.jsonl
python embed.py

# B — project to 3D (UMAP) + cluster + label -> public/space/{points,attrs}.bin, meta.json, clusters.json
python project.py            # --no-umap for a fast PCA cut; --k N for cluster count

# C — marketing analytics                    -> out/analytics.json + out/ANALYTICS.md
python analyze.py
```

## Outputs

Frontend artifact (served by Vite from `/public`, consumed by `screens/Space.tsx`):

| file | what |
|---|---|
| `space/points.bin`   | Float32 `[n*3]` xyz, normalized to ~[-2.5, 2.5] |
| `space/attrs.bin`    | Uint16 `[n]` cluster id per point |
| `space/meta.json`    | compact per-point meta (truncated prompt, model, corpus, date, src, loras) |
| `space/clusters.json`| cluster id → `{ label, terms, color, count }` |
| `space/manifest.json`| counts + projection params |

Analytics: `out/analytics.json` (machine) + `out/ANALYTICS.md` (report).

All large outputs are gitignored and regenerable.

## Notes

- Embedding model: `BAAI/bge-small-en-v1.5` (384-dim). Swap with `--model`.
- LoRA tags (`<lora:name:weight>`) are stripped from the embedded text and lifted
  into the structured `loras` field, so they drive analytics, not the geometry.
- Clustering is on the **embeddings** (semantically true), not the 3D coords; the
  UMAP coords are for display only.
- The corpus is all-users / historical — this is an analytics explorer, distinct
  from the per-identity live "remember space" in `src/types/vestigium.ts`.
