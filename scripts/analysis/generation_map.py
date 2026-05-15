#!/usr/bin/env python3
"""
generation_map.py — 2D map of all historical generations from generationOutputs.

Reads from `noema.generationOutputs` (stationthisdeluxebot legacy collection),
calls the CLIP service to embed each prompt, stores `embeddingPromptum` back on
the document (so re-runs skip already-embedded records), then renders an
interactive UMAP scatter coloured by tool with hover image previews.

Usage:
    CLIP_SERVICE_URL=http://localhost:8080 python generation_map.py
    python generation_map.py --clipUrl http://clip:8080 --out map.html
    python generation_map.py --masterAccountId 64ab... --k 7

Environment:
    MONGODB_URI       — default: mongodb://localhost:27017
    DB_NAME           — default: noema
    CLIP_SERVICE_URL  — CLIP service base URL (required unless --clipUrl is given)

Requirements:
    pip install -r requirements.txt
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime

import numpy as np
import plotly.graph_objects as go
import umap
from bson import ObjectId
from pymongo import MongoClient, UpdateOne
from sklearn.neighbors import NearestNeighbors

MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "noema")
CLIP_SERVICE_URL_ENV = os.environ.get("CLIP_SERVICE_URL", "")

EMBED_BATCH_SIZE = 64

# ── Field extraction ───────────────────────────────────────────────────────────

def get_prompt(doc):
    rp = doc.get("requestPayload") or {}
    return rp.get("input_prompt") or rp.get("prompt") or ""

def get_negative(doc):
    rp = doc.get("requestPayload") or {}
    return rp.get("input_negative_prompt") or rp.get("negative_prompt") or ""

def get_image_url(doc):
    rp = doc.get("responsePayload")
    if isinstance(rp, list):
        for item in rp:
            if item.get("type") == "image":
                imgs = (item.get("data") or {}).get("images") or []
                if imgs:
                    return imgs[0]
    elif isinstance(rp, dict):
        imgs = rp.get("images") or rp.get("artifactUrls") or []
        if imgs:
            return imgs[0]
    return ""

def get_tool(doc):
    return doc.get("toolDisplayName") or doc.get("toolId") or "unknown"

# ── CLIP embedding ─────────────────────────────────────────────────────────────

def clip_post(clip_url, path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{clip_url}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())

def embed_texts(texts, clip_url):
    result = []
    total = len(texts)
    for i in range(0, total, EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        resp = clip_post(clip_url, "/embed/text/batch", {"texts": batch})
        result.extend(resp["embeddings"])
        done = min(i + EMBED_BATCH_SIZE, total)
        print(f"    embedded {done}/{total}", end="\r", flush=True)
        if done < total:
            time.sleep(0.05)
    print()
    return result

# ── Data loading + backfill ────────────────────────────────────────────────────

def load_and_embed(col, clip_url, master_account_id=None):
    query = {
        "status": "completed",
        "$or": [
            {"requestPayload.input_prompt": {"$exists": True, "$ne": ""}},
            {"requestPayload.prompt": {"$exists": True, "$ne": ""}},
        ],
    }
    if master_account_id:
        query["masterAccountId"] = ObjectId(master_account_id)

    projection = {
        "_id": 1,
        "toolId": 1,
        "toolDisplayName": 1,
        "requestPayload": 1,
        "responsePayload": 1,
        "requestTimestamp": 1,
        "embeddingPromptum": 1,
    }
    docs = list(col.find(query, projection))
    print(f"  {len(docs)} completed generations with prompts")

    to_embed = [d for d in docs if not d.get("embeddingPromptum")]
    print(f"  {len([d for d in docs if d.get('embeddingPromptum')])} already embedded, "
          f"{len(to_embed)} to embed now")

    if to_embed:
        texts = []
        for d in to_embed:
            prompt = get_prompt(d)
            neg = get_negative(d)
            texts.append(f"{prompt} {neg}".strip() if neg else prompt)

        print(f"  Calling CLIP service ({len(to_embed)} prompts in batches of {EMBED_BATCH_SIZE})...")
        embeddings = embed_texts(texts, clip_url)

        ops = [
            UpdateOne({"_id": d["_id"]}, {"$set": {"embeddingPromptum": emb}})
            for d, emb in zip(to_embed, embeddings)
        ]
        col.bulk_write(ops, ordered=False)
        print(f"  Wrote {len(ops)} embeddings back to MongoDB")

        for d, emb in zip(to_embed, embeddings):
            d["embeddingPromptum"] = emb

    return docs

# ── Analysis ───────────────────────────────────────────────────────────────────

def compute_rarity(embeddings, k=5):
    nn = NearestNeighbors(n_neighbors=k + 1, metric="cosine", algorithm="brute")
    nn.fit(embeddings)
    distances, _ = nn.kneighbors(embeddings)
    return distances[:, 1:].mean(axis=1)

def run_umap(embeddings):
    print("  Running UMAP (may take a moment on large corpora)...")
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
        verbose=False,
    )
    return reducer.fit_transform(embeddings)

# ── Helpers ────────────────────────────────────────────────────────────────────

def trunc(s, n=100):
    if not s:
        return ""
    return s[:n] + "…" if len(s) > n else s

def fmt_date(d):
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d")
    return str(d)[:10] if d else ""

# ── Plotly figure ──────────────────────────────────────────────────────────────

COLORS = [
    "#7c3aed", "#2563eb", "#059669", "#d97706",
    "#dc2626", "#0891b2", "#be185d", "#65a30d",
    "#9333ea", "#0284c7", "#16a34a", "#ca8a04",
]

def build_figure(docs, xy, rarity):
    rarity_norm = (rarity - rarity.min()) / (rarity.max() - rarity.min() + 1e-9)
    sizes = 5 + rarity_norm * 12

    tools = [get_tool(d) for d in docs]
    unique_tools = sorted(set(tools))

    customdata = [
        [
            str(doc["_id"]),
            get_image_url(doc),
            trunc(get_prompt(doc), 200),
            tools[i],
            f"{rarity[i]:.4f}",
            fmt_date(doc.get("requestTimestamp")),
        ]
        for i, doc in enumerate(docs)
    ]

    hover_text = [
        f"<b>{tools[i]}</b>  {fmt_date(doc.get('requestTimestamp'))}"
        f"<br>rarity {rarity[i]:.3f}"
        f"<br><span style='color:#aaa'>{trunc(get_prompt(doc), 80)}</span>"
        for i, doc in enumerate(docs)
    ]

    fig = go.Figure()

    for ti, tool in enumerate(unique_tools):
        mask = [j for j, t in enumerate(tools) if t == tool]
        color = COLORS[ti % len(COLORS)]
        fig.add_trace(go.Scatter(
            x=xy[mask, 0],
            y=xy[mask, 1],
            mode="markers",
            name=trunc(tool, 40),
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
            title=dict(text="tool", font=dict(size=11)),
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


OVERLAY_JS = """
<style>
#vmap-preview {
    display: none; position: fixed; bottom: 24px; right: 24px;
    width: 280px; background: #111; border: 1px solid #333;
    border-radius: 10px; padding: 10px; z-index: 9999;
    box-shadow: 0 8px 32px rgba(0,0,0,0.7);
    font-family: ui-monospace, monospace; font-size: 11px; color: #ccc;
    pointer-events: none;
}
#vmap-preview img { width:100%; border-radius:6px; display:block; margin-bottom:8px; background:#222; }
#vmap-preview .vmap-tool   { color:#7c3aed; font-weight:bold; margin-bottom:2px; }
#vmap-preview .vmap-date   { color:#666; float:right; }
#vmap-preview .vmap-rarity { color:#d97706; margin-bottom:6px; }
#vmap-preview .vmap-prompt { color:#aaa; line-height:1.4; }
</style>

