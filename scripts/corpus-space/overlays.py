#!/usr/bin/env python
"""
Carve content/structure overlay clusters into a projected map.

Overlays are axes orthogonal to the semantic k-means themes, so they get their
own cluster ids (and the legend shows their true volume):

  NSFW · adult   — lexicon flag over prompts (EXPLICIT ∪ SUGGESTIVE)
  ✦ outliers     — the most UNIQUE points: top --outlier-pct by distance to the
                   nearest theme-centroid in embedding space (nothing explains them)

Precedence when a point qualifies for more than one: NSFW > outlier > semantic.
Operates on one public/space* dir; rewrites attrs.bin + clusters.json + manifest.json.

  python overlays.py --public .../public/space       --emb out/clip_text.f32.npy  --tag ""
  python overlays.py --public .../public/space-image  --emb out/clip_image.f32.npy --tag image
"""
import argparse, json, re
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "out"

EXPLICIT = [
    r"nsfw", r"explicit", r"nude", r"nudity", r"naked", r"topless", r"bottomless",
    r"nipples?", r"areola", r"pussy", r"vagina", r"vulva", r"clit\w*", r"penis",
    r"\bcock\b", r"\bdick\b", r"dildo", r"\banal\b", r"anus", r"buttocks",
    r"blowjob", r"handjob", r"deepthroat", r"cumshot", r"cumming", r"creampie",
    r"\bcum\b", r"ejaculat\w*", r"masturbat\w*", r"orgasm", r"hentai", r"\bporn\w*",
    r"erotica?", r"\bsex\b", r"genital\w*", r"testicl\w*", r"scrotum", r"fellatio",
    r"cunnilingus", r"gangbang", r"bukkake", r"fingering", r"doggystyle",
    r"\bbdsm\b", r"bondage", r"ahegao", r"cameltoe", r"upskirt",
    r"spread[_ ]?(legs|pussy)", r"no[_ ]panties", r"pussyjuice", r"sex[_ ]?toy",
]
SUGGESTIVE = [
    r"sexy", r"lingerie", r"cleavage", r"large[_ ]?breasts", r"huge[_ ]?breasts",
    r"\bbusty\b", r"thong", r"\blewd\b", r"\bfetish\b", r"pantyshot", r"pantsu",
    r"underwear", r"seductiv\w*", r"provocativ\w*", r"\bthicc\b", r"voluptuous",
]
EX_RE = re.compile("|".join(EXPLICIT), re.IGNORECASE)
SUG_RE = re.compile("|".join(SUGGESTIVE), re.IGNORECASE)
NSFW_COLOR, OUTLIER_COLOR = "#ff2d6f", "#ffd24a"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", required=True)
    ap.add_argument("--emb", required=True, help="aligned embedding .npy (row_index order)")
    ap.add_argument("--tag", default="", help="labels<tag>.npy in out/")
    ap.add_argument("--outlier-pct", type=float, default=3.0)
    ap.add_argument("--explicit-only", action="store_true")
    ap.add_argument("--nsfw-from", default=None,
                    help="bool .npy from clip_nsfw.py (image-based); overrides the prompt lexicon")
    args = ap.parse_args()

    pub = Path(args.public)
    meta = [json.loads(l) for l in (OUT / "meta.jsonl").open(encoding="utf-8")]
    ri = json.loads((OUT / "row_index.json").read_text())
    labels = np.load(OUT / f"labels{args.tag}.npy").astype(np.int64)
    X = np.load(args.emb).astype(np.float32)
    clusters = json.loads((pub / "clusters.json").read_text())
    # k = the stable semantic cluster count (from the projection labels), NOT the
    # current digit-key count — so re-running is idempotent. Drop any stale overlay
    # entries (id >= k) left by a previous run.
    k = int(labels.max()) + 1
    clusters = {kk: v for kk, v in clusters.items() if (not kk.isdigit()) or int(kk) < k}
    N = len(labels)

    # ---- NSFW flag: image-based (preferred) or prompt lexicon (fallback) ----
    if args.nsfw_from:
        nsfw = np.load(args.nsfw_from).astype(bool)
        nsfw_label = "NSFW · adult (image)"
        assert len(nsfw) == N, f"nsfw flag {len(nsfw)} != rows {N}"
    else:
        nsfw = np.zeros(N, dtype=bool)
        for j in range(N):
            p = meta[ri[j]]["prompt"]
            if p and (EX_RE.search(p) or (not args.explicit_only and SUG_RE.search(p))):
                nsfw[j] = True
        nsfw_label = "NSFW · adult (prompt)"

    # ---- outlier score: distance to nearest theme-centroid in embedding space ----
    cents = np.zeros((k, X.shape[1]), dtype=np.float32)
    for c in range(k):
        m = labels == c
        if m.any():
            v = X[m].mean(0); n = np.linalg.norm(v)
            cents[c] = v / n if n else v
    sim = X @ cents.T                      # cosine sim to each centroid (X normalized)
    nearest = sim.max(axis=1)              # high = well-explained
    dist = 1.0 - nearest                   # high = unique / unexplained
    thresh = np.percentile(dist, 100 - args.outlier_pct)
    outlier = dist >= thresh

    # ---- assign overlay ids: NSFW (k) > outlier (k+1) > semantic ----
    new = labels.copy()
    new[outlier] = k + 1
    new[nsfw] = k                          # NSFW wins overlap
    new.astype(np.uint16).tofile(pub / "attrs.bin")

    counts = np.bincount(new, minlength=k + 2)
    for c in range(k):
        clusters[str(c)]["count"] = int(counts[c])
    clusters[str(k)] = {"label": nsfw_label, "terms": ["nsfw", "explicit", "adult"],
                        "color": NSFW_COLOR, "count": int(counts[k])}
    clusters[str(k + 1)] = {"label": "✦ outliers · most unique",
                            "terms": ["rare", "atypical", "edge"],
                            "color": OUTLIER_COLOR, "count": int(counts[k + 1])}
    (pub / "clusters.json").write_text(json.dumps(clusters, ensure_ascii=False, indent=2))

    mf = json.loads((pub / "manifest.json").read_text())
    mf["k"] = k + 2
    mf["nsfw_count"] = int(nsfw.sum())
    mf["outlier_count"] = int(counts[k + 1])
    (pub / "manifest.json").write_text(json.dumps(mf, indent=2))

    print(f"{pub.name}: NSFW={int(nsfw.sum()):,} ({100*nsfw.sum()/N:.1f}%)  "
          f"outliers={int(counts[k+1]):,} ({100*counts[k+1]/N:.1f}%, top {args.outlier_pct}% by uniqueness)")
    # show what the most-unique pieces look like
    order = np.argsort(dist)[::-1]
    print("  most unique prompts:")
    for j in order[:8]:
        print(f"    [{dist[j]:.3f}] {meta[ri[j]]['prompt'][:78]}")


if __name__ == "__main__":
    main()
