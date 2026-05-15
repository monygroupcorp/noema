#!/usr/bin/env python3
"""
vestigia_map.py — Interactive 2D map of your entire generation history.

Projects embeddingPromptum (512-dim ViT-B/32) to 2D via UMAP.
Points sized by kNN rarity — isolated = unique, clustered = common.
Hover shows image preview. Click opens the full image.

Usage:
    python vestigia_map.py
    python vestigia_map.py --animaId anima-xyz --out my_map.html --k 5

Environment:
    MONGODB_URI   — default: mongodb://localhost:27017
    DB_NAME       — default: noemaplane

Requirements:
    pip install pymongo umap-learn numpy plotly scikit-learn
"""

import argparse
import os
import sys
from datetime import datetime

import numpy as np
import plotly.graph_objects as go
import umap
from pymongo import MongoClient
from sklearn.neighbors import NearestNeighbors

MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "noemaplane")

# ── Data loading ──────────────────────────────────────────────────────────────

def load_vestigia(db, anima_id=None):
    col = db["vestigia"]
    query = {"embeddingPromptum": {"$exists": True}}
    if anima_id:
        query["auctorKey.animaId"] = anima_id

    docs = list(col.find(query, {
        "id": 1, "promptum": 1, "negativum": 1, "imagoUrl": 1,
        "modusId": 1, "embeddingPromptum": 1,
        "natum": 1, "impressio": 1, "visibilitas": 1, "genus": 1,
    }))
    print(f"  {len(docs)} vestigia with embeddingPromptum")
    return docs

# ── Analysis ──────────────────────────────────────────────────────────────────

def compute_rarity(embeddings, k=5):
    """Mean cosine distance to k nearest neighbours. Higher = more isolated = rarer."""
    nn = NearestNeighbors(n_neighbors=k + 1, metric="cosine", algorithm="brute")
    nn.fit(embeddings)
    distances, _ = nn.kneighbors(embeddings)
    return distances[:, 1:].mean(axis=1)   # drop col 0 (self, distance=0)


def run_umap(embeddings):
    print("  Running UMAP (this takes a moment on large corpora)...")
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
        verbose=False,
    )
    return reducer.fit_transform(embeddings)

# ── Helpers ───────────────────────────────────────────────────────────────────

def trunc(s, n=100):
    if not s:
        return ""
    return s[:n] + "…" if len(s) > n else s

def fmt_date(d):
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d")
    return str(d)[:10] if d else ""

def short_modus(modus_id):
    if not modus_id:
        return "unknown"
    parts = modus_id.split(".")
    return parts[-1] if len(parts) > 1 else modus_id

# ── Plotly figure ─────────────────────────────────────────────────────────────

COLORS = [
    "#7c3aed", "#2563eb", "#059669", "#d97706",
    "#dc2626", "#0891b2", "#be185d", "#65a30d",
    "#9333ea", "#0284c7", "#16a34a", "#ca8a04",
]


def build_figure(docs, xy, rarity):
    rarity_norm = (rarity - rarity.min()) / (rarity.max() - rarity.min() + 1e-9)
    sizes = 5 + rarity_norm * 12   # 5px (common) → 17px (rare)

    modus_ids  = [doc.get("modusId", "unknown") for doc in docs]
    unique_modi = sorted(set(modus_ids))

    # Per-point data for JS hover panel: [id, imagoUrl, promptum, modusId, rarity]
    customdata = [
        [
            doc.get("id", ""),
            doc.get("imagoUrl") or "",
            trunc(doc.get("promptum", ""), 200),
            short_modus(doc.get("modusId", "")),
            f"{rarity[i]:.4f}",
            fmt_date(doc.get("natum")),
        ]
        for i, doc in enumerate(docs)
    ]

    hover_text = [
        f"<b>{short_modus(doc.get('modusId',''))}</b>  {fmt_date(doc.get('natum'))}"
        f"<br>rarity {rarity[i]:.3f}"
        f"<br><span style='color:#aaa'>{trunc(doc.get('promptum',''), 80)}</span>"
        for i, doc in enumerate(docs)
    ]

    fig = go.Figure()

    for mi, modus in enumerate(unique_modi):
        mask = [j for j, m in enumerate(modus_ids) if m == modus]
        color = COLORS[mi % len(COLORS)]
        fig.add_trace(go.Scatter(
            x=xy[mask, 0],
            y=xy[mask, 1],
            mode="markers",
            name=short_modus(modus),
            marker=dict(
                color=color,
                size=[sizes[j] for j in mask],
                opacity=0.80,
                line=dict(width=0),
            ),
            text=[hover_text[j] for j in mask],
            customdata=[customdata[j] for j in mask],
            hovertemplate="%{text}<extra></extra>",
        ))

    fig.update_layout(
        title=dict(
            text="Generation Map — prompt embedding space (UMAP · ViT-B/32 · 512-dim)",
            font=dict(size=15, color="#e0e0e0"),
            x=0.5,
        ),
        plot_bgcolor="#0a0a0a",
        paper_bgcolor="#0a0a0a",
        font=dict(color="#c0c0c0", family="ui-monospace, monospace"),
        legend=dict(
            title=dict(text="modus", font=dict(size=11)),
            bgcolor="rgba(20,20,20,0.9)",
            bordercolor="#333",
            borderwidth=1,
            font=dict(size=11),
        ),
        xaxis=dict(showgrid=False, zeroline=False, showticklabels=False, title=""),
        yaxis=dict(showgrid=False, zeroline=False, showticklabels=False, title=""),
        margin=dict(l=20, r=20, t=55, b=20),
        hoverlabel=dict(bgcolor="#1a1a1a", font_size=12, font_family="ui-monospace, monospace"),
        width=1440,
        height=900,
    )

    return fig