<div id="vmap-preview">
  <div><span class="vmap-tool" id="vmap-tool"></span><span class="vmap-date" id="vmap-date"></span></div>
  <div class="vmap-rarity">rarity <span id="vmap-rarity"></span></div>
  <img id="vmap-img" src="" alt="" onerror="this.style.display='none'" />
  <div class="vmap-prompt" id="vmap-prompt"></div>
</div>

<script>
(function() {
    var plot = document.getElementById('generation-map');
    plot.on('plotly_hover', function(data) {
        var cd = data.points[0].customdata;
        var panel = document.getElementById('vmap-preview');
        document.getElementById('vmap-tool').textContent   = cd[3];
        document.getElementById('vmap-date').textContent   = cd[5];
        document.getElementById('vmap-rarity').textContent = cd[4];
        document.getElementById('vmap-prompt').textContent = cd[2];
        var img = document.getElementById('vmap-img');
        if (cd[1]) { img.src = cd[1]; img.style.display = 'block'; }
        else { img.style.display = 'none'; }
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

# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="2D generation map from generationOutputs via UMAP + CLIP")
    parser.add_argument("--clipUrl", default=CLIP_SERVICE_URL_ENV,
                        help="CLIP service base URL (or set CLIP_SERVICE_URL env var)")
    parser.add_argument("--masterAccountId", help="Scope to one user (MongoDB ObjectId string)")
    parser.add_argument("--out", default="generation_map.html", help="Output HTML file")
    parser.add_argument("--k", type=int, default=5, help="Neighbours for kNN rarity (default: 5)")
    args = parser.parse_args()

    if not args.clipUrl:
        print("ERROR: --clipUrl is required (or set CLIP_SERVICE_URL)")
        sys.exit(1)

    print(f"Connecting to MongoDB ({DB_NAME})...")
    client = MongoClient(MONGODB_URI)
    col = client[DB_NAME]["generationOutputs"]

    docs = load_and_embed(col, args.clipUrl, args.masterAccountId)
    client.close()

    if len(docs) < 3:
        print("Need at least 3 embedded generations. Check connection and --masterAccountId.")
        sys.exit(1)

    embeddings = np.array([d["embeddingPromptum"] for d in docs], dtype=np.float32)

    print(f"Computing rarity (k={args.k})...")
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

    rarity_ranked = sorted(zip(rarity, docs), key=lambda x: -x[0])
    unique_tools = sorted({get_tool(d) for d in docs})

    print(f"\n✓ {args.out}")
    print(f"  {len(docs)} generations · {len(unique_tools)} tools")
    print(f"  rarity range {rarity.min():.4f} – {rarity.max():.4f}")
    print(f"\nRarest 5 (most isolated prompts):")
    for score, doc in rarity_ranked[:5]:
        print(f"  {score:.4f}  {trunc(get_prompt(doc), 90)}")
    print(f"\nMost common 3 (densest clusters):")
    for score, doc in rarity_ranked[-3:][::-1]:
        print(f"  {score:.4f}  {trunc(get_prompt(doc), 90)}")


if __name__ == "__main__":
    main()
