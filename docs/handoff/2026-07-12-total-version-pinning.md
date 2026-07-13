# Spec — total version pinning: every ref a pod resolves is owned by the crystal

**Date:** 2026-07-12 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started
**Owner directive:** "all our materia and intellae and modus should be pinned version based so
that it will always work." Supersedes-and-absorbs `2026-07-10-comfyui-torch-drift.md` (that doc
is the P0 symptom + hotfix; this is the invariant that makes the class extinct).

## The invariant
A run's behavior is fully determined by the version-pinned crystal chain:
**Modus → Essentia (`fundamentumVersio`) → Fundamentum (`versio`, `contentHash`) → image tag +
runtime-code refs + weight digests.** Nothing a pod downloads at provision time may float.
Same ids + same versions ⇒ same bits, today or in a year. Upstream can only change our
behavior via a deliberate commit that bumps a pin.

## Where the invariant already holds (do not rebuild)
- `Fundamentum.versio` + `contentHash` (types/fundamentum.ts:41-44) — definition is locked,
  TEE attestation signs it.
- `imageId`/`imageVersion` — OCI tag pinned in every seed (fundamenta.ts).
- Essentia pins `fundamentumVersio`; Modus/flows pin versions throughout (ADR-0005).

## Where it leaks (the fix list, verified 2026-07-12)
1. **ComfyUI: unpinned HEAD.** `SecurePodClient.ts:751` `git clone --depth 1 …ComfyUI.git`.
   Broke ALL ComfyUI substrates 2026-07-10 (`enable_gqa` vs torch 2.4 — see the torch-drift
   handoff for the live repro). THE P0.
2. **ai-toolkit: unpinned HEAD.** `RemoteAitkLauncher.ts:127` `git clone …ostris/ai-toolkit`.
   Memory of drift already exists (4.10.x "fallback handles drift" — that fallback is a
   symptom of the same disease).
3. **pip trees: transitively unpinned.** `pip install -r requirements.txt` at
   `SecurePodClient.ts:752` (ComfyUI's) and `RemoteAitkLauncher.ts:129` (ai-toolkit's) —
   requirements files of a floating checkout, themselves mostly unpinned upstream.
4. **Weights: no integrity.** `Fundamentum.intellae` refs → Intella download URLs; nothing
   records or verifies a content digest. A silently re-uploaded upstream file (HF revision
   moves, Civitai re-upload) changes our bits with zero signal.
5. **Model-card repos:** `pip install -e .` of modelcard repos at load
   (`SecurePodClient.ts:739` comment) — same class, audit while in there.

## Shape
1. **Fundamentum grows pinned runtime-code refs** (crystal-first: the Fundamentum is already
   the version-pinned substrate definition — runtime code belongs on it, not in cursor
   string literals):
   ```
   runtimeSource?: { repo: string; ref: string }        // e.g. ComfyUI repo + tag/sha
   runtimeExtras?: Array<{ repo: string; ref: string }> // custom nodes / aitk / modelcards
   ```
   Bootstrap code (`SecurePodClient`, `RemoteAitkLauncher`) reads these — `git clone --depth 1
   --branch <ref>` (or clone+`git checkout <sha>`). No repo URL or ref string lives in a
   cursor again. Changing a ref = seed edit + `versio` bump + `contentHash` change — exactly
   the ADR-0005 discipline that already governs everything else.
2. **Python deps pinned per substrate.** Ship a lock per (runtimeSource ref): generate
   `pip freeze` once on a verified pod, store as an artifact keyed by the Fundamentum
   (`runtimePipLock`? — or simply accept the upstream repo's own lock when the ref is a tag
   and the repo pins; decide per-runtime, document the decision on the seed). Bootstrap
   installs `-r <lock>` — never a floating requirements.txt of a floating checkout.
3. **Intella grows a weight digest.** `digest?: 'sha256:…'` (+ `bytes`) on the Intella;
   pod-side downloader verifies after fetch, fails the run loudly on mismatch
   (fail-closed — a changed upstream file must never silently run). Backfill: compute at
   next successful download per intella (write-once), and at import time for the
   import-by-URL path (model-import already streams the file — hash inline). Catalog seeds:
   backfill script hashes each canonical weight once.
4. **Guards (hermetic, cheap, permanent):**
   - no `git clone` in `src/` without `--branch`/explicit checkout (string-level test over
     the cursor/launcher sources);
   - no `:latest`/missing image tag in fundamenta seeds;
   - every canonical Fundamentum with a `runtimeSource` has a non-empty `ref`;
   - (once digests backfilled) every canonical Intella has `digest`.
5. **Immediate hotfix rides along** (from the torch-drift spec): pick (image torch ≥ 2.5,
   ComfyUI tag) pair, verify flux-schnell then klein live on staging, reseed. The hotfix
   lands as the FIRST use of `runtimeSource`, not a parallel mechanism.

## Acceptance
- Zero unpinned clone/tag/digest in `src/` (guards green, enumerable by grep).
- flux-schnell + klein staging runs green on the pinned pair; re-running a week later hits
  identical refs (assert from logs: cloned ref + verified digests appear in bootstrap logs).
- Bumping ComfyUI = one seed diff (ref + versio + contentHash) — nothing else changes.
- A tampered weight (wrong digest fixture in hermetic test) fails the run with a loud,
  specific error, never executes.
- Docs: ADR addendum (0005 or new) recording the invariant: "a pod may not resolve a
  floating ref."

## Leads
- `src/crystal/SecurePodClient.ts:748-760` (ComfyUI bootstrap), `:291,331-342,739`
  (aitk setup + modelcard note) · `src/crystal/RemoteAitkLauncher.ts:127-133`.
- `src/types/fundamentum.ts:37-62` (versio/contentHash/imageVersion/intellae — the pattern
  to extend) · `src/types/intella.ts` (digest home) · `src/crystal/seeds/fundamenta.ts`.
- Weight download path for digest verify: comfyrunner model preflight
  (`scripts/pod/comfyrunner.py`, `cursor:comfyrunner` "model download started/downloaded" —
  note `downloadBytes:0` metric is dead; fix while in there).
- Import-by-URL hash-inline: the model-import pipeline ([[project_model_import]]).