# ── Interactive overlay (image preview on hover, open on click) ───────────────

OVERLAY_JS = """
<style>
#vmap-preview {
    display: none;
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 280px;
    background: #111;
    border: 1px solid #333;
    border-radius: 10px;
    padding: 10px;
    z-index: 9999;
    box-shadow: 0 8px 32px rgba(0,0,0,0.7);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: #ccc;
    pointer-events: none;
}
#vmap-preview img {
    width: 100%;
    border-radius: 6px;
    display: block;
    margin-bottom: 8px;
    background: #222;
}
#vmap-preview .vmap-modus { color: #7c3aed; font-weight: bold; margin-bottom: 2px; }
#vmap-preview .vmap-date  { color: #666; float: right; }
#vmap-preview .vmap-rarity { color: #d97706; margin-bottom: 6px; }
#vmap-preview .vmap-prompt { color: #aaa; line-height: 1.4; }
</style>

<div id="vmap-preview">
  <div><span class="vmap-modus" id="vmap-modus"></span><span class="vmap-date" id="vmap-date"></span></div>
  <div class="vmap-rarity">rarity <span id="vmap-rarity"></span></div>
  <img id="vmap-img" src="" alt="" onerror="this.style.display='none'" />
  <div class="vmap-prompt" id="vmap-prompt"></div>
</div>

<script>
(function() {
    var plot = document.getElementById('generation-map');

    plot.on('plotly_hover', function(data) {
        var cd = data.points[0].customdata;
        // cd: [id, imagoUrl, promptum, modusId, rarity, date]
        var panel  = document.getElementById('vmap-preview');
        var img    = document.getElementById('vmap-img');
        var imgUrl = cd[1];

        document.getElementById('vmap-modus').textContent  = cd[3];
        document.getElementById('vmap-date').textContent   = cd[5];
        document.getElementById('vmap-rarity').textContent = cd[4];
        document.getElementById('vmap-prompt').textContent = cd[2];

        if (imgUrl) {
            img.src = imgUrl;
            img.style.display = 'block';
        } else {
            img.style.display = 'none';
        }
        panel.style.display = 'block';
    });

    plot.on('plotly_unhover', function() {
        document.getElementById('vmap-preview').style.display = 'none';
    });

    plot.on('plotly_click', function(data) {
        var imgUrl = data.points[0].customdata[1];
        if (imgUrl) window.open(imgUrl, '_blank');
    });
})();
</script>
"""


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate interactive vestigia generation map")
    parser.add_argument("--animaId", help="Scope to one identity (omit for all public)")
    parser.add_argument("--out", default="vestigia_map.html", help="Output HTML file (default: vestigia_map.html)")
    parser.add_argument("--k", type=int, default=5, help="Neighbours for kNN rarity scoring (default: 5)")
    args = parser.parse_args()

    print(f"Connecting to MongoDB ({DB_NAME})...")
    client = MongoClient(MONGODB_URI)
    docs = load_vestigia(client[DB_NAME], args.animaId)
    client.close()

    if len(docs) < 3:
        print("Need at least 3 vestigia with embeddingPromptum. Run the backfill first.")
        sys.exit(1)

    embeddings = np.array([d["embeddingPromptum"] for d in docs], dtype=np.float32)

    print(f"Computing rarity scores (k={args.k})...")
    rarity = compute_rarity(embeddings, k=min(args.k, len(docs) - 1))

    print("Running UMAP projection...")
    xy = run_umap(embeddings)

    print("Building figure...")
    fig = build_figure(docs, xy, rarity)

    html = fig.to_html(
        full_html=True,
        include_plotlyjs=True,
        div_id="generation-map",
        post_script=OVERLAY_JS,
    )

    with open(args.out, "w") as f:
        f.write(html)

    # Summary
    rarity_ranked = sorted(zip(rarity, docs), key=lambda x: -x[0])
    unique_modi = sorted({d.get("modusId", "?") for d in docs})

    print(f"\n✓ {args.out}")
    print(f"  {len(docs)} generations · {len(unique_modi)} modi")
    print(f"  rarity range {rarity.min():.4f} – {rarity.max():.4f}")
    print(f"\nRarest 5 (most isolated prompts):")
    for score, doc in rarity_ranked[:5]:
        print(f"  {score:.4f}  {trunc(doc.get('promptum', ''), 90)}")
    print(f"\nMost common 3 (densest clusters):")
    for score, doc in rarity_ranked[-3:][::-1]:
        print(f"  {score:.4f}  {trunc(doc.get('promptum', ''), 90)}")


if __name__ == "__main__":
    main()
