#!/usr/bin/env python
"""
Resolve a /space dataset selection into a training manifest.

The web export (`selection-<layer>-<n>.json`) carries point indices + truncated
captions (the browser only has the 160-char preview). This swaps in the FULL
caption + genId from the corpus, producing a training-ready manifest:

    out/<name>.training.jsonl   one row per item:
      { genId, image, caption, loras, corpus, model, date, w, h }

`image` is the stored output URL (R2 / comfy S3). The training pipeline pulls
bytes from there — no local image copy (images aren't local for real users).

  python resolve_manifest.py --in ~/Downloads/selection-image-1234.json
"""
import argparse, json
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="downloaded selection-*.json")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    sel = json.loads(Path(args.inp).read_text())
    meta = [json.loads(l) for l in (OUT / "meta.jsonl").open(encoding="utf-8")]
    ri = json.loads((OUT / "row_index.json").read_text())

    out_path = Path(args.out) if args.out else OUT / (Path(args.inp).stem + ".training.jsonl")
    n = 0
    with out_path.open("w", encoding="utf-8") as f:
        for it in sel["items"]:
            row = meta[ri[it["idx"]]]                 # frontend idx -> corpus row
            gid = (row.get("id") or "").split(":")     # "corpus:genId:idx"
            f.write(json.dumps({
                "genId": gid[1] if len(gid) > 1 else None,
                "image": row.get("src"),
                "caption": row.get("prompt"),          # FULL caption (lora tags already stripped)
                "loras": row.get("loras") or [],
                "corpus": row.get("corpus"),
                "model": row.get("model"),
                "date": row.get("date"),
                "w": row.get("w"), "h": row.get("h"),
            }, ensure_ascii=False) + "\n")
            n += 1

    incl = sum(1 for s in sel.get("spheres", []) if s["mode"] == "inc")
    excl = sum(1 for s in sel.get("spheres", []) if s["mode"] == "exc")
    print(f"resolved {n} items ({incl} include / {excl} exclude spheres, layer={sel.get('layer')})")
    print(f"-> {out_path}")


if __name__ == "__main__":
    main()
