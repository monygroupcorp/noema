#!/usr/bin/env python
"""
Phase B — project the prompt embeddings to 3D and cluster them.

Inputs (from embed.py):  out/embeddings.f32.npy, out/meta.jsonl
Outputs (frontend artifact, written to the web app's public dir):
    public/space/points.bin       Float32 [N*3] xyz, normalized to ~[-2.5, 2.5]
    public/space/attrs.bin        Uint16 [N] cluster id per point
    public/space/meta.json        compact per-point meta (truncated), index-aligned
    public/space/clusters.json    cluster id -> { label, terms, color, count }
    public/space/manifest.json    counts, params, axis note

Only rows with embedded:true are projected/rendered. UMAP for the geometry
(falls back to PCA if it fails), MiniBatchKMeans for stable cluster coloring,
c-TF-IDF for human-readable cluster labels.
"""
import argparse, json, sys, time, colorsys
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent


def load(out_dir: Path):
    emb = np.load(out_dir / "embeddings.f32.npy")
    meta = [json.loads(l) for l in (out_dir / "meta.jsonl").open(encoding="utf-8")]
    return emb, meta


def cluster_palette(k: int):
    # evenly spaced hues, fixed sat/val tuned to the dark scene
    out = []
    for i in range(k):
        h = (i * 0.61803398875) % 1.0          # golden-ratio hue spacing
        r, g, b = colorsys.hsv_to_rgb(h, 0.55, 0.95)
        out.append("#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255)))
    return out


def ctfidf_labels(prompts, labels, k, topn=4):
    """c-TF-IDF: one mega-doc per cluster, surface its most distinctive terms."""
    from sklearn.feature_extraction.text import CountVectorizer
    docs = [""] * k
    for p, c in zip(prompts, labels):
        if c >= 0:
            docs[c] += " " + p
    cv = CountVectorizer(stop_words="english", token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9]{2,}\b",
                         max_features=20000)
    tf = cv.fit_transform(docs).toarray().astype(np.float64)   # [k x V]
    vocab = np.array(cv.get_feature_names_out())
    tf_norm = tf / (tf.sum(axis=1, keepdims=True) + 1e-9)
    idf = np.log(1 + k / (1 + (tf > 0).sum(axis=0)))
    ctfidf = tf_norm * idf
    labels_out = []
    for c in range(k):
        top = vocab[np.argsort(ctfidf[c])[::-1][:topn]]
        labels_out.append(list(top))
    return labels_out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "out"))
    ap.add_argument("--public", default=str(HERE.parents[1] /
                    "src/platforms/web/app/public/space"))
    ap.add_argument("--emb", default=None, help="embedding .npy (default out/embeddings.f32.npy)")
    ap.add_argument("--aligned", action="store_true",
                    help="emb is already in row_index order (canon CLIP); reuse out/row_index.json")
    ap.add_argument("--tag", default="", help="suffix for out/labels<tag>.npy etc.")
    ap.add_argument("--skip-meta", action="store_true", help="don't write meta.json (shared layer)")
    ap.add_argument("--k", type=int, default=24, help="kmeans clusters")
    ap.add_argument("--neighbors", type=int, default=15)
    ap.add_argument("--min-dist", type=float, default=0.12)
    ap.add_argument("--no-umap", action="store_true", help="force PCA")
    ap.add_argument("--prompt-chars", type=int, default=160)
    args = ap.parse_args()

    out_dir = Path(args.out); pub = Path(args.public); pub.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    meta = [json.loads(l) for l in (out_dir / "meta.jsonl").open(encoding="utf-8")]
    if args.aligned:
        X = np.load(args.emb).astype(np.float32)
        idx = np.array(json.loads((out_dir / "row_index.json").read_text()), dtype=np.int64)
        rows = [meta[i] for i in idx]
        assert len(X) == len(idx), f"emb {len(X)} != row_index {len(idx)}"
        # park zero-vector rows (failed image decodes) at the mean so they don't
        # form a fake blob; keeps row alignment intact for the layer toggle.
        norms = np.linalg.norm(X, axis=1)
        dead = norms < 1e-6
        if dead.any():
            mean = X[~dead].mean(0); mean /= (np.linalg.norm(mean) + 1e-9)
            X[dead] = mean
            print(f"  parked {int(dead.sum())} zero-vector rows at mean")
    else:
        emb = np.load(args.emb) if args.emb else np.load(out_dir / "embeddings.f32.npy")
        mask = np.array([m.get("embedded", False) for m in meta], dtype=bool)
        idx = np.where(mask)[0]
        X = emb[idx]
        rows = [meta[i] for i in idx]
    print(f"projecting {len(idx)} rows, dim={X.shape[1]} -> {pub}")

    # ---- 3D projection ----
    coords = None
    if not args.no_umap:
        try:
            import umap
            print("running UMAP -> 3D ...")
            t1 = time.time()
            coords = umap.UMAP(
                n_components=3, n_neighbors=args.neighbors, min_dist=args.min_dist,
                metric="cosine", low_memory=True, verbose=True,
            ).fit_transform(X)
            print(f"  UMAP done in {time.time()-t1:.1f}s")
        except Exception as e:
            print(f"  UMAP failed ({e}); falling back to PCA", file=sys.stderr)
    if coords is None:
        from sklearn.decomposition import PCA
        coords = PCA(n_components=3, random_state=0).fit_transform(X)
    coords = np.asarray(coords, dtype=np.float32)

    # normalize to a centered cube ~[-2.5, 2.5] (matches the scene scale)
    c = coords - coords.mean(axis=0)
    scale = 2.5 / (np.percentile(np.abs(c), 99) + 1e-9)
    c = (c * scale).astype(np.float32)

    # ---- clustering (on embeddings, not coords -> semantically true) ----
    from sklearn.cluster import MiniBatchKMeans
    print(f"clustering k={args.k} ...")
    km = MiniBatchKMeans(n_clusters=args.k, random_state=0, n_init=3, batch_size=4096)
    labels = km.fit_predict(X).astype(np.int32)

    prompts = [r["prompt"] for r in rows]
    label_terms = ctfidf_labels(prompts, labels, args.k)
    palette = cluster_palette(args.k)
    counts = np.bincount(labels, minlength=args.k).tolist()
    clusters = {
        str(c_): {
            "label": " · ".join(label_terms[c_][:2]) or f"cluster {c_}",
            "terms": label_terms[c_],
            "color": palette[c_],
            "count": counts[c_],
        } for c_ in range(args.k)
    }

    # ---- write frontend artifacts ----
    c.reshape(-1).tofile(pub / "points.bin")
    labels.astype(np.uint16).tofile(pub / "attrs.bin")

    if not args.skip_meta:
        pc = args.prompt_chars
        compact = []
        for r in rows:
            compact.append({
                "p": (r["prompt"] or "")[:pc],
                "m": r.get("model") or "?",
                "c": r.get("corpus"),
                "u": (r.get("user") or "")[-6:],          # short user tag
                "d": (r.get("date") or "")[:7],           # YYYY-MM
                "s": r.get("src"),
                "l": (r.get("loras") or [])[:3],
            })
        (pub / "meta.json").write_text(json.dumps(compact, ensure_ascii=False, separators=(",", ":")))
    (pub / "clusters.json").write_text(json.dumps(clusters, ensure_ascii=False, indent=2))
    manifest = {
        "n": len(idx), "k": args.k, "dim": int(X.shape[1]),
        "projection": "PCA" if args.no_umap else "UMAP",
        "neighbors": args.neighbors, "min_dist": args.min_dist,
        "prompt_chars": args.prompt_chars, "built_s": round(time.time() - t0, 1),
        "axis_note": "axes are abstract UMAP dims; distance = prompt similarity",
    }
    (pub / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # ---- also persist labels next to embeddings for Phase C analytics ----
    np.save(out_dir / f"labels{args.tag}.npy", labels)
    np.save(out_dir / f"coords3{args.tag}.npy", c)
    if not args.aligned:
        (out_dir / "row_index.json").write_text(json.dumps(idx.tolist()))

    print(f"done in {time.time()-t0:.1f}s -> {pub}")
    print(json.dumps(manifest, indent=2))
    print("\ntop clusters by size:")
    for c_ in sorted(range(args.k), key=lambda x: -counts[x])[:12]:
        print(f"  [{counts[c_]:>6}] {clusters[str(c_)]['label']:<28} {label_terms[c_]}")


if __name__ == "__main__":
    main()
