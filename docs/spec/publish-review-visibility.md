# Publish HOLD visibility — proposal

**Status:** proposal, not a ruling. Prompted by turning on `MODERATION_MANUAL_REVIEW=1` in
production (2026-09-03) — the interim posture that routes every public model/feed publish
through human review instead of the fail-closed `denyModerationGate`. That flag makes HOLD the
*common* outcome for a public-surface publish going forward, not a rare edge case, which exposes
two pre-existing gaps that were mostly invisible while everything just terminal-rejected instead.

**Companion docs:** `docs/spec/moderation-reject-reason.md` (the sibling gap on the REJECT side —
same missing-diagnostics family of bug, different terminal state). `docs/spec/publishing.md`
§4/§8 (the HOLD review flow this builds on).

---

## 1. Gap A — the publishing user never learns their item is under review

`Shelf.tsx`'s `publishModel` (`src/platforms/web/app/src/screens/Shelf.tsx`, current lines
162-196) polls the new edition for up to 24 seconds (8 × 3s) after creation:

```ts
if (polled.status === 'published') { /* ... mark listed, clear pubState ... */ }
if (polled.status === 'failed' || polled.status === 'rejected') {
  setPubState((s) => ({ ...s, [id]: 'err' }));
  return;
}
// loop falls through and tries again — no branch for a HELD item
```

A HOLD verdict (`CrystalApi._settlePublication`) writes `reviewOutcome:'pending'` but leaves
`status` at `'pending'` — by design, `status` only ever becomes `published`/`failed`/`rejected`;
`reviewOutcome` is the separate axis that says *why* it's still pending. The poll loop never reads
`reviewOutcome` at all. For a HELD item, every one of the 8 polls sees `status:'pending'`, matches
neither branch, and the loop just exhausts and returns — no `setErr`, no `pubState` change. The
button (`Shelf.tsx` render, `pubState[id] === 'pending'` branch) is left showing a bare
`"publishing…"` span indefinitely. There is no way for the operator to tell a HOLD apart from a
hung request, a slow HF weight upload, or the process having silently forgotten about it — all
three currently render identically.

This is a correctness-of-communication bug, not a data bug: nothing is lost (the DB state is
correct), but the only human who could act on a HOLD by clicking "approve" doesn't know one
exists, because the person who publishes and the person who reviews are frequently the same
person (an admin publishing their own model) and yet the UI gives them no path from "I just hit
publish" to "oh, it's sitting in my own review queue."

### Options

**(a) Read `reviewOutcome` in the poll loop; render a distinct state.** Add a branch:
`if (polled.reviewOutcome === 'pending') { setPubState(...'held'...); return }` before the loop
exhausts, and a fourth button/label state (e.g. "held for review — see admin/review") alongside
`busy`/`pending`/`err`. Cheapest fix, matches the existing state-machine shape exactly.

**(b) Same as (a), plus a direct link/deep-link to `/admin/review` on the held state** (only
shown when `admin` is true, mirroring the existing `admin && <button>reclassify…</button>`
gating already on this screen) — closes the loop for the common case where the publisher IS the
reviewer, so they can jump straight there instead of remembering the nav item exists.

**(c) Do nothing structural; just extend the honest-pending framing.** Change the pending span's
copy to something like `"publishing… (may require manual review)"` unconditionally, without
distinguishing HOLD from genuinely-still-settling. Cheaper than (a)/(b) but strictly worse
information — doesn't tell the operator whether anything is actually waiting on THEM.

### Recommendation

**(a) + (b) together** — they're the same change, just (b) is one extra conditional link once
(a)'s state exists. This is the smallest change that actually answers "is my publish stuck, or
is it waiting on a human, and if so, which human." (c) is not a real alternative, just a fallback
if (a) turns out to be blocked on something unexpected.

---

## 2. Gap B — the reviewer reviews model holds blind

`Review.tsx`'s `reveal()` (`src/platforms/web/app/src/screens/Review.tsx`, current lines
127-141):

```ts
async function reveal() {
  if (revealing || preview) return;
  setRevealing(true);
  try {
    if (editio.artifact.kind === 'actum') {
      const { run } = await api.getRun(editio.artifact.id);
      const media = mediaFromOutput(run.exitus);
      if (media) { setPreview(media); return; }
      const text = textFromOutput(run.exitus);
      if (text) { setPreview({ text }); return; }
    }
    setPreview('none');
  } catch { setPreview('none'); }
  finally { setRevealing(false); }
}
```

