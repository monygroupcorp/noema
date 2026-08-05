#!/usr/bin/env python
"""
Carve an NSFW cluster out of the corpus.

NSFW is a *content* axis, orthogonal to the semantic k-means clusters, so adult
prompts are normally smeared across several clusters. This reassigns every flagged
point to one dedicated cluster id so its true volume + spatial spread are visible.

Lexicon-based (transparent + tunable), two tiers:
  EXPLICIT   — sexual acts / genitalia / nudity
  SUGGESTIVE — strongly adult-adjacent (lingerie, cleavage, large-breast tags, …)
NSFW cluster = EXPLICIT ∪ SUGGESTIVE.

  python nsfw.py            # dry run: report volume + samples, write nothing
  python nsfw.py --apply    # rewrite attrs.bin / clusters.json / manifest.json
"""
import argparse, json, re, random
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "out"
PUB = HERE.parents[1] / "src/platforms/web/app/public/space"

# \b-anchored so "cock" doesn't hit "peacock", "cum" doesn't hit "cumulative", etc.
EXPLICIT = [
    r"nsfw", r"explicit", r"nude", r"nudity", r"naked", r"topless", r"bottomless",
    r"nipples?", r"areola", r"pussy", r"vagina", r"vulva", r"clit\w*", r"penis",
    r"\bcock\b", r"\bdick\b", r"dildo", r"\banal\b", r"anus", r"buttocks",
    r"blowjob", r"handjob", r"deepthroat", r"cumshot", r"cumming", r"creampie",
    r"\bcum\b", r"ejaculat\w*", r"masturbat\w*", r"orgasm", r"hentai", r"\bporn\w*",
    r"erotica?", r"\bsex\b", r"genital\w*", r"testicl\w*", r"scrotum", r"fellatio",
    r"cunnilingus", r"gangbang", r"bukkake", r"fingering", r"doggystyle",
    r"\bbdsm\b", r"bondage", r"ahegao", r"cameltoe", r"upskirt", r"\bcum_",
    r"spread[_ ]?(legs|pussy)", r"no[_ ]panties", r"pussyjuice", r"sex[_ ]?toy",
]
SUGGESTIVE = [
    r"sexy", r"lingerie", r"cleavage", r"large[_ ]?breasts", r"huge[_ ]?breasts",
    r"\bbusty\b", r"thong", r"\blewd\b", r"\bfetish\b", r"pantyshot", r"pantsu",
    r"underwear", r"seductiv\w*", r"provocativ\w*", r"\bthicc\b", r"voluptuous",
]
EX_RE = re.compile("|".join(EXPLICIT), re.IGNORECASE)
SUG_RE = re.compile("|".join(SUGGESTIVE), re.IGNORECASE)

NSFW_COLOR = "#ff2d6f"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--suggestive", action="store_true",
                    help="include the SUGGESTIVE tier in the NSFW cluster (default: on)")
    ap.add_argument("--explicit-only", action="store_true",
                    help="NSFW cluster = explicit tier only")
    args = ap.parse_args()

    meta = [json.loads(l) for l in (OUT / "meta.jsonl").open(encoding="utf-8")]
    labels = np.load(OUT / "labels.npy")
    ri = json.loads((OUT / "row_index.json").read_text())
    clusters = json.loads((PUB / "clusters.json").read_text())
    k = len(clusters)
    N = len(labels)

    ex_flag = np.zeros(N, dtype=bool)
    sug_flag = np.zeros(N, dtype=bool)
    for j in range(N):
        p = meta[ri[j]]["prompt"]
        if not p:
            continue
        if EX_RE.search(p):
            ex_flag[j] = True
        elif SUG_RE.search(p):
            sug_flag[j] = True

    if args.explicit_only:
        nsfw = ex_flag
    else:
        nsfw = ex_flag | sug_flag

    n_ex, n_sug, n_nsfw = int(ex_flag.sum()), int(sug_flag.sum()), int(nsfw.sum())
    print(f"corpus embedded points: {N:,}")
    print(f"  EXPLICIT  : {n_ex:,}  ({100*n_ex/N:.1f}%)")
    print(f"  SUGGESTIVE: {n_sug:,}  ({100*n_sug/N:.1f}%)")
    print(f"  NSFW total: {n_nsfw:,}  ({100*n_nsfw/N:.1f}%) of the map")

    # where does NSFW currently live (which semantic clusters)?
    from collections import Counter
    host = Counter(int(labels[j]) for j in range(N) if nsfw[j])
    print("\n  currently smeared across (top semantic clusters):")
    for cid, c in host.most_common(6):
        print(f"    [{c:>5}] {clusters[str(cid)]['label']}")

    # sample for precision sanity-check (truncated, clinical)
    idxs = [j for j in range(N) if nsfw[j]]
    random.seed(0); random.shuffle(idxs)
    print("\n  12 random matches (truncated, verify precision):")
    for j in idxs[:12]:
        tier = "EXP" if ex_flag[j] else "SUG"
        print(f"    [{tier}] {meta[ri[j]]['prompt'][:80]}")

    if not args.apply:
        print("\n(dry run — nothing written. re-run with --apply to carve the cluster.)")
        return

    # ---- apply: reassign flagged points to a new NSFW cluster id = k ----
    new_labels = labels.copy()
    new_labels[nsfw] = k
    new_labels.astype(np.uint16).tofile(PUB / "attrs.bin")

    counts = np.bincount(new_labels, minlength=k + 1)
    for cid in range(k):
        clusters[str(cid)]["count"] = int(counts[cid])
    clusters[str(k)] = {
        "label": "NSFW · adult", "terms": ["nsfw", "explicit", "suggestive"],
        "color": NSFW_COLOR, "count": int(counts[k]),
    }
    (PUB / "clusters.json").write_text(json.dumps(clusters, ensure_ascii=False, indent=2))

    mf = json.loads((PUB / "manifest.json").read_text())
    mf["k"] = k + 1
    mf["nsfw_count"] = n_nsfw
    (PUB / "manifest.json").write_text(json.dumps(mf, indent=2))
    print(f"\napplied — NSFW is now cluster {k} ({n_nsfw:,} pts, {100*n_nsfw/N:.1f}%). Reload /space.")


if __name__ == "__main__":
    main()
