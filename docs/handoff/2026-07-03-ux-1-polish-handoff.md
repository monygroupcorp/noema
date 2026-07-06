# UX Handoff 1 · Polish

**Bucket:** P2 — copy, naming, small wiring. Low-risk, high-momentum. **Do this first.**
**Source:** `docs/plans/2026-07-03-ux-flow-audit.md`
**Why first:** none of these touch the information architecture. They're safe, they build momentum,
and they settle the *vocabulary* (screen names, plain-language labels) that Handoff 2 (Architecture)
then builds the nav structure around. Ship these behind the current nav; nothing here is blocked.

**Out of scope on purpose:** the Map (`/map`) — it's a vestigial dev scaffold, not a production
surface, and it's being decommissioned in Handoff 2. Don't spend polish effort on it.

---

## 1. Retitle Profile — drop "skins"
The "skins" concept never shipped; PFP + banner upload already work (`Profile.tsx:76-78`).
- `Profile.tsx:68` — `<h1>Profile · skins</h1>` → **"Profile"** (or "Appearance").
- `Profile.tsx:69` subtitle — reword away from "your skin is how this identity looks."
- Keep the "Generate a kit" block as an explicit **v2 / soon** (`Profile.tsx:98-103`) — already disabled; just make sure copy reads as a future feature, not a broken one.
- `shell/Account.tsx:104` dropdown label "skins & purses" → "Profile" (see naming pass below).
- **Done when:** no user-facing string says "skin(s)"; PFP/banner upload unchanged and working.

## 2. No Latin reaches the user — plain English at the UI boundary
**Rule (per product direction): the Latin nomenclature is backend-only. None of it should render in the
UI.** The type system's Latin primitives name internal concepts; the surface must speak plain English.
The **only** allowed proper noun is the brand **NOEMA** (and any surface the user has explicitly
branded). Everything else gets a human label at the boundary:

| Backend term | Where (examples) | Show instead |
|---|---|---|
| `fundamentumId`, `modusId` (raw ids) | `Card.tsx` context panel, `EditioHub.tsx:50` | the flow's human name, or hide the id |
| `aditus` schema keys as port labels | `Card.tsx:211` | the input's description/label |
| `categoria` | `Card.tsx:202` | "category" |
| `impetus` | `Card.tsx:333` | "cost" / "price" (+ `◈` with a "what's a credit?" tooltip) |
| `editio` | publishing / collection surfaces | "publication" / "collection" |
| `tractus` | collection surfaces | "trait set" (or the plain term for the concept) |
| any other Latin primitive | anywhere user-facing | its plain-English equivalent |

This is best done as a **boundary mapping** (one place that translates backend nouns → display labels)
so new leaks are caught centrally rather than screen-by-screen.
**Done when:** grepping the rendered UI surfaces turns up no Latin term except the brand name.

## 3. Honest 404
`Stub.tsx:9` shows a dev note ("porting next from the spike…") and has no way back.
- User-facing copy ("This page doesn't exist yet").
- Add a **"Back to home"** link (`/app`).
- **Done when:** hitting a bad URL gives a normal 404 with an exit.

## 4. Unify the collection-chain forward seams
The 7-screen authoring chain has two forward dead-spots:
- `TraitRules.tsx:87-89` — Rules (step 2) can only go "back to garden to fire." Either add a **Fire** action to the rules footer, or make the spine visibly express that firing is a garden-only action.
- `Curation.tsx:122-125` — mid-queue footer shows only "← run." **Always show "Export →"** (today it appears only in empty states, `:76,:116`).
- **Done when:** a user can move forward from every step without knowing the URL structure.

## 5. Feed tile detail + attribution
- `Feed.tsx:20-42` — tiles are inert `<figure>`s. Make each open a **lightbox/permalink**.
- `Feed.tsx:37` — author hardcoded `"anonymous"`. Render real attribution (or intentional-anon).
- **Done when:** a feed tile is clickable and shows true authorship.

## 6. Honestly label the onboarding doors
`Onboard.tsx:127` Wallet/Passkey call `enter()` with no auth; `Onboard.tsx:58` "Set up a Bursa (pay
anonymously)" dead-ends to `/app`. For *this* pass, make them **honest** — label unbuilt doors
"coming soon" / disable them so they don't read as broken. (Actually *wiring* them is Handoff 3 · P0.)
- **Done when:** no onboarding door silently fakes success.

## 7. One name per screen
Pick a single canonical label and use it in the Rail, the crumb, and the dropdown:
- **Funding** — currently "Funding" / "add credits" (`Funding.tsx:92`) / "Funding & credits."
- **Catalogue** — currently "Catalogue" / "catalog" (`Catalog.tsx:99`) / "Library."
- **Done when:** each screen answers to exactly one name across every surface.

---

### Suggested commit slices
`fix(web): retitle Profile, drop skins` · `fix(web): plain-language labels over schema internals` ·
`fix(web): honest 404 + collection-chain forward links` · `fix(web): feed tile detail + attribution` ·
`fix(web): honest onboarding doors + name unification`

---

**Sequence:** Polish (you are here) → [Architecture](./2026-07-03-ux-2-architecture-handoff.md) → [P0](./2026-07-03-ux-3-p0-handoff.md).
**→ Next:** once the vocabulary and copy above are settled, move to
**[Handoff 2 · Architecture](./2026-07-03-ux-2-architecture-handoff.md)** — it builds the single
production nav on top of the names fixed here.
