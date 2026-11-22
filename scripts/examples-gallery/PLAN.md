# The 8 — examples-of-our-own showcase plan

rth's ruling set the target count at **8** (2026-11-20, "which one?" → picks 8). A second ruling
on this same plan corrected its weighting: *"We don't give a shit about openai image really it's
boring and we only have it to be quick we want to showvase the rh pod ones with trained models."*
— read as: RunPod-pod flows and trained/forked models are the showcase; `gpt-image` is the quick
fallback, not the bulk. This revision reflects that.

Every row is fired with `scripts/examples-gallery/fire-example.ts` (generalized to take
`--aditus '<json>'` for any modus, not just `--prompt` for gpt-image) against a scratch DB
(`CRYSTAL_DB`, never `noema`/`noemaplane`), then the real JSON row goes into
`src/platforms/web/app/src/lib/exampleGallery.ts`'s `SHOWCASE_EXAMPLES`.

| # | id | feature | kind | modus | needs |
|---|----|---------|------|-------|-------|
| 1 | model-01 | model | image | `stationthis` — the real forked/LoRA custom modus already seeded (`src/crystal/seeds/modiCustom.ts`): forks `klein-edit-4b`, stacks the `impresstation-klein` LoRA | **RunPod** |
| 2 | model-02 | model | image | `modus.aitoolkit-training` trains a fresh LoRA from a small image set + trigger word, then a make/edit flow generates with it — the "trained" half of clause 3, distinct from `stationthis`'s "forked" half | **RunPod** (two pod jobs: train, then generate) |
| 3 | muse-01 | muse | image | a captioned/decomposed dataset (`modus.dataset-caption` → `modus.dataset-decompose`), one fragment combo kept, generated on a pod flow (FLUX/Krea), not gpt-image | **RunPod** (captioning "runs on a provisioned, billed pod" — `DatasetCaptionCursor.ts`) |
| 4 | video-01 | make | video | `wan22-t2v` — Wan2.2 text-to-video (MoE), the higher-quality pod t2v | **RunPod** |
| 5 | video-02 | make | video | `wan22-i2v` or `minimax-h3-fl2v` — animates a still into motion | **RunPod** |
| 6 | video-03 | make | video | `minimax-h3-t2v` — text-to-video **with synced audio** in one pass, a flashy noema-only capability (no OpenAI equivalent) | **RunPod** |
| 7 | collections-01 | collections | image | a trait-grid collection (`Collections.tsx`'s pattern — one flow, one prompt axis, several values) run on `flux-schnell` or `krea-turbo`, not the gpt-image seed default | **RunPod** |
| 8 | make-01 | make | image | `modus.gpt-image` — the one quick/cheap anchor for the "make" bucket, kept to exactly one per the ruling above | OpenAI only |

7 of 8 need a RunPod pod up; only the one `make` anchor is OpenAI-only. This is a real shift from
this plan's first draft (5 OpenAI-only / 3 RunPod) — expect real GPU minutes and real $ across
training (slowest), captioning, two video renders, and three more pod generations. I have not
run one of these myself, so I can't price it precisely; `modus.aitoolkit-training` and the video
modi are the heaviest by wall-clock.

## What's unchanged from the first draft

- No example's text or media is copied or adapted from any third-party corpus — every row above
  is a real, already-registered noema modus, fired for real.
- This worktree still has no path to live `OPENAI_API_KEY`/`MONGODB_URI`/`RUNPOD_*` — gripe
  `g-4c355a68` (open) — and copying the primary checkout's `.env` in was refused by this session's
  own guard as unauthorized credential access, which I did not try to route around. Firing these
  8 needs rth (or a seat rth hands credentials to directly) to run them, or a decision on how
  credentials should reach a worktree safely. With 7 of 8 rows now RunPod-bound, this is now the
  binding blocker on every clause but 2.

## What this seat built without credentials

- Generalized `fire-example.ts`: `--aditus '<json>'` for any modus, exitus extraction reads
  `image` or `video`, OpenAI key now optional (host-side/pod modi never touch it). Verified:
  `npm run typecheck` and `npm run test:hermetic` both green (3696/3696), no regressions.
- This plan — now weighted to rth's ruling: pod flows and trained models lead, gpt-image is the
  one quick anchor.

## Still open after this plan is approved

- Fire all 8, hand back the real `{id, modusId, aditus, mediaUrl, actumId}` rows.
- Write the 8 rows into `SHOWCASE_EXAMPLES`, pick `style` tags per row (the third facet axis).
- Re-run `exampleGallery.test.ts`/`Card.test.ts` against the populated set.
- rth's verdict on the finished set (clause 6).

## Second blocker found this session (2026-11-22): `fire-example.ts` can't fire any of the 7 RunPod rows yet, credentials or not

Checked each of the three cursors the RunPod-bound rows above actually dispatch to:
`RunPodCursor.ts` (image/video pod rows), `RemoteAitoolkitTrainingCursor`/`AitoolkitTrainingCursor`
(model-02's training), `DatasetCaptionCursor.ts` (muse-01's captioning). All three return
`{ kind: 'async', externusJobId }` — the pod runs in the background and a completion webhook
finalizes the actum later. `fire-example.ts` only handles the synchronous path (`dispatchInceptio`
returning `exitus` immediately, true for `modus.gpt-image` and the host-side ffmpeg/composite
cursors) — it throws `exitus missing` on every async row today, and `compile` is still the
not-needed stub from the first draft.

Firing an async row for real needs the shape `scripts/spike-koh-remote.ts` already proves for
training: a reachable public webhook endpoint (that script tunnels one with ngrok), the real
`Compiler` wired the way `src/index.ts` wires it (`templateRegistry`, `fundamentorum`,
`WEIGHT_PROXY_BASE`), and `createContainer` given `runpodClient` + `runpodWebhookUrl` (+
`runpodR2`/`aitoolkitRemote` for the training and captioning rows) so it registers
`RunPodCursor`/`RemoteAitoolkitTrainingCursor`/`DatasetCaptionCursor` instead of leaving them
unregistered. None of that exists in this script yet, and every feature clause 3 needs
(muse, collections, a trained/forked model) plus every video row is async — there is no cheaper
sync-path substitute for any of them in the current modus set (no video modus here runs anywhere
but a `-comfyui` RunPod fundament).

I did not build this blind: it needs a live RunPod account, a network-reachable webhook (or a
tunnel), and real pod minutes to prove it works at all, none of which this sandboxed worktree can
reach (`OPENAI_API_KEY`/`MONGODB_URI`/`RUNPOD_*`/`.env` access is refused here — same guard as
`g-4c355a68`). Writing the harness without ever firing it against a real pod would be a guess
dressed as code. This needs rth, or a seat rth hands real credentials AND a reachable host to
directly (his own machine, or a droplet) — the sandboxed worktree path is not the way any of the
8 rows get fired.
