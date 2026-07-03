#!/usr/bin/env python
"""
Image-based NSFW classification — zero-shot CLIP on the actual pixels.

Unlike the prompt lexicon (which measures *intent*), this scores what was really
generated. For each image embedding we take max cosine similarity to a set of
NSFW text anchors vs a set of SFW anchors (same canon CLIP space); the margin is
the score. Threshold it.

  out/nsfw_score.npy   float32 [N]  (nsfw_sim - sfw_sim), aligned to row_index
  out/nsfw_image.npy   bool   [N]   score >= --threshold

Run with no --threshold to just calibrate (prints distribution + sample URLs).
"""
import argparse, json
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F

HERE = Path(__file__).parent
OUT = HERE / "out"

NSFW_ANCHORS = [
    "explicit sexual content", "pornography", "hardcore porn",
    "a completely nude person", "exposed bare breasts", "exposed genitalia",
    "a naked woman", "a naked man", "sexual intercourse", "explicit hentai",
]
SFW_ANCHORS = [
    "a fully clothed person", "a safe for work photograph", "an ordinary photo",
    "a landscape", "a cartoon character", "a portrait of a clothed person",
    "an everyday scene", "a person wearing clothes", "a cute animal", "a product photo",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=None)
    args = ap.parse_args()

    X = np.load(OUT / "clip_image.f32.npy").astype(np.float32)
    meta = [json.loads(l) for l in (OUT / "meta.jsonl").open(encoding="utf-8")]
    ri = json.loads((OUT / "row_index.json").read_text())
    N = len(X)
    dead = np.linalg.norm(X, axis=1) < 1e-6

    import open_clip
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, _ = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
    tok = open_clip.get_tokenizer("ViT-B-32")
    model = model.to(dev).eval()
    with torch.inference_mode():
        na = F.normalize(model.encode_text(tok(NSFW_ANCHORS).to(dev)), dim=-1).cpu().numpy()
        sa = F.normalize(model.encode_text(tok(SFW_ANCHORS).to(dev)), dim=-1).cpu().numpy()

    nsfw_sim = (X @ na.T).max(axis=1)        # best match to any NSFW anchor
    sfw_sim = (X @ sa.T).max(axis=1)
    score = (nsfw_sim - sfw_sim).astype(np.float32)
    score[dead] = -1.0                       # failed decodes -> never NSFW
    np.save(OUT / "nsfw_score.npy", score)

    live = score[~dead]
    print(f"score distribution over {len(live):,} images:")
    for p in [50, 75, 90, 95, 97, 99]:
        print(f"  p{p}: {np.percentile(live, p):+.3f}")
    print("counts at candidate thresholds:")
    for t in [-0.02, 0.0, 0.02, 0.05, 0.08, 0.10]:
        c = int((score >= t).sum())
        print(f"  >= {t:+.2f}: {c:,} ({100*c/N:.1f}%)")

    order = np.argsort(score)[::-1]
    print("\nMOST-NSFW (verify these should be adult):")
    for j in order[:10]:
        print(f"  [{score[j]:+.3f}] {meta[ri[j]].get('src')}")
    if args.threshold is not None:
        mid = np.where(np.abs(score - args.threshold) < 0.005)[0][:8]
        print(f"\nBORDERLINE around {args.threshold} (the precision/recall edge):")
        for j in mid:
            print(f"  [{score[j]:+.3f}] {meta[ri[j]].get('src')}")
        flag = score >= args.threshold
        np.save(OUT / "nsfw_image.npy", flag)
        print(f"\nsaved nsfw_image.npy: {int(flag.sum()):,} flagged ({100*flag.sum()/N:.1f}%) at threshold {args.threshold}")


if __name__ == "__main__":
    main()
