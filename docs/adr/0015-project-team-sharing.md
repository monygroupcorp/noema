# ADR-0015: Project (Provincia) team sharing

- **Status:** **proposed — for rth's ruling.** Nothing here is settled. The code on
  `noema-381-project-team-sharing` implements the decision below because a ticket asked for the
  capability, not because this ADR has been accepted. If rth rules differently, the code moves.
- **Date:** 2026-08-31
- **Sibling:** ADR-0014 (dataset ownership and team sharing). This is the same overlay on the
  neighbouring noun, and it deliberately reuses that ADR's decisions rather than re-deriving them.

## Context

`Provincia` — a project, the account-scoped workspace lens — has carried
`sodalitasId?: string` since it was defined, with a doc comment stating the intent outright:
*"SHARING references a Sodalitas (Team), it does not re-implement membership."* The field is
validated on write (`createProject`/`updateProject` resolve it through `_memberTeam`, so a caller
can only name a team they belong to) and projected on read as `teamId`.

**It was consulted in no access check.** `_ownedProject` compared `project.animaId !== animaId`
and `listProjects` read `listByOwner(animaId)`, so a project could name a team and no member of
that team could see it. A field that is stored, validated and displayed but never read is worse
than an absent one: it reads as a working feature.

Two honoured overlays already existed to copy from. `Collectio.sodalitasId` is honoured in
`_ownsCollection` (direct owner, then `team?.membra.includes(auctor.animaId)`), and ADR-0014
shipped the same shape for `Dataset` in v5.22.0 — `_ownsDataset`, `_datasetTeamIds`, and the
access predicate composed into `MongoDataset._page`'s query. ADR-0001 forbids inventing a parallel
vocabulary, so a second sharing noun was never on the table; the only question was which verbs the
existing overlay reaches.

## Decision

**A project is owned by one Anima and may be shared with one `Sodalitas`. The team is an overlay
on the owner, not a second owner.** ADR-0014's decision, restated for `Provincia`.

1. **`Provincia.sodalitasId?: string` is honoured.** The field is unchanged; what changed is that
   the access checks now read it. Absent means owner-only, which is every project that exists
   today.

2. **The overlay grants READ and FILE.** A member of the named team may:
   - resolve the project (`GET /v1/me/projects/:id`) and see it in `GET /v1/me/projects`;
   - file an asset reference into its holdings (`POST /v1/me/projects/:id/holdings`).

   `_readableProject` is the single seam both resolve through, so widening it once widens them
   together. A caller with no claim still gets `not_found`, never `forbidden`.

3. **The overlay does NOT grant the verbs that remove.** `deleteProject`, `unfileAsset` and
   `updateProject` resolve through the unchanged `_ownedProject` and compare `animaId` only. This
   is ADR-0014 §3's line — **adds to the set vs. removes from it** — drawn again.

   `updateProject` is the one place this ADR goes *narrower* than a naive reading of that line,
   and the argument is on the record: a metadata patch is neither additive nor confined to the
   project, because `teamId` **is** the sharing decision. A member reaching it could re-point the
   project at a team of their own or clear the reference and lock every other member out. The
   overlay adds readers and contributors; it does not add a principal who may re-draw the boundary
   that admitted them. (`Dataset` did not have to decide this — ADR-0014 §6 gave `sodalitasId` no
   patch path at all. `Provincia` has had one since it was written, so the gate is where the
   decision lands.)

4. **A HOLDING IS A REFERENCE, NOT A GRANT.** This is the load-bearing one, and it is the state
   the ticket flagged as the trap: a project shared with a team may file datasets that are **not**
   shared with that team. That is a coherent state — sharing a workspace lens and sharing a
   training set are separate decisions taken at separate times — and reaching the project must not
   resolve those assets.

   It does not, and not by a filter that could be forgotten: reaching a project widens nothing at
   all about the assets it names. Every asset store keeps its own gate, and each is reached by the
   asset's own id through its own seam (`getDataset` → `_ownsDataset`, `_ownedCollection`,
   `_ownedIntella`). `Provincia.datasetIds` is a list of names; `CrystalApi` never expands it, and
   `toProject` projects it verbatim. So a member of a shared project sees the *ids* the owner filed
   there — that is the project's content, put there deliberately — and an id they may not resolve
   is still an id they may not resolve.

   The corollary holds in the other direction too: `fileAsset` does not validate that the caller
   can reach the asset they name, and it does not need to, because filing lends nothing.

