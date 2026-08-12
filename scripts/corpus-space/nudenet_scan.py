#!/usr/bin/env python
"""
NudeNet (notAI-tech/NudeNet v3) over a candidate set of corpus rows — the third leg
of the Falconsai/CLIP/NudeNet comparison. NudeNet is a per-region nudity DETECTOR
(exposed breast/genitalia/anus/buttocks), a different signal than a whole-image NSFW
classifier — useful for three-way agreement.

CPU-only here (onnxruntime CUDA won't engage on this box), so we run it PARALLEL
across processes and only on a stratified candidate set (the contested images), not
all 160k. RESUMABLE: appends {idx, score, classes} to out/nudenet_scores.jsonl and
skips rows already present.

  python nudenet_scan.py --indices out/cand.txt --procs 12

`--indices` = a text file of corpus row indices (ints, one per line).
score = max detector confidence over the EXPOSED sexual classes (0 if none).
"""
import argparse, json, os, sys
from pathlib import Path
from multiprocessing import Pool
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "out"
_BASE = os.environ.get("CORPUS_ROOT")
if not _BASE:
    raise SystemExit("set CORPUS_ROOT to the corpus directory (it lives on external storage, not in this repo)")
ROOTS = {
    "noema":  _BASE + "/media",
    "legacy": _BASE + "/legacy/media",
}
# Exposed sexual regions → the nudity signal. (COVERED classes and FACE/FEET ignored.
# MALE_BREAST_EXPOSED = shirtless man, deliberately excluded from the nudity score.)
NUDE = {
    "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "FEMALE_BREAST_EXPOSED",
    "ANUS_EXPOSED", "BUTTOCKS_EXPOSED",
}

_meta_paths = None
_detector = None


def _load_paths():
    paths = {}
    with (OUT / "meta.jsonl").open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            d = json.loads(line)
            c, fn = d.get("corpus"), d.get("file")
            paths[i] = os.path.join(ROOTS[c], fn) if c in ROOTS and fn else None
    return paths


def _init():
    global _detector, _meta_paths
    from nudenet import NudeDetector
    _detector = NudeDetector()
    _meta_paths = _load_paths()


def _score(idx):
    p = _meta_paths.get(idx)
    if not p or not os.path.exists(p):
        return (idx, -1.0, [])
    try:
        res = _detector.detect(p)
    except Exception:
        return (idx, -1.0, [])
    classes = sorted({r["class"] for r in res})
    nude = [r["score"] for r in res if r["class"] in NUDE]
    return (idx, float(max(nude)) if nude else 0.0, classes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--indices", required=True)
    ap.add_argument("--procs", type=int, default=12)
    args = ap.parse_args()

    want = [int(x) for x in Path(args.indices).read_text().split() if x.strip()]
    done = set()
    outp = OUT / "nudenet_scores.jsonl"
    if outp.exists():
        with outp.open() as f:
            for line in f:
                try: done.add(json.loads(line)["idx"])
                except Exception: pass
    todo = [i for i in want if i not in done]
    print(f"candidates={len(want)} already-done={len(done)} todo={len(todo)} procs={args.procs}", flush=True)
    if not todo:
        return

    n = 0
    with outp.open("a", encoding="utf-8") as fout, Pool(args.procs, initializer=_init) as pool:
        for idx, score, classes in pool.imap_unordered(_score, todo, chunksize=8):
            fout.write(json.dumps({"idx": idx, "score": score, "classes": classes}) + "\n")
            n += 1
            if n % 500 == 0:
                fout.flush(); print(f"  {n}/{len(todo)}", flush=True)
    print(f"done: wrote {n} rows to {outp}", flush=True)


if __name__ == "__main__":
    main()
