# VastAI Cold-Start Re-Baseline (2026-05-04)

**Purpose:** Measure whether the offer-quality and reliability improvements made between February and May 2026 changed VastAI's viability as a primary GPU provider.

**Predecessor:** `vastai-cold-start-2026-02-03T17-27-53.json` — N=5, 1 success, "VastAI rejected" verdict in `docs/agent_usability/03-cost-analysis-and-strategy.md`.

**This run:** `vastai-cold-start-2026-05-04T17-44-38.json` — N=10, 4 successes.

---

## Headline

| Metric | Feb 2026 | May 2026 | Δ |
|---|---|---|---|
| Sample size | 5 | 10 | — |
| Success rate | 1/5 (20%) | 4/10 (40%) | **2×** |
| Avg cold start (success) | 8.2 min | 11.0 min | +2.8 min |
| Median cold start | n/a | 11.5 min | — |
| Variance among successes | n/a | 15% (606–704s) | tight cluster |
| Spend | ~$1 | ~$0.30 | — |

**Take-away:** The offer-filter and SSH-multiplexing improvements doubled the raw success rate but did not solve the fundamental reliability problem. Failures cost almost as much as successes (~10 min each), so the retry penalty for user-facing workloads remains punishing.

---

## Improvements rolled into this baseline

These landed between the Feb and May benchmarks:

| Commit | Effect |
|---|---|
| `beb1ea25` | Sort offers by reliability desc, then price asc (was cheapest-first → "consistently landed on the worst machines") |
| `7386c504` | Filter out multi-GPU instances (`num_gpus = 1`) |
| `931f5cfe` | Extend SSH auth verification window 2 min → 5 min |
| `2691665d` | Search all GPU types upfront, fall through unified pool |
| `ffd69379` | Persist `--skipOfferIds` across job retries via `[TRAIN:TRIED_OFFER]` markers |
| `341e5100` | Fast-fail on repeated `Permission denied (publickey)` |
| `58c7b770` | SSH `ControlMaster` multiplexing in `SshTransport` |
| `06338ba9` / `e5fae5bf` | Pre-flight GPU check via Accelerate before training starts |
| `93a64365` (this commit) | Drop rejected `select_cols: ['*']`; fix `reliability` → `reliability2` (silent no-op since `beb1ea25`) |

**Important caveat:** `93a64365` corrected a silent no-op — the reliability filter introduced two months earlier was never actually narrowing the offer pool. The May benchmark is the **first time** the reliability filter has actually been in effect.

---

## Per-run results

| Run | Result | GPU | $/hr | SSH Ready | Downloads | Generation | Total | Failure mode |
|---|---|---|---|---|---|---|---|---|
| 1 | FAIL | — | — | — | — | — | 12.0 min | Instance vanished mid-DL (404 on terminate) |
| 2 | FAIL | — | — | — | — | — | 5.5 min | SSH drop mid-DL |
| 3 | ✅ | RTX 3090 | $0.20 | 159s | 340s | 21s | 10.8 min | — |
| 4 | ✅ | RTX 3090 | $0.20 | 86s | 365s | 22s | 10.1 min | — |
| 5 | FAIL | — | — | — | — | — | 12.9 min | Instance vanished mid-DL |
| 6 | ✅ | RTX 3090 | $0.20 | 75s | 466s | 21s | 11.5 min | — |
| 7 | ✅ | RTX 3090 | $0.20 | 167s | 384s | 21s | 11.7 min | — |
| 8 | FAIL | — | — | — | — | — | 11.2 min | Instance vanished mid-DL |
| 9 | FAIL | — | — | — | — | — | 5.1 min | SSH never ready (5-min cap) |
| 10 | FAIL | — | — | — | — | — | 14.5 min | Instance vanished mid-DL |

### Cost breakdown of successes
- All four successes landed on **$0.20/hr RTX 3090** instances on different SSH proxies (ssh8, ssh9, etc.)
- Generation phase (after downloads complete) is **rock-stable at 21–22 seconds** — Flux Schnell + dual CLIP + VAE decode at 512×512, 4 steps
- The reliability filter is steering us to a tightly clustered, well-behaved class of host

### Failure cost
- **6 failures:** 4 instance-vanish (host pulled the rug), 1 SSH-drop-mid-DL, 1 SSH-never-ready
- **Failure duration: avg 10.2 min** (range 5.1–14.5 min)
- **Most failures fail late** because the 6-min model download phase is where instances tend to vanish or SSH dies under bandwidth pressure

---

## Sequential retry math

With 40% success per attempt and ~10-min failure cost:

| Attempt | Cumulative wait | P(succeed by here) | P(needing this many) |
|---|---|---|---|
| 1st succeeds | 11 min | 40% | 40% |
| Need 2nd | 21 min | 64% | 24% |
| Need 3rd | 31 min | 78% | 14% |
| Need 4th | 41 min | 87% | 9% |
| Need 5th | 51 min | 92% | 5% |

**Expected user wait per job:** ~26 min (E = 11 + 10 × 1.5 retries on average).

---

## Verdict

| Workload | Verdict |
|---|---|
| **Training** (already async, multi-offer fall-through built in via `launch-training.js`) | ✅ Acceptable. Effective success rate after retries is high, latency is not user-perceptible |
| **User-facing inference** (replacing ComfyUI Deploy, ~30 sec target) | ❌ Unshippable. 26-min average wait is two orders of magnitude over baseline |

The bottleneck is no longer offer quality — it's the **6-minute in-job model download**. Failures detected during that window cost ~10 min each. Eliminating the download (via baked Docker images that ship with FLUX + VAE + CLIP pre-installed) is the next experimental lever; it would also collapse failure cost from ~10 min to ~2 min, dramatically improving the retry math.

---

## Methodology notes

- Benchmark script: `scripts/vastai/benchmark-cold-start.js`, N=10
- The script picks `offers[0]` and dies on first failure — no offer fall-through. Production training has fall-through; the benchmark intentionally doesn't, to isolate per-attempt reliability
- Each run is a full E2E: provision → SSH ready → install ComfyUI → upgrade PyTorch → download 33GB models from R2 → start ComfyUI → submit Flux Schnell workflow → poll `/history` for image presence → terminate instance
- Verification is structural (ComfyUI's `/history` reports `images: [...]`) — bytes are not downloaded back for hash check
- Models served from `models.miladystation2.net` (Cloudflare R2) — no HuggingFace auth, no rate limits

---

## Next experiment

**Baked image** — build `stationthis/flux-comfyui-runtime:v1` containing CUDA + PyTorch 2.4 + ComfyUI + FLUX.1-schnell + ae + t5xxl + clip_l. Push to a registry. Re-run the benchmark with that image. Measure cold start and Docker pull cost vs current 11-min profile. Expected outcome: 11 min → ~3 min (warm host) or ~5–6 min (cold host first-pull).

If baked image lands cold start in the 3–6 min range AND the same retry math applies, expected user wait drops from ~26 min to ~6 min — borderline acceptable for user-facing inference with a strong concierge UX.