5. **Membership is read live, never snapshotted.** As ADR-0014 §7: a project stores no member
   list. Access is a question answered against the `Sodalitas` at read time, so adding a person to
   the team widens access immediately and removing them closes it again, with nothing to backfill.

6. **The list's access predicate goes into the store query.** `Provinciarum.list(opts)` takes
   `{ animaId, sodalitasIds }` — `DatasetListOpts`' shape — and `MongoProvinciarum.list` composes
   `{ $or: [{ animaId }, { sodalitasId: { $in: teamIds } }] }`. The caller's team ids are resolved
   **once per list call** from the authenticated caller (`_callerTeamIds`), never per row and never
   from a request parameter. With no team ids the filter is the bare `{ animaId }` it has always
   been.

7. **`listByOwner` survives, deliberately narrower.** It has no `sodalitasIds` seam and never
   will: it is what `MeExporter` reads, and an account export is what the account **owns**, never
   what a team lent it. This is `Datasets.findOwned`'s role in ADR-0014 — a second, narrower seam
   kept on purpose because a different question is being asked.

8. **`_datasetTeamIds` is now `_callerTeamIds`.** "The teams this caller belongs to" is one
   question with one answer; a per-noun copy would be a second place for two overlays to disagree
   about what membership means.

### What this deliberately does NOT do

- **No ownership transfer.** Out of scope, and a separate decision from sharing.
- **No public/visibility flag.** Sharing a project with a named fellowship and publishing it to
  everyone are different decisions with different blast radii.
- **No widening of any asset gate.** Datasets, collections and models are reached by their own ids
  through their own seams, unchanged. In particular, ADR-0014's open question 2 — whether a team
  member may TRAIN on a shared dataset — is untouched: it is a ruling about whose compute runs on
  whose data, and it is not implied by, and must not be smuggled in through, a project read.
- **No holdings validation.** `fileAsset` still accepts any id string, as it always has. Filing an
  asset the caller cannot reach records a name that resolves for nobody new; it is noise, not a
  grant. Validating it is a separate, arguable improvement, not a security requirement.

## Open questions for rth

The implementation takes the conservative branch of each — the one that grants less — so a ruling
in the other direction is an addition rather than a retraction.

1. **Should a member be able to unfile what they themselves filed?** As built, no: a member files
   into the shared lens and only the owner takes anything out. This is ADR-0014 open question 1 in
   its project form, and unlike a dataset media item a holding records no `addedBy`, so "what they
   added" is not currently expressible. **Chosen for now: owner-only, because it is the reversible
   choice.**
2. **Should a member be able to rename a shared project?** Bundled into §3's owner-only patch gate
   because `teamId` rides the same verb. Splitting the patch — cosmetic fields for members, the
   team reference for the owner — is expressible and was not taken, because one gate per verb is
   the property that makes this surface auditable.
3. **Should the projection hide holdings a member cannot resolve?** As built, no (§4): holdings are
   the project's content and an unresolvable id grants nothing. The alternative — filter
   `datasetIds` per viewer — makes a project's contents differ by reader and costs a per-row store
   read on every project read, to hide names the owner deliberately filed into a space they
   deliberately shared.
4. **Is one team per project enough?** `sodalitasId` is a single FK, matching `Collectio` and
   `Dataset`. Single is proposed, for the third time and for the same reason.

## Consequences

- **Enforcement is the route test.** `tests/unit/crystal/projects.test.ts` asserts a member read
  on both the list and the id route, a member contribution, the verbs that remove staying
  owner-only, live membership (a removal closes access again), an unshared project staying
  owner-only for a team-mate, fail-closed behaviour with no team store wired, the export seam not
  inheriting the overlay, and a non-member 404 on every project route of a genuinely shared
  project. The pre-existing owner-only assertions were **extended, not relaxed**.
- **The trap has its own test.** `a shared project does not lend the datasets it files` files both
  an unshared and a team-shared dataset into a shared project, then asserts the member sees both
  ids on the project, resolves only the shared one, and lists only the shared one — so the check
  is a discrimination, not a blanket refusal.
- **`not_found.project` remains the only refusal.** A member refused a destructive verb and a
  stranger refused a read get the same code and the same message, so the narrower gate leaks no
  more than the wider one.
- **Fail closed.** No team store wired, an anonymous caller, or an absent `sodalitasId` all fall
  through to owner-only. Nothing a stranger could not reach before becomes reachable now.
- **The API contract moved in step** (`apiContract.ts` → regenerated `docs/api/`), which the
  hermetic drift check enforces. The wire shape itself is unchanged: `teamId` and `owner` were
  already on `Project`.
