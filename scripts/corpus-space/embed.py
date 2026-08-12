#!/usr/bin/env python
"""
Phase A — embed the StationThis prompt corpus.

Reads both index.jsonl corpora (noema-era + legacy-2024), normalizes each row
into a unified record, embeds the cleaned prompt text with a sentence model on
the GPU, and writes:

    out/embeddings.f32.npy   [N x D] float32, L2-normalized
    out/meta.jsonl           one normalized record per row, aligned to the npy
    out/manifest.json        model, dim, counts, build params

Prompt text only (per product decision): this is the "prompt space".
LoRA tags (<lora:name:weight>) are stripped from the embedded text and lifted
into a structured `loras` field so they inform analytics, not the geometry.
"""
import argparse, json, os, re, sys, time
from pathlib import Path
import numpy as np

_BASE = os.environ.get("CORPUS_ROOT")
if not _BASE:
    raise SystemExit("set CORPUS_ROOT to the corpus directory (it lives on external storage, not in this repo)")

CORPORA = {
    "noema":  os.path.join(_BASE, "index.jsonl"),
    "legacy": os.path.join(_BASE, "legacy/index.jsonl"),
}

LORA_RE = re.compile(r"<lora:([^:>]+)(?::[\d.]+)?>", re.IGNORECASE)
ANGLE_RE = re.compile(r"<[^>]*>")          # any leftover <...> embedding/tag
WS_RE = re.compile(r"\s+")


def clean_prompt(raw: str):
    """Return (clean_text, [lora_names_from_tags])."""
    loras = [m.group(1).strip() for m in LORA_RE.finditer(raw)]
    txt = ANGLE_RE.sub(" ", raw)           # drop all <...> tags
    txt = WS_RE.sub(" ", txt).strip()
    return txt, loras


def normalize(d: dict, corpus: str) -> dict:
    raw = (d.get("prompt") or "").strip()
    clean, tag_loras = clean_prompt(raw)
    loras = list(dict.fromkeys((d.get("loras") or []) + tag_loras))  # dedupe, keep order
    if corpus == "noema":
        user = d.get("maid")
        model = d.get("tool") or d.get("service") or "?"
    else:
        user = d.get("userId")
        model = d.get("checkpoint") or d.get("type") or "?"
    return {
        "id": f"{corpus}:{d.get('genId')}:{d.get('idx', 0)}",
        "corpus": corpus,
        "prompt": clean,
        "prompt_raw": raw,
        "loras": loras,
        "model": str(model),
        "service": d.get("service") or d.get("type"),
        "user": f"{corpus}:{user}" if user is not None else None,
        "date": d.get("date"),
        "seed": d.get("seed"),
        "w": d.get("width"),
        "h": d.get("height"),
        "checkpoint": d.get("checkpoint"),
        "negative": (d.get("negativePrompt") or None),
        "ratings": d.get("ratings"),
        "src": d.get("srcUrl"),
        "file": d.get("file"),
    }


def load_rows(limit=None):
    rows = []
    for corpus, path in CORPORA.items():
        p = Path(path)
        if not p.exists():
            print(f"  WARN: missing {path}", file=sys.stderr)
            continue
        for line in p.open(encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                rec = normalize(json.loads(line), corpus)
            except Exception:
                continue
            rows.append(rec)
            if limit and len(rows) >= limit:
                return rows
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="BAAI/bge-small-en-v1.5")
    ap.add_argument("--out", default=str(Path(__file__).parent / "out"))
    ap.add_argument("--limit", type=int, default=None, help="smoke-test row cap")
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--min-chars", type=int, default=2,
                    help="rows with shorter cleaned prompts are kept in meta but not embedded")
    args = ap.parse_args()

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    print(f"loading rows (limit={args.limit}) ...")
    rows = load_rows(args.limit)
    print(f"  {len(rows)} rows loaded in {time.time()-t0:.1f}s")

    # Only embed rows with a usable cleaned prompt; everything else gets a zero
    # vector and an `embedded:false` flag so meta stays 1:1 with the npy.
    texts, idx_map = [], []
    for i, r in enumerate(rows):
        if len(r["prompt"]) >= args.min_chars:
            idx_map.append(i); texts.append(r["prompt"])
            r["embedded"] = True
        else:
            r["embedded"] = False
    print(f"  embedding {len(texts)} / {len(rows)} rows (rest blank-prompt)")

    from sentence_transformers import SentenceTransformer
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"loading model {args.model} on {dev} ...")
    model = SentenceTransformer(args.model, device=dev)
    dim = model.get_sentence_embedding_dimension()

    t1 = time.time()
    vecs = model.encode(
        texts, batch_size=args.batch, normalize_embeddings=True,
        show_progress_bar=True, convert_to_numpy=True,
    ).astype(np.float32)
    print(f"  encoded in {time.time()-t1:.1f}s  ({len(texts)/(time.time()-t1):.0f}/s)")

    emb = np.zeros((len(rows), dim), dtype=np.float32)
    emb[np.array(idx_map, dtype=np.int64)] = vecs

    np.save(out / "embeddings.f32.npy", emb)
    with (out / "meta.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    manifest = {
        "model": args.model, "dim": dim, "rows": len(rows),
        "embedded": len(texts), "batch": args.batch,
        "built_s": round(time.time() - t0, 1),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"done in {time.time()-t0:.1f}s -> {out}")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
