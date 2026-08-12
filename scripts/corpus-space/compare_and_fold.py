#!/usr/bin/env python
"""
Three-way NSFW comparison — Falconsai (whole-image NSFW) vs CLIP zero-shot (the old
tags) vs NudeNet (per-region exposed-nudity detector) — plus the eyeball folders.

Inputs (aligned to meta.jsonl row order):
  out/falconsai_score.npy   P(nsfw) [0,1]      (-1 missing)   — dense, all rows
  out/nsfw_score.npy        CLIP margin        — dense, all rows
  out/nudenet_scores.jsonl  {idx,score,classes}                — SPARSE (candidate set)

Builds a review tree of SYMLINKS (fast to browse, delete anytime):
  falconsai/                 all Falconsai>=T_FAL, highest-confidence first
  disagree_falconsai_only/   Falconsai flags, CLIP MISSED  (CLIP's false negatives)
  disagree_clip_only/        CLIP flags, Falconsai says clean (CLIP's false positives)
  agree_both/                both flag
  nudenet_exposed/           NudeNet found exposed nudity (where scanned)
  _priority-minor/           any-model flag AND a minor-term prompt

  CORPUS_ROOT=/path/to/corpus python compare_and_fold.py [--out DIR] [--no-fold]
"""
import argparse, json, os, re
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "out"
_BASE = os.environ.get("CORPUS_ROOT", "/run/media/rth/Big Disk/stationthis-corpus")
ROOTS = {"noema": _BASE + "/media", "legacy": _BASE + "/legacy/media"}
T_FAL, T_CLIP, T_NUD = 0.5, 0.03, 0.5
EX = re.compile(r"\b(nsfw|explicit|nude|nudity|naked|topless|nipple|areola|pussy|vagina|vulva|clit|penis|cock|dick|dildo|anal|blowjob|handjob|cumshot|creampie|hentai|porn|sex|orgasm|fellatio|masturbat|erotic|lewd)\b")
MINOR = re.compile(r"\b(child|children|kid|kids|toddler|infant|baby|loli|shota|preteen|underage|minor|young girl|young boy|elementary|kindergarten)\b")


def link(src, folder: Path, name):
    folder.mkdir(parents=True, exist_ok=True)
    dst = folder / name
    if not (dst.is_symlink() or dst.exists()):
        try: os.symlink(src, dst)
        except OSError: pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.environ.get("CORPUS_ROOT", "/run/media/rth/Big Disk/stationthis-corpus") + "/nsfw-review")
    ap.add_argument("--no-fold", action="store_true")
    args = ap.parse_args()

    fal = np.load(OUT / "falconsai_score.npy")
    clip = np.load(OUT / "nsfw_score.npy")
    N = min(len(fal), len(clip))
    fal, clip = fal[:N], clip[:N]
    nud = np.full(N, -2.0, dtype=np.float32)  # -2 = not scanned
    nud_classes = {}
    p = OUT / "nudenet_scores.jsonl"
    if p.exists():
        with p.open() as f:
            for line in f:
                try: d = json.loads(line)
                except Exception: continue
                if 0 <= d["idx"] < N:
                    nud[d["idx"]] = d["score"]
                    nud_classes[d["idx"]] = d.get("classes", [])

    fF = (fal >= T_FAL) & (fal >= 0)          # Falconsai NSFW (valid only)
    fC = clip >= T_CLIP                         # CLIP flagged (old tags)
    known_n = nud >= -1                          # NudeNet actually scanned
    fN = (nud >= T_NUD)                          # NudeNet exposed-nudity

    print(f"=== FULL corpus (N={N}, Falconsai valid={int((fal>=0).sum())}) ===")
    print(f"Falconsai NSFW (P>={T_FAL}): {int(fF.sum())} ({100*fF.mean():.2f}%)")
    print(f"CLIP flagged   (>={T_CLIP}): {int(fC.sum())} ({100*fC.mean():.2f}%)")
    print(f"  agree both:            {int((fF&fC).sum())}")
    print(f"  Falconsai-only (CLIP MISSED):   {int((fF&~fC).sum())}")
    print(f"  CLIP-only (Falconsai says clean): {int((~fF&fC).sum())}")
    v = fal >= 0
    print(f"  corr(Falconsai P, CLIP margin): {np.corrcoef(fal[v], clip[v])[0,1]:.3f}")
    # recall/precision of CLIP treating Falconsai as reference
    tp = int((fF&fC).sum()); fn = int((fF&~fC).sum()); fp = int((~fF&fC).sum())
    print(f"  CLIP vs Falconsai-as-truth: recall={tp/max(tp+fn,1):.2f}  precision={tp/max(tp+fp,1):.2f}")

    if known_n.sum():
        m = known_n
        print(f"\n=== NudeNet three-way (over {int(m.sum())} scanned rows) ===")
        print(f"NudeNet exposed (>={T_NUD}): {int(fN[m].sum())}")
        print(f"  Falconsai∩NudeNet: {int((fF&fN&m).sum())}  Falconsai∩~NudeNet: {int((fF&~fN&m).sum())}  ~Falconsai∩NudeNet: {int((~fF&fN&m).sum())}")
        print(f"  CLIP∩NudeNet:      {int((fC&fN&m).sum())}")
        allc = {}
        for i in np.where(fN & m)[0]:
            for c in nud_classes.get(int(i), []): allc[c] = allc.get(c, 0) + 1
        print("  top exposed classes:", dict(sorted(allc.items(), key=lambda x:-x[1])[:8]))

    # minor∧sexual over any-model flag
    prompts = []
    with (OUT / "meta.jsonl").open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i >= N: break
            prompts.append((json.loads(line).get("prompt") or "").lower())
    m_flag = np.array([bool(MINOR.search(p)) for p in prompts])
    anyflag = fF | fC | fN
    print(f"\n=== minor-term prompt ∩ any-model flag: {int((m_flag&anyflag).sum())} "
          f"(Falconsai:{int((m_flag&fF).sum())} CLIP:{int((m_flag&fC).sum())} NudeNet:{int((m_flag&fN).sum())}) ===")

    if args.no_fold:
        return

    out = Path(args.out)
    meta = []
    with (OUT / "meta.jsonl").open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i >= N: break
            meta.append(json.loads(line))
    counts = {}
    def put(i, folder):
        d = meta[i]; c, fn = d.get("corpus"), d.get("file")
        if c not in ROOTS or not fn: return
        src = os.path.join(ROOTS[c], fn)
        nlabel = ("%.2f" % nud[i]) if nud[i] >= -1 else "na"
        name = f"F{max(fal[i],0):.2f}_C{clip[i]:+.3f}_N{nlabel}_{c}_{fn}"
        link(src, out / folder, name)
        counts[folder] = counts.get(folder, 0) + 1

    for i in range(N):
        if fF[i] and fC[i]: put(i, "agree_both")
        if fF[i] and not fC[i]: put(i, "disagree_falconsai_only")
        if fC[i] and not fF[i]: put(i, "disagree_clip_only")
        if fF[i]: put(i, "falconsai")
        if known_n[i] and fN[i]: put(i, "nudenet_exposed")
        if m_flag[i] and (fF[i] or fC[i] or fN[i]): put(i, "_priority-minor")

    print(f"\n=== folders under {out} ===")
    for k in sorted(counts): print(f"  {k}/  {counts[k]}")


if __name__ == "__main__":
    main()
