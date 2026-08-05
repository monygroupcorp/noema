# Backend tickets · land the plane

**Source:** the P0 pass ([UX Handoff 3](./2026-07-03-ux-3-p0-handoff.md)) triaged every core job into
*wire-now* vs *backend-blocked*. The frontend is now honest end-to-end — no dead buttons, no fiction —
but **five core jobs can't complete because the backend endpoint doesn't exist.** Each surface is
currently an honest "coming soon"; this doc is the work to flip them to real.

Convention across the codebase (for every ticket):
- HTTP route → `src/allocutio/api/apiRouter.ts`
- Logic + ownership → `src/allocutio/api/CrystalApi.ts` (add a method + to the `ApiFacade`)
- Contract + generated docs → `src/allocutio/api/apiContract.ts` (then regenerate `docs/api/*`)
- Web client method → `src/platforms/web/app/src/lib/api.ts`
- Auth: identified-only unless noted; anon uses the arcanum commitment (see `authRouter`/`AuctorKey`).

Each ticket: **problem → frontend waiting → backend today → build → done when → notes.**

---

## T1 · GDPR: account data export + deletion  ·  **priority: HIGH (legal)**
- **Problem:** a user's legal right to export and delete their data has no endpoint. Load-bearing for
  compliance, not a nice-to-have.
- **Frontend waiting:** `AccountSettings.tsx` — "Export everything" and "Delete account & data" are
  disabled "coming soon" with a legal-rights note. Flip both to real handlers when the endpoints land.
