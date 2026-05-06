# GPU Provider Shootout — Verdict (2026-05-06)

**Decision: migrate from ComfyUI Deploy → RunPod SECURE direct-IP path.**

## Scoreboard

| Provider | Success rate (n=10) | Avg cold start | Cost / successful run | $/hr (RTX A4000-class) |
|---|---|---|---|---|
| VastAI (re-baseline 2026-05-04) | 4/10 = 40% | 11.0 min | $0.092 | $0.20 (3090) |
| RunPod COMMUNITY | 7/10 = 70% | 10.6 min | $0.056 | $0.22 |
| **RunPod SECURE** | **9/10 = 90%** | **7.6 min** | **$0.043** | **$0.25–$0.46** |

Same workload across all three: provision → SSH → git clone ComfyUI → pip install requirements → start ComfyUI → download 5 models from R2 (~33 GB) → run 4-step FLUX-schnell at 512×512.

Source data:
- VastAI: [`vastai-cold-start-2026-05-04T17-44-38.json`](./vastai-cold-start-2026-05-04T17-44-38.json)
- RunPod COMMUNITY: [`runpod-cold-start-2026-05-05T20-53-41.json`](./runpod-cold-start-2026-05-05T20-53-41.json)
- RunPod SECURE: [`runpod-cold-start-2026-05-06T11-02-03.json`](./runpod-cold-start-2026-05-06T11-02-03.json)

## Why SECURE wins on every axis

- **Reliability:** datacenter-grade hosts. The ~30–60% per-attempt failure rate on community marketplaces (VastAI / RunPod COMMUNITY) drops to ~10% on SECURE.
- **Speed:** model downloads ran ~40% faster from SECURE than from COMMUNITY hosts (5.6 min vs 9 min for the same 33 GB from R2). SECURE datacenter backbones have better connectivity to Cloudflare R2's edge.
- **Cost-per-success:** higher per-hour rate is more than offset by faster runs and fewer wasted attempts. Effective $/successful-run on SECURE is the lowest of the three.
- **Tight variance:** SECURE's min/max range was 5.6–8.6 min. COMMUNITY's was 8.4–15.7 min. Predictability matters more than raw average for production scheduling.

## Implementation path

The provider abstraction is already in place: `RunPodPodService` extends `ComputeProvider`. The shootout produced these working pieces:

- `src/core/services/runpod/RunPodPodClient.js` + `RunPodPodService.js` — REST wrapper + orchestration. Defaults to direct-IP SSH on both COMMUNITY and SECURE (`supportPublicIp: true`).
- `scripts/runpod/benchmark-cold-start-runpod.js` — verified COMMUNITY + SECURE, 10 runs each.
- `scripts/runpod/probe-secure-public-ip.js` — minimal regression probe for SECURE direct-IP.

Migration steps (this is a sketch, expand into a real plan when scoping the work):

1. Wire `RunPodPodService` into the production worker as a backend option behind a feature flag.
2. Default to RunPod SECURE for new jobs; keep ComfyUI Deploy live for fallback during cutover.
3. Add a retry-on-SSH-failure policy at the worker level — the ~10% SECURE failures we saw were intermittent (`Permission denied (publickey)` from hosts where `PUBLIC_KEY` env var injection didn't fire). One automatic retry would push success closer to 100%.
4. Once steady-state, drop ComfyUI Deploy ($100/mo saving).

## Investigations that are *not* the path forward

### The `ssh.runpod.io` proxy

Documented as the universal SSH path. In practice, the proxy's keystore is opaque — registering our key via dashboard *and* via `runpodctl ssh add-key` (verified visible in `list-keys`) still got us "Permission denied (publickey)" on every attempt, including against fake pod IDs. The direct-IP path on SECURE works fine without it, so the proxy is parked. If we ever want SECURE access without exposing public IPs (e.g. for compliance reasons), this becomes worth solving.

### Baked Docker image (`monygroup/flux-comfyui-runtime:v1`)

The hypothesis was that pre-baking models into the Docker image would dramatically cut cold-start by skipping in-job downloads. Two findings killed this:

1. **Image-pull cost ≈ in-job download cost on a marketplace.** A 30 GB compressed image takes 9–32 min to pull on a cold COMMUNITY host. We just moved the bytes from R2 to the registry — same wall clock. The baked approach only wins when the host has the layer cached, which on a random-host marketplace is a coin flip.
2. **The published v1 image is broken.** ComfyUI fails to start with `ModuleNotFoundError: No module named 'yaml'` — the conda/pip prefix split in the `pytorch/pytorch:*` base image meant `pip install -r requirements.txt` didn't end up on the python interpreter that `main.py` actually uses. The README's smoke test only checked "container starts and stays alive," not "ComfyUI imports its config." A second prompt for the build agent (with audit + smoke checklist) is captured separately.

**Architectural conclusion: don't bake models by default. Make the system adaptive.**
- For one-shot or marketplace-style jobs, the unbaked path (download at job time) is just as fast and far more flexible.
- A baked image makes sense only when (a) you control the host pool (dedicated/reserved instances where the image stays cached), and (b) you've fixed the image so it actually boots. Until both are true, baking is overhead with no wall-clock benefit.

## Knowns drawbacks of RunPod SECURE

- ~2x per-hour rate vs VastAI for the same GPU. Steady-state cost matters once pods are warm; the cold-start advantage doesn't apply to long-running inference.
- ~10% SSH-key-injection failures on first boot. Mitigation: worker-level retry.
- COMMUNITY tier still has the same marketplace flakes as VastAI; useful only for cost-sensitive batch work where retries are cheap.
- The proxy story is unsolved — closes the door on key-rotation or public-IP-free workflows for now.
