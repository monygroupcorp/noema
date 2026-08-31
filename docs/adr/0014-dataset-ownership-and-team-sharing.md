# ADR-0014: Dataset ownership and team sharing

- **Status:** **proposed — for rth's ruling.** Nothing here is settled. The code on
  `noema-374-dataset-team-sharing` implements the decision below because a ticket asked for the
  capability, not because this ADR has been accepted. If rth rules differently, the code moves.
- **Date:** 2026-08-31

## Context

A `Dataset` has, until now, been owned by exactly one scalar `animaId`, set at creation, with no
transfer path and no sharing of any kind. `getDataset` compared `d.owner !== owner` and 404'd;
both list routes filtered on `{ owner }` in the store query; every write route resolved through
that same gate. A stranger could not tell "not yours" from "does not exist", which is the property
worth keeping.

The forcing case: the helm fleet account (`helm-fleet-01`) owns the landing house-look dataset, and
rth's personal account must be able to see it and add to it. Two accounts, one working set. Today
that is impossible without handing over the fleet account's credentials.

Three facts about the tree shaped what follows.

1. **The team primitive already exists and already works.** `Sodalitas` — "a fellowship of Animae
   that co-owns work" (`src/types/sodalitas.ts`) — is flat mutable membership with a shipped REST
   surface (`POST/GET /v1/teams`, members add/remove). ADR-0001 forbids inventing a parallel
   vocabulary, so a second sharing noun was never on the table.

2. **There is a sanctioned shape for using it, and an unsanctioned one.** `Collectio.sodalitasId`
   is honoured in `_ownsCollection` — direct owner, then `team?.membra.includes(auctor.animaId)` —
   and `listCollections` resolves the caller's team ids once and filters with them.
   `Provincia.sodalitasId` stores the same field, validates it on write, projects it as `teamId`,
   and **grants nothing**: `_ownedProject` still compares `animaId` only. `Collectio` is the
   pattern; `Provincia` is a field that looks like a decision and is not one.

3. **`ADR-0003` fixed the ownership union `{ animaId } | { commitment }` and is silent on
   datasets.** Datasets are `animaId`-keyed and cannot be owned by an anonymous caller at all
   (`_datasetOwner` refuses), so the union is not the axis in question here. Sharing is.

## Decision

**A dataset is owned by one Anima and may be shared with one `Sodalitas`. The team is an overlay
on the owner, not a second owner.**

1. **`Dataset.sodalitasId?: string`** — `Collectio.sodalitasId` reused verbatim in shape and in
   meaning. Absent means owner-only, which is every dataset that exists today. No new noun.

2. **The overlay grants READ and CONTRIBUTE.** A member of the named team may:
   - resolve the dataset (`getDataset`) and see it on both list routes;
   - append media to it (`POST /v1/data/datasets/:id/media`);
   - attach and edit captionsets.

   `getDataset` is the single seam all of those resolve through, so widening it once widens them
   together — which is the point: one place decides what "this caller may reach this dataset"
   means. A caller with no claim still gets `not_found`, never `forbidden`.

3. **The overlay does NOT grant the destructive verbs.** `archiveDataset`, `restoreDataset`,
   `archiveDatasetMedia` and `restoreDatasetMedia` resolve through a narrower
   `_ownedDatasetByOwner` and compare `animaId` only. This is `Collectio`'s own shape a second
   time: `_ownedCollection` admits every member, and `extendCollection` re-checks `_isFunder` on
   the one verb a member must not perform on the principal's behalf. The line drawn here is
   **adds to the set vs. removes from it** — a member contributes to the working set; deciding
   what leaves it stays with the owner.

4. **The Actum gate does not widen with the dataset gate.** `_mintMedia` still requires every
   named Actum to be **the caller's own** and `completus`. A member contributes their own
   generations, never the owner's and never another member's. Sharing a dataset gives someone a
   place to put work; it gives them no claim on anyone's runs. This is the check most at risk of
   being widened "for consistency" — it must not be.

5. **`DatasetMediaItem.addedBy?: string`** — the animaId of whoever added the item, resolved from
   the authenticated caller at mint time and never from the request body. It is the WHO to
   `addedAt`'s WHEN. A shared dataset whose items cannot be attributed cannot be audited, curated
   or credited. Optional, and **not backfilled**: documents written before this field existed
   carry no attribution, and a guess would assert a fact nobody recorded.