- **Backend today:** nothing. No export/delete/erase route anywhere in `apiRouter.ts`/`CrystalApi.ts`.
- **Build:**
  - `POST /v1/me/export` → assemble the caller's data (account/`Consuetudo`, `Provincia` projects,
    `Actum` run history, `Intella` owned models, `Editio` publications, purses) into a downloadable
    archive (async job → signed URL, mirroring the R2 signed-PUT pattern already used for uploads).
  - `DELETE /v1/me` → hard-erase the account and its owned rows; must also revoke sessions
    (coordinate with the multi-account session store) and purses. Decide the anon-commitment story
    (the anon soul is separate — document what deletion does/doesn't reach).
- **Done when:** a user can download a complete export, and delete their account + data, from
  `AccountSettings`; deletion is irreversible and confirmed with an explicit typed confirmation on the
  frontend (destructive — gate it).
- **Notes:** compliance-sensitive; see `docs/legal/` and the compliance-posture memory. Deletion is a
  "permanently deleting data" action — the frontend must double-confirm; the backend must be
  authoritative (don't rely on client-side).

## T2 · Card / fiat funding  ·  **priority: HIGH (revenue)**
- **Problem:** the fastest, most accessible purchase path (card) can't complete — no processor.
- **Frontend waiting:** `Funding.tsx` — "Pay with card" is disabled "coming soon". The onchain rail
  (Connect + copy deposit address → send ETH → webhook credits) already works and is the reference.
- **Backend today:** onchain only — `GET /v1/deposit/config` + `POST /v1/deposit/quote`
  (`apiRouter.ts:468/475`). The onchain **webhook** credits authoritatively using the FMV oracle
  (`CrystalApi.ts:160-161`); a quote's `pointsQuoted` equals what the webhook credits. No card path.
- **Build:** a Stripe (or chosen PSP) rail that lands credits through the **same credit path** the
  deposit webhook uses (so pricing/funding-rate stays single-sourced):
  - `POST /v1/checkout/session` (identified) → PSP checkout session for a USD pack.
  - `POST /v1/checkout/webhook` (PSP-signed, no auth) → on `payment_succeeded`, credit impetus via the
    existing grant path (reuse `usdMicroToImpetus` / funding-rate logic in `ledger/`).
- **Done when:** a card purchase completes end-to-end and the balance updates; pack chips
  (`Funding.tsx`, `PACK_USD`) drive the checkout amount.
- **Notes:** closed-loop credits (non-transferable/withdrawable) — keep the compliance framing
  (avoid MSB/securities); see the compliance-posture memory. PSP keys are server-only secrets.

## T3 · Per-run spend ledger  ·  **priority: MEDIUM (data mostly exists)**
- **Problem:** users see balance + *active* runs, but no settled history, per-run cost, or
  spend-over-time.
- **Frontend waiting:** `Status.tsx` (Activity) — the "Spend" section is an honest empty state
  ("a per-run credit ledger … lands here once the backend exposes spend history").
- **Backend today:** `MeStatus.gens` is **active-only** (`GenEntry.status` = `nascens|agens`). But
  settled runs *are* persisted — `getRun` owner-scopes against the `Actum` store
  (`CrystalApi.ts:389-417`, `this.deps.actorum.findById/findByCompositum`), and cost/impetus rates
  live in `ledger/rates.ts` (`impetusForPodMs`). So the data largely exists; it's an exposure gap.
- **Build:** `GET /v1/me/runs?status=settled&cursor=…` (identified + anon-commitment) → paginated
  owned `Actum` records with `{ modusLabel, status, cost (impetus + USD), createdAt, settledAt }`, plus
  a running total. Extend `MeStatus` or add a dedicated ledger view.
- **Done when:** Activity shows settled runs with per-run cost and a running total, paginated.
- **Notes:** identity-blind ownership already solved for `getRun` — reuse it. Two-book accounting
  (ADR-0013) may want the USD-FMV-at-spend column; coordinate with `[CPA]` items.

## T4 · Datasets backend (create + list)  ·  **priority: MEDIUM-LARGE (gates the training stack)**
- **Problem:** the entire training stack's front door is inert — there is **no dataset backend at all.**
- **Frontend waiting:** `Datasets.tsx` renders a local `DATASETS` mock; both "new dataset" affordances
  are disabled "coming soon". Note the client already *calls an unserved route*:
  `api.listDatasets` → `GET /v1/data/datasets` (`lib/api.ts:311`) — nothing serves it.
- **Backend today:** nothing — no dataset routes in `apiRouter.ts`. (Adjacent pieces exist:
  `crystal/datasetManifest.ts`, R2 signed uploads, captioning cursors — but no dataset entity/store.)
- **Build:** a `Dataset` crystal entity + store (owner-scoped by `animaId`, like `Provincia`), with:
  - `GET /v1/data/datasets` (serve the route the client already calls) + `GET /:id`.
  - `POST /v1/data/datasets` → create (drop media via the existing R2 signed-PUT path, or seed from a
    generation/`Actum`).
  - Wire `Provincia.res.datasetIds` (holdings already reference dataset ids) to real datasets.
- **Done when:** "new dataset" opens a real create flow; the library lists real datasets;
  `HoldingToggle`/ProjectHub scoping operates on real ids.
- **Notes:** biggest scope here. Pairs with T5 (a dataset is the input a training run consumes). Decide
  custody/modality/captionset model up front (the mock in `lib/datasets.ts` sketches the shape).

## T5 · Training-runs index + live status  ·  **priority: MEDIUM (depends on T4)**
- **Problem:** `TrainRun.tsx` is fully simulated; a finished run can't be re-found or linked to its
  model, and there's no list of active/finished runs.
- **Frontend waiting:** `TrainRun.tsx` now has a real "View your shelf →" `/models` link and is marked
  a **preview**; it needs a live job to bind to and an index to be re-findable after refresh.
- **Backend today:** the run→model link **already exists at finalize** — `crystal/trainingFinalizer.ts`
  registers the output as a private `lora` `Intella` (queryable via `/v1/me/models`). What's missing is
  a persisted **training-run record** and endpoints to enumerate/track runs. Training cursors exist
  (`AitoolkitTrainingCursor.ts`, `RemoteAitkLauncher.ts`) but no run index is surfaced.
- **Build:**
  - Persist a training-run record `{ jobId, animaId (owner), datasetId, status, progress, startedAt,
    resultIntellaId? }` (write on launch, update on progress, set `resultIntellaId` in the finalizer).
  - `GET /v1/me/training-runs` (list active + finished) + `GET /v1/me/training-runs/:id` (live status).
  - Deep-link completion → the resulting model on the shelf (`resultIntellaId` → `/models`).
- **Done when:** finishing a run leads to the model in ≤1 click, and an in-flight run is re-findable
  after refresh; TrainRun binds to `:id` real state instead of the simulation.
- **Notes:** consumes T4 (dataset ids). The finalizer already does the hard part (output → Intella);
  this is mostly a run-record + index + status stream.

---

### Suggested order
1. **T1 (GDPR)** + **T2 (card)** — legal + revenue, both self-contained, no cross-deps.
2. **T3 (spend ledger)** — small; the data exists, it's an exposure endpoint.
3. **T4 (datasets)** → **T5 (training index)** — the training stack, T5 after T4.

When T4/T5 land, the datasets/training surfaces come off "preview"; when T1–T3 land, Funding/Activity/
Account are fully real. That closes the P0 audit's "every core job completes end-to-end" bar.
