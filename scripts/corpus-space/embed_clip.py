#!/usr/bin/env python
"""
Canon embedding — OpenCLIP ViT-B/32 (openai), 512-d, L2-normalized.

EXACT replica of clip_service.py's model/tokenizer/preprocess, so these vectors
match what the platform produces in prod. Text and image share one space.

Aligned to the SAME rows the text pipeline embedded (out/row_index.json order),
so the frontend can toggle prompt-space <-> image-space and even compare them.

  python embed_clip.py --mode text     # -> out/clip_text.f32.npy   (fast, GPU only)
  python embed_clip.py --mode image    # -> out/clip_image.f32.npy  (slow, HDD decode)
"""
import argparse, json, os, warnings, time
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from PIL import Image

warnings.filterwarnings("ignore")
HERE = Path(__file__).parent
OUT = HERE / "out"
_BASE = os.environ.get("CORPUS_ROOT")
if not _BASE:
    raise SystemExit("set CORPUS_ROOT to the corpus directory (it lives on external storage, not in this repo)")

ROOTS = {
    "noema":  os.path.join(_BASE, "media"),
    "legacy": os.path.join(_BASE, "legacy/media"),
}
# match clip_service.py exactly
MODEL_NAME, PRETRAINED = "ViT-B-32", "openai"


def load_rows():
    meta = [json.loads(l) for l in (OUT / "meta.jsonl").open(encoding="utf-8")]
    ri = json.loads((OUT / "row_index.json").read_text())
    return meta, ri


class ImgSet(Dataset):
    def __init__(self, paths, preprocess):
        self.paths = paths
        self.pp = preprocess

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        p = self.paths[i]
        try:
            if p:
                return self.pp(Image.open(p)), 1
        except Exception:
            pass
        # zero tensor with the right shape (3x224x224) on failure
        return torch.zeros(3, 224, 224), 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["text", "image"], required=True)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--workers", type=int, default=10)
    args = ap.parse_args()

    import open_clip
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    model = model.to(dev).eval()

    meta, ri = load_rows()
    N = len(ri)
    t0 = time.time()

    if args.mode == "text":
        texts = [meta[j]["prompt"] for j in ri]
        emb = np.zeros((N, 512), dtype=np.float32)
        bs = 1024
        with torch.inference_mode():
            for s in range(0, N, bs):
                toks = tokenizer(texts[s:s + bs]).to(dev)           # 77-token canon context
                v = F.normalize(model.encode_text(toks), dim=-1)
                emb[s:s + len(toks)] = v.cpu().numpy()
                if s % (bs * 20) == 0:
                    print(f"  text {s:,}/{N:,}  {s/max(time.time()-t0,1):.0f}/s", flush=True)
        np.save(OUT / "clip_text.f32.npy", emb)
        meta_out = {"model": f"{MODEL_NAME}/{PRETRAINED}", "dim": 512, "rows": N,
                    "note": "canon CLIP text; 77-token truncation", "secs": round(time.time()-t0, 1)}
        (OUT / "clip_text.manifest.json").write_text(json.dumps(meta_out, indent=2))
        print(f"done text in {time.time()-t0:.0f}s -> out/clip_text.f32.npy")
        return

    # image mode
    paths = []
    for j in ri:
        m = meta[j]; f, c = m.get("file"), m.get("corpus")
        paths.append(str(Path(ROOTS[c]) / f) if f and c in ROOTS else None)
    dl = DataLoader(ImgSet(paths, preprocess), batch_size=args.batch,
                    num_workers=args.workers, pin_memory=True, prefetch_factor=4)
    emb = np.zeros((N, 512), dtype=np.float32)
    ok = np.zeros(N, dtype=bool)
    done = 0
    with torch.inference_mode():
        for bi, (imgs, flags) in enumerate(dl):
            imgs = imgs.to(dev, non_blocking=True)
            v = F.normalize(model.encode_image(imgs), dim=-1)
            n = imgs.shape[0]
            emb[done:done + n] = v.cpu().numpy()
            ok[done:done + n] = flags.numpy().astype(bool)
            done += n
            if bi % 4 == 0:
                print(f"  img {done:,}/{N:,}  {done/max(time.time()-t0,1):.0f}/s  ok={int(ok[:done].sum()):,}", flush=True)
    emb[~ok] = 0.0
    np.save(OUT / "clip_image.f32.npy", emb)
    (OUT / "clip_image.manifest.json").write_text(json.dumps(
        {"model": f"{MODEL_NAME}/{PRETRAINED}", "dim": 512, "rows": N,
         "ok": int(ok.sum()), "failed": int((~ok).sum()), "secs": round(time.time()-t0, 1)}, indent=2))
    print(f"done image: {int(ok.sum()):,} ok / {int((~ok).sum()):,} failed in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