6. **`sodalitasId` is set at creation and is not patchable.** `POST /v1/data/datasets` accepts
   `teamId` (the API's existing wire word — `POST /v1/me/projects`, `POST /v1/collections`),
   validated through the same `_memberTeam` seam those two use, so a caller can only share with a
   team they themselves belong to. **No patch path is added**, for three reasons: the `Datasets`
   store interface has no `update`/`setOwner` seam at all, so a patch is a store widening rather
   than an API addition; re-pointing a dataset at a different team retroactively changes who may
   read work already contributed under the first team's understanding, which is a ruling, not a
   convenience; and membership is already mutable through the team itself — adding a person to the
   `Sodalitas` is the intended way to widen access, and removing them closes it again immediately,
   because membership is read live off the team store and never snapshotted onto the dataset.

7. **Membership is read live, never snapshotted.** Unlike `Collectio.owners` — an equal-weight
   rights split frozen at creation because it feeds a royalty record — a dataset stores no member
   list. Access is a question answered against the `Sodalitas` at read time. Datasets carry no
   economics, so there is nothing here that needs a frozen split.

### What this deliberately does NOT do

- **No public/`access` visibility flag.** `MongoDataset.findOwned` carries a pre-written
  `$or: [{ owner }, { access: 'public' }, { 'access.kind': 'public' }]` and `Intella` already has
  an `access` field; both anticipate a public flag. **This ticket does not light them up.** Sharing
  a dataset with a named fellowship and publishing it to everyone are different decisions with
  different blast radii, and they should be ruled on separately. The dead arms are still dead.
- **No widening of `findOwned` itself.** That seam is what `_assertOwnedAditus` resolves a
  *dataset reference on a run* through. It still honours `owner` only. See the open question below.
- **No ownership transfer.** Out of scope, and a separate decision from sharing.
- **Nothing changes for `Provincia`.** `Provincia.sodalitasId` still grants nothing. Making it
  grant something is real, adjacent, and its own ticket — but note that after this change the tree
  has *two* honoured overlays (`Collectio`, `Dataset`) and *one* inert one, which strengthens the
  case that the inert one is a bug rather than a decision.

## Open questions for rth

These are the parts I did not feel entitled to settle. The implementation takes the conservative
branch of each — the one that grants less — so a ruling in the other direction is an addition
rather than a retraction.

1. **Is the destructive/additive line the right line?** As built, a member may add media and
   captions but may not archive the dataset or archive a media item — not even one they
   contributed themselves. The alternative is that curation is exactly what collaborating on a
   training set means, and a member should be able to retire media (their own, or any). A third
   option is "a member may archive what they added" — now expressible, because `addedBy` records
   it. **Chosen for now: owner-only, because it is the reversible choice.**

2. **Should a team member be able to TRAIN on a shared dataset?** Today they cannot: a run that
   names a dataset in its `aditus` resolves through `Datasets.findOwned`, which is still
   owner-only, so a member can read the house-look set but cannot point a training run at it. That
   asymmetry is odd and probably wants closing. It is left open because it is a ruling about whose
   compute runs on whose data, which the read decision does not imply. **This is the question most
   likely to bite in practice** — it is the difference between "rth can see and add to the fleet's
   dataset" and "rth can actually use it".

3. **Should captioning have been on the member side of the line at all?** It is additive, and a
   training set is media *plus* captions, so it went with contribution. But a caption edit
   overwrites someone else's annotation, which is the one member-reachable write that is not
   purely additive.

4. **Is one team per dataset enough?** `sodalitasId` is a single FK, matching `Collectio`. A
   dataset shared with two teams would need an array, and an array is a different thing to reason
   about. Single is proposed.

## Consequences

- **Enforcement is the route test.** `tests/unit/allocutio/api/datasetsRoutes.test.ts` asserts a
  member read, a member contribution, the attribution recorded, the Actum gate *not* widening, the
  destructive verbs staying owner-only, live membership (a removal closes access again), fail-closed
  behaviour with no team store wired, and a non-member 404 on every route of a genuinely shared
  dataset. The two pre-existing closure tests were **extended, not relaxed** — they now assert
  closure against a team-shared dataset as well as a private one.
- **The access predicate stays in the query.** `DatasetListOpts.sodalitasIds` carries the caller's
  team ids into `MongoDataset._page`, so the union is one filtered result set the cursor paginates,
  not a page that is post-filtered. The caller's team ids are resolved once per list call
  (`listCollections`' precedent), not once per row.
- **Fail closed.** No team store wired, an anonymous caller, or an absent `sodalitasId` all fall
  through to owner-only. Nothing a stranger could not reach before becomes reachable now.
- **The API contract moved in step** (`apiContract.ts` → regenerated `docs/api/`), which the
  hermetic drift check enforces.
- **Follow-ups if this is accepted:** the training-reference question (open question 2) is the
  first real one; a UI for choosing a team at dataset creation is not built; nothing backfills
  `addedBy` onto existing items.
