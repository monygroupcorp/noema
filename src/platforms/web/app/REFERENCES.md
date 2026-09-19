# NOEMA — the reference-app map

**Status: DRAFT, awaiting rth's ruling.** Every `REF-*` below is a proposal. Until a row is
ruled, a critique may not cite it. Rows marked **unnamed** are deliberately blank: the screen's
job was not clear enough from the source to name a comparison object, and a reference invented
to fill a cell is worse than an empty one — see §0.4.

This file sits beside `DESIGN.md` and answers a different question. It is not a style guide, and
it is not a list of apps to imitate.

---

## 0. Why a named app, and not a checklist

### 0.1 Jakob's Law, stated

> Users spend most of their time on other apps. They prefer this one to work the way those
> already do.

The consequence is not that noema should look like other software. It is that **a convention the
user already has costs them nothing, and every departure from one is a charge levied on their
attention.** A departure can be worth its price. But it has a price, and the price is only
visible when you can name what the user was expecting instead.

### 0.2 Why this supersedes the 2026-08-26 decision to skip Laws of UX

That decision was right about the law *as a checklist*. "Work the way other apps do" cannot be
failed: which apps, in what respect, measured how? A reviewer who cites it can conclude anything,
which means it grounds nothing.

It stops being unfalsifiable the moment **a named app is the comparison object**. "The user
expects the create action in the header" is taste. "Linear's issue list keeps the create action
in the header, persistent across filter state; `/catalog` puts it below the filter row and it
moves when the filter row wraps" is a question with an answer, and the answer is two screenshots
side by side. That is the whole of what this file adds.

### 0.3 The division of labour with DESIGN.md

`DESIGN.md` grounds whether a screen is **noema-shaped**: its tokens, type scale, spacing,
radius, and the three ruled priorities. It is the standard the shipped app is held to, and it is
fully ratified (DESIGN.md §10).

This file grounds whether a screen is **good at the job it is doing**. A screen can satisfy every
`D-*` rule in the document and still put the primary action somewhere no one who has used three
other tools this week would look for it.

**Neither answers the other's question.** A finding that cites only a `D-*` says the screen is
built wrong. A finding that cites only a `REF-*` says the screen is arranged wrong. Most real
findings are one or the other, and a critic that cannot tell them apart produces a pile in which
both are lost.

### 0.4 What a reference is, and what it is not

- **A reference is a screen, not a company.** "Like Linear" is decoration. "Linear's issue list"
  is a comparison object: it can be opened, photographed, and disagreed with.
- **A reference is chosen by job, not by aesthetic.** The question is "where else does a person
  do this exact task", not "what does tasteful software look like".
- **A reference is not a target.** noema does not become the reference. Where noema departs
  deliberately, the departure is recorded in §3 and stops being a finding — the same way
  DESIGN.md §9 stops a rejected finding being relaundered.
- **An unnamed row is a real answer.** It says nobody has yet found the place a user already
  does this. That is worth knowing; a fabricated reference hides it.

### 0.5 The citation contract — extends DESIGN.md §0.1

DESIGN.md §0.1 admits a finding that cites a `D-*` or `P-*`. This file adds one admissible
citation and one standing requirement.

A Phase-2 critique finding is admissible when it carries **all three** of:

1. **a shot from the run it came from** — not a shot from a previous run, and not no shot;
2. **a rule** — a `D-*` / `P-*` from DESIGN.md, or a `REF-*` from this file;
3. **the specific thing the rule says**, quoted or shown. For a `REF-*` that means naming the
   convention and where the reference screen establishes it.

A finding missing any of the three is discarded before rth sees it. This is not tidiness: a
multimodal critic will report issues it never observed, confidently and in the house format, and
the citation is the only thing that catches it.

Admissible:

> **REF-21** — W&B's run page keeps loss and step count pinned above the log, so a glance answers
> "is this working" without reading. `/train/run/:id` (shot 2026-09-18/390/train-run.png) puts
> both below the log, which scrolls.

Not admissible — no convention named, so nothing can disagree with it:

> W&B does this better.

---

## 1. The map

One row per route in the walk census (`walk/routes.ts`, derived from `src/App.tsx`). `REF-*` IDs
are permanent: never reused, never renumbered, so a citation in a past critique still resolves.

### 1.1 The door — what an unauthenticated visitor reaches