The only branch is `artifact.kind === 'actum'` (a generation run). For `artifact.kind ===
'intella'` (a model promotion — exactly the case `MODERATION_MANUAL_REVIEW` now routes through
this page routinely) the function falls straight to `setPreview('none')`. The reviewer sees only
`intella:<id>` as plain text (`Review.tsx` row render, current line ~162) and a Reveal button that,
when clicked, tells them "No inline preview available." They can still Approve/Reject/csam-confirm
— `act()` doesn't require a preview — but they'd be doing it **without ever seeing the sample
images that triggered the hold**, which defeats the entire point of human review existing as a
safety backstop. `listHeldEditions`/`approveHeldEdition`/`rejectHeldEdition` on the backend are
already artifact-kind-agnostic (`CrystalApi.ts`, confirmed no `kind==='intella'` special-casing
or exclusion) — this is purely a frontend reveal gap, not a backend/auth gap.

### What a model hold actually needs to preview
The moderation gate scans `allMediaUrls(_artifactOutput(ref))` for an `intella` ref, which
resolves to the model's `samples[].url` (its generated preview images — `CrystalApi.ts`
`_artifactOutput`, the `intella` branch). So the reviewer needs, at minimum, those sample image
URLs and their prompts (already carried on the `Intella` record) to make the same call the gate
tried to make.

### Options

**(a) Add an `intella` branch to `reveal()`** that fetches the model (a new or existing
lightweight `GET`, e.g. reusing whatever endpoint the Shelf page already uses to list a single
model, or a small admin-scoped model-lookup route if none returns enough by id alone) and renders
its `samples[]` the same way an image preview renders today — reuse the existing `preview.kind ===
'image'` render branch, just feed it each sample url (may need a small multi-image gallery instead
of the current single-`{url,kind}` shape, since a model hold has 8 images, not 1).
- **Pro:** closes the "reviewing blind" gap directly, reuses the existing image-preview UI.
- **Con:** needs a real endpoint capable of returning samples by intellaId to an admin caller —
  check whether one already exists (`GET /v1/models` is public/filterable but may not return an
  UNLISTED/private model's samples to a non-owner; may need an admin-scoped read, or reuse
  whatever `_artifactOutput`-equivalent the backend already computes and just expose it via a
  small `GET /v1/editiones/:id/preview` that server-side resolves `artifactRef` → media urls,
  independent of the artifact's own visibility/ownership rules since the caller is already
  platform-admin at this point in the flow).

**(b) Generalize server-side: add a `GET /v1/editiones/:id/preview` admin route** that does
exactly what `_artifactOutput` + `allMediaUrls` already do internally (the gate already computes
this at scan time) and returns `{ mediaUrls: string[] }` (or richer, with per-item metadata like
sample prompts) for ANY held editio regardless of artifact kind — future-proofs against a third
artifact kind (`collectio`) needing review later too, rather than hardcoding an `intella`-shaped
fetch into the frontend.
- **Pro:** one server change covers `intella` today and `collectio` (or anything else) later
  without another frontend special-case; matches the existing kind-agnostic backend posture.
- **Con:** slightly more work than (a)'s narrower fetch; needs its own auth check (must require
  the SAME platform-admin gate `approveHeldEdition`/`rejectHeldEdition` already use — never expose
  raw preview urls for someone else's held item to a non-admin).

### Recommendation

**(b)** — it's a small server-side addition on top of code (`_artifactOutput`, `allMediaUrls`)
that already exists and already computes exactly this, it's kind-agnostic (avoids an `intella`
frontend special case that'll need a `collectio` sibling the next time review needs to cover a
different artifact kind), and it keeps the "what does a reviewer see" logic server-side rather
than teaching the frontend how to reconstruct the same view the gate itself used to make its call
— those two views should never be allowed to drift apart. (a) is an acceptable fallback if the
admin-auth-on-preview requirement turns out to be awkward to add as a standalone route in the
time available.

---

## 3. Test / migration implications

- **`Shelf.test.tsx`** (or wherever Shelf's publish flow is tested, if it exists — check
  `tests/unit/web/` / `src/platforms/web/app/src/**/*.test.tsx`) — add a case: polling an edition
  that returns `status:'pending', reviewOutcome:'pending'` for all 8 polls results in the new
  "held for review" `pubState`, not silently falling through with no state change.
- **`Review.test.tsx`** (or equivalent) — add a case: revealing an `intella`-kind held editio
  calls the new preview endpoint and renders its media, instead of always resolving to `'none'`.
- **New route test** (if option (b) ships) — `tests/unit/api/` — a platform-admin caller gets
  media urls for a held `intella` editio; a non-admin caller is refused; a non-existent/non-held
  editio 404s.
- No DB migration needed either way — this is UI/API surface only, no schema change.

---

## Resolution

| # | topic | recommendation | resolution |
|---|---|---|---|
| 1 | Publishing-user visibility into a HOLD (Gap A) | Poll loop reads `reviewOutcome`, new "held for review" state + admin deep-link to `/admin/review` | _open_ |
| 2 | Reviewer preview for non-`actum` holds (Gap B) | New kind-agnostic `GET /v1/editiones/:id/preview` admin route, reused by `Review.tsx`'s `reveal()` | _open_ |
