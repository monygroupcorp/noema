#!/usr/bin/env python
"""
Score the corpus with the open-source Falconsai/nsfw_image_detection model (the A1
router's model) — to COMPARE against the pre-existing CLIP zero-shot tagging.

Runs the real NSFW ViT on the local images (Big Disk), aligned ROW-FOR-ROW to
nsfw_score.npy (the CLIP pass), so the two are directly cross-tabbable.

  out/falconsai_score.npy   float32 [N]   P(nsfw) in [0,1]   (-1.0 = image missing/unreadable)

  python falconsai_nsfw.py --limit 500     # quick sample to validate + time
  python falconsai_nsfw.py                  # full corpus
"""
import argparse, json, os, time
from pathlib import Path
import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset, DataLoader

HERE = Path(__file__).parent
OUT = HERE / "out"
_BASE = os.environ.get("CORPUS_ROOT")
if not _BASE:
    raise SystemExit("set CORPUS_ROOT to the corpus directory (it lives on external storage, not in this repo)")
ROOTS = {
    "noema":  _BASE + "/media",
    "legacy": _BASE + "/legacy/media",
}
MODEL = "Falconsai/nsfw_image_detection"


class ImgSet(Dataset):
    def __init__(self, paths, pp, size):
        self.paths = paths
        self.pp = pp          # transform stored on the instance (picklable → survives workers)
        self.size = size

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        p = self.paths[i]
        if not p or not os.path.exists(p):
            return torch.zeros(3, self.size, self.size), 0  # missing → sentinel, masked later
        try:
            img = Image.open(p).convert("RGB")
            return self.pp(img), 1
        except Exception:
            return torch.zeros(3, self.size, self.size), 0


def collate(batch):
    xs = torch.stack([b[0] for b in batch])
    ok = torch.tensor([b[1] for b in batch], dtype=torch.bool)
    return xs, ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    from transformers import AutoImageProcessor, AutoModelForImageClassification
    proc = AutoImageProcessor.from_pretrained(MODEL)
    model = AutoModelForImageClassification.from_pretrained(MODEL).eval().cuda().half()
    nsfw_idx = [i for i, l in model.config.id2label.items() if l.lower() == "nsfw"]
    nsfw_idx = nsfw_idx[0] if nsfw_idx else 1
    mean = torch.tensor(proc.image_mean).view(3, 1, 1)
    std = torch.tensor(proc.image_std).view(3, 1, 1)
    size = proc.size.get("height", 224) if isinstance(proc.size, dict) else 224
    import torchvision.transforms as T
    pp = T.Compose([T.Resize((size, size)), T.ToTensor(), T.Normalize(mean.flatten().tolist(), std.flatten().tolist())])

    ref = np.load(OUT / "nsfw_score.npy")
    N = ref.shape[0] if args.limit is None else min(args.limit, ref.shape[0])
    paths = []
    with (OUT / "meta.jsonl").open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i >= N:
                break
            d = json.loads(line)
            c, fn = d.get("corpus"), d.get("file")
            paths.append(os.path.join(ROOTS[c], fn) if c in ROOTS and fn else None)

    scores = np.full(N, -1.0, dtype=np.float32)
    dl = DataLoader(ImgSet(paths, pp, size), batch_size=args.batch, num_workers=args.workers, collate_fn=collate)
    t0 = time.time()
    done = 0
    with torch.no_grad():
        for xs, ok in dl:
            xs = xs.cuda().half()
            logits = model(pixel_values=xs).logits.float()
            p = torch.softmax(logits, dim=1)[:, nsfw_idx].cpu().numpy()
            b = xs.shape[0]
            sl = scores[done:done + b]
            okm = ok.numpy()
            sl[okm] = p[okm]  # keep -1.0 sentinel where image was missing/unreadable
            scores[done:done + b] = sl
            done += b
            if done % 2560 == 0 or done >= N:
                dt = time.time() - t0
                print(f"  {done}/{N}  {done/dt:.0f} img/s  eta {(N-done)/max(done/dt,1):.0f}s", flush=True)

    outp = OUT / ("falconsai_score.npy" if args.limit is None else f"falconsai_score.sample{N}.npy")
    np.save(outp, scores)
    valid = scores[scores >= 0]
    print(f"wrote {outp}  N={N}  scored={len(valid)}  missing={(scores<0).sum()}")
    print(f"P(nsfw) dist: p50={np.percentile(valid,50):.3f} p90={np.percentile(valid,90):.3f} "
          f"p99={np.percentile(valid,99):.3f} >=0.5:{int((valid>=0.5).sum())} ({100*(valid>=0.5).mean():.2f}%)")


if __name__ == "__main__":
    main()