| ID | Route | Screen | Reference | The reference is the reference **for** |
|---|---|---|---|---|
| REF-1 | `/`, `/landing` | Landing | Krea's landing page | A generation product's front door: the artifact carries the page, and the first action is *make something*, not *read about it*. |
| REF-2 | `/pricing` | Pricing | Replicate's pricing page | Credits that buy variable-cost runs — the hard part is making "what will this cost me" answerable before purchase. |
| REF-3 | `/about`, `/features`, `/legal/privacy`, `/legal/cookies`, `/legal/terms` | Doc | Stripe's documentation pages | Long prose a person actually finishes: measure, headings that survive scanning, and no marketing in the middle of a legal sentence. |
| REF-4 | `/blog`, `/blog/:slug` | Blog, BlogPost | Replicate's docs guides index | A guide index where each entry states what you will be able to do after reading it. |
| REF-5 | `/partners` | RequestDemo | Stripe's contact-sales form | A qualification form that asks the fewest questions that route the request. |
| REF-6 | `/onboard` | Onboard | Google's account chooser | Adding and switching between identities without losing where you were going. |
| REF-7 | `/ceremony` | Ceremony | The Ethereum KZG Ceremony site | A trusted-setup contribution: the one screen in the product whose users have almost certainly done this exact thing somewhere else. |

### 1.2 The shell — where a signed-in user lands and returns

| ID | Route | Screen | Reference | The reference is the reference **for** |
|---|---|---|---|---|
| REF-8 | `/app` | Dashboard ("Home") | Replicate's dashboard | A home that is a list of your recent work plus one obvious way to start more. |
| REF-9 | `/status` | Status ("Activity") | Vercel's deployments list | In-flight and finished work in one list, newest first, every row a door to the thing itself. Carries DESIGN.md P-3b directly. |
| REF-10 | `/feed` | Feed | Civitai's feed | Published output from everyone, browsable without an account, attribution where attribution was granted. |
| REF-11 | `/projects`, `/projects/:id` | Projects, ProjectHub | Linear's projects list and project page | A container users name themselves, where the page answers "what is in here and what state is it in". |
| REF-12 | `/teams` | Teams | Linear's members settings | Who is in, what they may do, and how to remove them — on one screen. |
| REF-13 | `/space` | Space | Figma's canvas | Spatial navigation: pan, zoom, select, and getting back to something you saw a minute ago. Named against rth's 2026-09-12 report that clicking around the space is a nightmare — the complaint is a navigation complaint, so the reference is a navigation reference. |

### 1.3 Making — the surfaces a run is cast from

| ID | Route | Screen | Reference | The reference is the reference **for** |
|---|---|---|---|---|
| REF-14 | `/chat` | Chat | ChatGPT's thread | The most convention-bound screen in the product: composer at the bottom, history above, and every affordance a user already has muscle memory for. |
| REF-15 | `/run` | Run | Replicate's model run tab | Inputs on one side, output on the other, and the cost of pressing the button visible before it is pressed. |
| REF-16 | `/card` | Card | Replicate's model page | A model's description and its run panel on the same screen, so reading about it and using it are not two destinations. |
| REF-17 | `/catalog` | Catalog | Civitai's model browse | Filtering a large model library by the things people actually filter by, with the result count always visible. |
| REF-18 | `/models` | Shelf ("Model shelf") | Hugging Face's "your models" list | Your own artifacts, including the ones that are private, unfinished, or failed. |
| REF-19 | `/canvas` | Canvas | ComfyUI's graph | A node graph for users who arrive already fluent in one — this product's users disproportionately do. |

### 1.4 Datasets and training

| ID | Route | Screen | Reference | The reference is the reference **for** |
|---|---|---|---|---|
| REF-20 | `/datasets` | Datasets | Hugging Face's datasets list | A list of datasets that says size, modality and state without opening one. |
| REF-21 | `/datasets/:id` | Dataset | A Google Photos album | Getting images *in* and seeing them as a grid. Named for ingest specifically: paste, drag, multi-select and undo are the conventions a person has from this app, and `noema/dataset-ingest-is-starved` says none of them are here. |
| REF-22 | `/datasets/:id/caption` | CaptionJob | Vercel's build log page | A long job you leave and come back to: live log, a state that is readable at a glance, and a terminal state that stays readable afterwards. |
| REF-23 | `/train/run/:id` | TrainRun | Weights & Biases' run page | A training run in flight: the numbers that say "is this working" pinned where a glance finds them, the log below. |
| REF-24 | `/datasets/:id/derive` | Derive | **unnamed** | The screen's job was not clear enough from source to name a comparison object. |
| REF-25 | `/datasets/:id/muse`, `/datasets/:id/muse/sessions` | Muse, MuseSessions | **unnamed** | Deliberately held: `noema/muse-is-the-jewel` says the picture of what muse is has not settled. A reference named before the job is settled would freeze the wrong job. |

### 1.5 Collections — the edition pipeline

