#!/usr/bin/env python
"""
Phase C — marketing / behavioral analytics over the corpus.

Joins per-point cluster labels (from project.py) with the full normalized meta
(from embed.py) and computes cohort, retention, temporal, model and cluster
patterns. Emits:

    out/analytics.json   machine-readable everything
    out/ANALYTICS.md     human report with the headline findings

Read-only over local artifacts; no network, no DB.
"""
import json, math, collections, statistics
from datetime import datetime
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "out"


def parse_month(s):
    return (s or "")[:7] or None


def gini(values):
    v = sorted(values)
    n = len(v)
    if n == 0:
        return 0.0
    cum = 0
    for i, x in enumerate(v, 1):
        cum += i * x
    s = sum(v)
    return (2 * cum) / (n * s) - (n + 1) / n if s else 0.0


def pctile(v, p):
    if not v:
        return 0
    return float(np.percentile(v, p))


def main():
    meta = [json.loads(l) for l in (OUT / "meta.jsonl").open(encoding="utf-8")]
    labels = np.load(OUT / "labels.npy")
    row_index = json.loads((OUT / "row_index.json").read_text())
    clusters_info = json.loads((Path(__file__).parents[2] /
        "src/platforms/web/app/public/space/clusters.json").read_text())

    # attach cluster id back onto the embedded rows
    for cid, ri in zip(labels.tolist(), row_index):
        meta[ri]["cluster"] = cid

    A = {}

    # ---- 1. overview ----
    by_corpus = collections.Counter(m["corpus"] for m in meta)
    dates = [m["date"] for m in meta if m.get("date")]
    A["overview"] = {
        "total_generations": len(meta),
        "by_corpus": dict(by_corpus),
        "date_min": min(dates)[:10] if dates else None,
        "date_max": max(dates)[:10] if dates else None,
    }

    # ---- 2. per-user volume + inequality ----
    user_gens = collections.Counter(m["user"] for m in meta if m.get("user"))
    counts = sorted(user_gens.values(), reverse=True)
    total = sum(counts)
    def top_share(frac):
        k = max(1, int(len(counts) * frac))
        return round(100 * sum(counts[:k]) / total, 1)
    A["users"] = {
        "unique_users": len(user_gens),
        "gens_per_user_mean": round(total / len(user_gens), 1) if user_gens else 0,
        "gens_per_user_median": pctile(counts, 50),
        "gens_per_user_p90": pctile(counts, 90),
        "gens_per_user_p99": pctile(counts, 99),
        "max_gens_single_user": counts[0] if counts else 0,
        "gini": round(gini(counts), 3),
        "share_by_top_1pct": top_share(0.01),
        "share_by_top_10pct": top_share(0.10),
        "users_with_1_gen": sum(1 for c in counts if c == 1),
        "users_with_lt_5_gens": sum(1 for c in counts if c < 5),
    }

    # ---- 3. lifespan / retention per user ----
    spans = collections.defaultdict(list)        # user -> [dates]
    for m in meta:
        if m.get("user") and m.get("date"):
            spans[m["user"]].append(m["date"][:10])
    life = {}
    one_day, returning, active_days_list, span_days_list = 0, 0, [], []
    for u, ds in spans.items():
        ds = sorted(ds)
        active = len(set(ds))
        try:
            span = (datetime.fromisoformat(ds[-1]) - datetime.fromisoformat(ds[0])).days
        except Exception:
            span = 0
        active_days_list.append(active); span_days_list.append(span)
        if active == 1:
            one_day += 1
        if span >= 7:
            returning += 1
        life[u] = (active, span, len(ds))
    nu = max(1, len(spans))
    A["retention"] = {
        "single_day_users": one_day,
        "single_day_pct": round(100 * one_day / nu, 1),
        "users_active_over_7day_span": returning,
        "returning_pct": round(100 * returning / nu, 1),
        "active_days_median": pctile(active_days_list, 50),
        "active_days_p90": pctile(active_days_list, 90),
        "lifespan_days_median": pctile(span_days_list, 50),
        "lifespan_days_p90": pctile(span_days_list, 90),
    }

    # ---- 4. cohorts: power / regular / casual / one-shot ----
    def cohort(n):
        if n >= 1000: return "whale"
        if n >= 100:  return "power"
        if n >= 10:   return "regular"
        if n >= 2:    return "casual"
        return "one_shot"
    coh = collections.Counter(cohort(c) for c in user_gens.values())
    coh_gens = collections.Counter()
    for u, c in user_gens.items():
        coh_gens[cohort(c)] += c
    A["cohorts"] = {
        "users_by_cohort": dict(coh),
        "gens_by_cohort": dict(coh_gens),
        "gens_share_by_cohort": {k: round(100 * v / total, 1) for k, v in coh_gens.items()},
    }

    # ---- 5. temporal growth ----
    by_month = collections.Counter(parse_month(m["date"]) for m in meta if m.get("date"))
    users_by_month = collections.defaultdict(set)
    first_seen = {}
    for m in meta:
        mo = parse_month(m.get("date"))
        if mo and m.get("user"):
            users_by_month[mo].add(m["user"])
            if m["user"] not in first_seen or m["date"] < first_seen[m["user"]]:
                first_seen[m["user"]] = m["date"]
    new_by_month = collections.Counter(parse_month(d) for d in first_seen.values())
    A["temporal"] = {
        "gens_by_month": dict(sorted(by_month.items())),
        "active_users_by_month": {k: len(v) for k, v in sorted(users_by_month.items())},
        "new_users_by_month": dict(sorted(new_by_month.items())),
    }

    # ---- 6. models / services / checkpoints ----
    A["models"] = {
        "top_models": collections.Counter(m["model"] for m in meta).most_common(20),
        "top_services": collections.Counter(m.get("service") or "?" for m in meta).most_common(15),
        "top_checkpoints": collections.Counter(
            m["checkpoint"] for m in meta if m.get("checkpoint")).most_common(15),
    }

    # ---- 7. loras ----
    lora_ct = collections.Counter()
    for m in meta:
        for l in (m.get("loras") or []):
            lora_ct[l] += 1
    A["loras"] = {
        "unique_loras": len(lora_ct),
        "gens_with_lora": sum(1 for m in meta if m.get("loras")),
        "top_loras": lora_ct.most_common(30),
    }

    # ---- 8. clusters (themes) ----
    clu_ct = collections.Counter(m["cluster"] for m in meta if "cluster" in m)
    # cluster x cohort: what do whales/power make vs one-shots
    clu_by_cohort = collections.defaultdict(lambda: collections.Counter())
    for m in meta:
        if "cluster" in m and m.get("user"):
            clu_by_cohort[cohort(user_gens[m["user"]])][m["cluster"]] += 1
    # cluster growth: share of each cluster in first vs second half of timeline
    clu_table = []
    for cid_s, info in clusters_info.items():
        cid = int(cid_s)
        clu_table.append({
            "id": cid, "label": info["label"], "terms": info["terms"],
            "count": clu_ct.get(cid, 0),
        })
    clu_table.sort(key=lambda x: -x["count"])
    A["clusters"] = {
        "table": clu_table,
        "by_cohort_top": {
            ch: [c for c, _ in clu_by_cohort[ch].most_common(5)]
            for ch in ["whale", "power", "regular", "casual", "one_shot"] if ch in clu_by_cohort
        },
    }

    # ---- 9. prompt characteristics by cohort ----
    plen_by_cohort = collections.defaultdict(list)
    neg_use = 0
    for m in meta:
        if m.get("user"):
            plen_by_cohort[cohort(user_gens[m["user"]])].append(len(m.get("prompt") or ""))
        if m.get("negative"):
            neg_use += 1
    A["prompts"] = {
        "negative_prompt_uses": neg_use,
        "prompt_len_median_by_cohort": {k: pctile(v, 50) for k, v in plen_by_cohort.items()},
    }

    (OUT / "analytics.json").write_text(json.dumps(A, indent=2, default=str))

    # ---- console headline ----
    print("=" * 64)
    print(f"CORPUS: {A['overview']['total_generations']:,} gens · "
          f"{A['users']['unique_users']} users · "
          f"{A['overview']['date_min']} → {A['overview']['date_max']}")
    print("=" * 64)
    u = A["users"]
    print(f"\nINEQUALITY: gini={u['gini']}  top-1%={u['share_by_top_1pct']}%  "
          f"top-10%={u['share_by_top_10pct']}% of all gens")
    print(f"  median gens/user={u['gens_per_user_median']:.0f}  max={u['max_gens_single_user']:,}  "
          f"one-shot users={u['users_with_1_gen']}")
    print(f"\nCOHORTS (users / gens-share):")
    for k in ["whale", "power", "regular", "casual", "one_shot"]:
        if k in coh:
            print(f"  {k:<9} {coh[k]:>4} users  {A['cohorts']['gens_share_by_cohort'].get(k,0):>5}% of gens")
    r = A["retention"]
    print(f"\nRETENTION: single-day={r['single_day_pct']}%  "
          f"returning(>7d span)={r['returning_pct']}%  median active days={r['active_days_median']:.0f}")
    print(f"\nTOP CLUSTERS:")
    for c in clu_table[:12]:
        print(f"  [{c['count']:>6}] {c['label']:<26} {c['terms']}")
    print(f"\nTOP LORAS: {[l for l,_ in A['loras']['top_loras'][:10]]}")
    print(f"TOP CHECKPOINTS: {[c for c,_ in A['models']['top_checkpoints'][:6]]}")
    print(f"\n-> out/analytics.json")


if __name__ == "__main__":
    main()
