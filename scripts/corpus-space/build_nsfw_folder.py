#!/usr/bin/env python
"""
Build a browsable review folder of the CLIP-flagged NSFW images (symlinks, no copy).

Goal: eyeball the flagged set to judge the classifier's RECALL/precision.
  flagged/       every image with score >= --threshold, named "<score>_<corpus>_<file>"
                 so an image viewer sorted by name shows highest-confidence first.
  borderline/    a sample just BELOW the cut (--near_lo .. threshold) — look here to
                 spot NSFW the classifier MISSED (false negatives at the margin).
  _priority-minor/  flagged OR sexual-prompt images whose PROMPT carried a minor-term
                 token (child/young girl/loli/shota/…). The review-priority subset.

Symlinks point at the originals on the Big Disk; delete the folder anytime.

  python build_nsfw_folder.py                       # default threshold 0.03
  python build_nsfw_folder.py --threshold 0.02 --out /path/to/review
"""
import argparse, json, os, re
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "out"
_BASE = os.environ.get("CORPUS_ROOT", "/run/media/rth/Big Disk/stationthis-corpus")
ROOTS = {
    "noema":  _BASE + "/media",
    "legacy": _BASE + "/legacy/media",
}
EX = re.compile(r"\b(nsfw|explicit|nude|nudity|naked|topless|nipple|areola|pussy|vagina|vulva|clit|penis|cock|dick|dildo|anal|blowjob|handjob|cumshot|creampie|hentai|porn|sex|orgasm|fellatio|masturbat|erotic|lewd)\b")
MINOR = re.compile(r"\b(child|children|kid|kids|toddler|infant|baby|loli|shota|preteen|underage|minor|young girl|young boy|elementary|kindergarten)\b")


def link(src: str, folder: Path, name: str):
    folder.mkdir(parents=True, exist_ok=True)
    dst = folder / name
    if dst.is_symlink() or dst.exists():
        return
    try:
        os.symlink(src, dst)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.03)
    ap.add_argument("--near_lo", type=float, default=0.015, help="borderline band lower bound")
    ap.add_argument("--near_cap", type=int, default=1500, help="max borderline symlinks")
    ap.add_argument("--out", default="/run/media/rth/Big Disk/stationthis-corpus/nsfw-review")
    args = ap.parse_args()

    score = np.load(OUT / "nsfw_score.npy")
    N = score.shape[0]
    out = Path(args.out)
    n_flag = n_border = n_minor = n_missing = 0
    near = []  # (score, path, name) for the borderline band (sample the strongest near-misses)

    with (OUT / "meta.jsonl").open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i >= N:
                break
            s = float(score[i])
            if s < args.near_lo:
                continue
            d = json.loads(line)
            c, fn = d.get("corpus"), d.get("file")
            if c not in ROOTS or not fn:
                continue
            src = os.path.join(ROOTS[c], fn)
            if not os.path.exists(src):
                n_missing += 1
                continue
            name = f"{s:+.3f}_{c}_{fn}"
            prompt = (d.get("prompt") or "").lower()
            minor = bool(MINOR.search(prompt))
            if s >= args.threshold:
                link(src, out / "flagged", name)
                n_flag += 1
                if minor:
                    link(src, out / "_priority-minor", name)
                    n_minor += 1
            else:
                near.append((s, src, name))
                if minor and EX.search(prompt):
                    link(src, out / "_priority-minor", "NEAR_" + name)
                    n_minor += 1

    # borderline: strongest near-misses first, capped
    near.sort(reverse=True)
    for s, src, name in near[: args.near_cap]:
        link(src, out / "borderline", name)
        n_border += 1

    print(f"out: {out}")
    print(f"  flagged/         {n_flag}   (score >= {args.threshold})")
    print(f"  borderline/      {n_border}   (score {args.near_lo}..{args.threshold}, strongest {args.near_cap})")
    print(f"  _priority-minor/ {n_minor}   (minor-term prompt ∩ flagged/sexual)")
    if n_missing:
        print(f"  ({n_missing} rows had no local file)")


if __name__ == "__main__":
    main()