| ID | Route | Screen | Reference | The reference is the reference **for** |
|---|---|---|---|---|
| REF-26 | `/collections` | Collections | OpenSea's collections list | Editions as objects with supply, state and a cover. |
| REF-27 | `/collections/:id` | EditioHub | fxhash's project page | A generative edition's home: what it is, how much of it exists, and what the owner can still change. |
| REF-28 | `/collections/:id/garden`, `/collections/:id/rules` | TraitsGarden, TraitRules | Airtable's grid | Editing a table of rules where each row's effect is visible while you edit it. |
| REF-29 | `/collections/:id/run` | CanonicRun | Vercel's deployments list, per piece | Many pieces in flight at once, each with its own state, aggregated into one honest answer about the whole. Carries `noema/collection-run-shows-nothing`. |
| REF-30 | `/collections/:id/curation` | Curation ("Curate the supply") | Lightroom's cull view | Accepting and rejecting a grid *at speed* — keyboard-first, one decision per item, nothing that requires the mouse to travel. |
| REF-31 | `/collections/:id/export` | EditioExport ("Export & publish") | Shopify's product publish flow | The moment work becomes public: what will be visible, to whom, and what cannot be undone. |

### 1.6 Money, keys, identity

| ID | Route | Screen | Reference | The reference is the reference **for** |
|---|---|---|---|---|
| REF-32 | `/funding` | Funding | Stripe's payment-method page | Adding a way to pay, with each method's tradeoffs stated where the choice is made. |
| REF-33 | `/keyring` | Keyring | OpenAI's API keys page | Creating, naming, scoping and revoking keys — including showing a secret exactly once. |
| REF-34 | `/account`, `/account/:section`, `/preferences`, `/profile` | AccountSettings, Preferences, Profile | GitHub's settings pages | Sectioned settings where every section is linkable and the dangerous ones are last. |
| REF-35 | `/sponsorships` | Sponsorships | GitHub Sponsors | Money flowing to someone else's work, and what the payer gets for it. |
| REF-36 | `/partner` | Partner ("Partner dashboard") | Stripe Connect's dashboard | Someone else's users transacting through you: volume, payouts, and the state of the relationship. |
| REF-37 | `/vault` | Vault | **unnamed** | The screen's job was not clear enough from source to name a comparison object. |
| REF-38 | `/studio` | Studio | **unnamed** | The screen's job was not clear enough from source to name a comparison object. |

### 1.7 Operator surfaces

| ID | Route | Screen | Reference | The reference is the reference **for** |
|---|---|---|---|---|
| REF-39 | `/admin/review` | Review | YouTube Studio's held-comments queue | A moderation queue worked one item at a time, where the reviewer can always see why an item is here. Carries `noema/moderation-visibility`. |
| REF-40 | `/admin`, `/admin/partner-requests` | AdminWorkspace, AdminPartnerRequests | Linear's triage inbox | An operator queue: what arrived, what it needs, and one keystroke per decision. |

### 1.8 Not screens

| Route | Why it carries no reference |
|---|---|
| `/review` | A `Navigate` — a redirect, not a rendered screen. |
| `/lab/landing` | PlateLab, mounted only when the lab bundle is present. An internal instrument, not a surface a user reaches. `noema/lab-landing-overflows-the-390-viewport` is still a real bug; it is just not a Jakob's Law question. |
| `*` | The catch-all stub. |

### 1.9 Outside the census

| Surface | Reference | The reference is the reference **for** |
|---|---|---|
| REF-41 — `/widget` | Stripe Checkout, embedded | A chrome-less surface living inside somebody else's page: it must be complete without the shell around it, and must not assume it owns the viewport. Server-rendered, so `walk/routes.ts` does not see it — noted here so it is not invisible to the critique the way `walk/routes.ts` warns a missing route would be. |

---

## 2. Coverage

The map is checked against the census mechanically rather than by counting it by hand, because a
route added to `src/App.tsx` arrives in the census on its own and arrives here only if someone
remembers:

```
npm test -- tests/unit/web/referenceAppMap.test.ts
```

It fails when a census route has no row, when a `REF-*` id is duplicated, and when a row claims a
route that does not exist. It prints the split — named, deliberately unnamed, not a screen — so
the numbers in any critique come from the run rather than from this paragraph.

Clause 1 of `noema/ux-phase-2-critic` asks that **every** screen carry a named reference. Some do
not, and each of those says why in its own row. Closing them is a matter of someone saying what
the screen is for — it is not a matter of choosing an app.

---

## 3. Deliberate departures

Empty. This section is where a ruled departure from a reference is recorded, so that it stops
being filed as a finding — the same office DESIGN.md §9 performs for `D-*` rules. Nothing has
been ruled yet because nothing has been critiqued against this map yet.

A departure is recorded here only after rth rules on it, and records **what the user loses**, not
just that noema chose otherwise.

---

## 4. Maintenance

- A reference changes by ruling, not by a drive-by edit beside a feature — the same rule
  DESIGN.md §11 sets for itself.
- `REF-*` IDs are never reused or renumbered.
- A new route added to `src/App.tsx` arrives in the census automatically and arrives here not at
  all. A route with no row is a gap in this file, and the critique run should say so rather than
  critique the screen against nothing.
- A reference that stops being an app people use has stopped being a reference. The whole
  mechanism rests on the user having the convention already.
