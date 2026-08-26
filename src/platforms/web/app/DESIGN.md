# NOEMA — the design standard

**Status: DRAFT, awaiting ratification.** Nothing in this file is authority until it is ratified
line by line. Once ratified it becomes the single written standard for the NOEMA web app, and
every automated or human critique of this UI must cite a rule ID from this document or be
discarded.

This is a *standard*, not a style tour. Every rule below is written to be **testable** — a
reviewer, a linter, or a critique pass should be able to say "D-14 holds" or "D-14 fails at
`<selector>`" without interpreting taste.

---

## 0. How this document is used

### 0.1 The citation contract

A finding about this UI is admissible only if it cites a rule ID (`D-*`) or a priority ID
(`P-*`). "This feels cluttered" is not a finding. "D-31 fails: `/catalog` renders two filter rows
that both begin with an `All` control" is a finding.

A finding that matches an entry in §9 (Exceptions & decisions) is **already adjudicated** and must
be discarded, not re-argued under a different rule. §9 exists specifically so that a rejected
finding cannot be relaundered.

If a real problem has no rule to cite, that is a **gap in this document**. The correct move is to
propose a new rule here, not to file the finding anyway.

### 0.2 Precedence when rules collide

1. **P-1 / P-2 / P-3** (§1) — the ruled priorities. These outrank everything.
2. **D-\*** rules in this document.
3. The vendored design-system tokens under `src/styles/design/` (§2).
4. Local convention in `src/styles/app.css` and the per-screen stylesheets.

A lower level never overrides a higher one. Where a `D-*` rule and a token disagree, the rule
names the disagreement explicitly in §9 rather than leaving it to be discovered.

### 0.3 What this document was drafted from

- **The live shipped app.** A 32-route authenticated census of the deployed build: per route, the
  computed root tokens, a font-size histogram of text-bearing elements, the resolved font
  families, the border-radius distribution, sub-floor type, uppercase runs, interactive-element
  hit heights, and a full-viewport screenshot. Observation before speculation — every number
  quoted below is measured, not assumed.
- **The ruled UX standard**: simplicity, flow, persistence (§1).
- **The prior audit's conscious keeps** (§9): decisions already made and not reopened here.

Two things it is deliberately **not** drafted from: the older signature-spec collection that
predates the current app (historical reference only, never authority — see EX-9), and any
aspiration about what the UI should become. This document describes the standard the shipped app
is held to.

### 0.4 Reading the measurements

The census kept, per route, only the twelve most frequent font sizes and eight most frequent
radii. Totals quoted below are therefore **lower bounds** and the ratios are approximate. They are
strong enough to rule on; they are not exact inventories. Where a rule depends on an exact count,
it says "measure it" instead of quoting one.

---

## 1. The three priorities, as testable statements

These are the ruled priorities. They are the reason the rest of the document exists, and they
break ties.

### P-1 — Simplicity

> A screen shows what the user needs to act, and nothing that merely proves the system is working.

Testable form:

- **P-1a** Every element on a screen answers "what can I do here" or "what happened to my work".
  Anything that answers neither is a candidate for removal.
- **P-1b** A claim about the product is made in **one** place. The same claim restated on many
  screens is clutter, not reassurance.
- **P-1c** Zero states are silent. A counter reading `0`, an empty meter, and a placeholder that
  says "coming soon" each cost attention and return nothing; they are suppressed unless the
  zero is itself the actionable fact.
- **P-1d** Two controls that do the same thing on the same screen are one control.

### P-2 — Flow

> The user moves forward without changing tools, hunting for a control, or losing what they typed.

Testable form:

- **P-2a** The primary action of a screen is reachable without scrolling at 1440×900.
- **P-2b** A step that produces work always names the next step in the same view.
- **P-2c** Nothing persistent overlaps content the user is reading. A floating surface either sits
  in reserved space or dismisses on interaction with what it covers.
- **P-2d** Navigation does not destroy in-progress input. See P-3.

### P-3 — Persistence

> The user fires work, leaves, and comes back to it finished and waiting. They never chase a
> result through spatial memory.

Testable form:

- **P-3a** Anything the user **typed**, **selected**, or **paid for** survives navigation and
  reload. Client-only state holding any of those three is a defect regardless of how the screen
  looks.
- **P-3b** A finished job is discoverable from the home surface. "Go back to the screen you
  launched it from" is not discoverability.
- **P-3c** A long-running action tells the user it is safe to leave.
- **P-3d** A handle to in-flight paid compute is server-addressable, never held only in component
  state.

---

## 2. Token layers and the vendored boundary

### 2.1 The layers

| Layer | Location | Who may edit |
|---|---|---|
| Primitives — raw ramps, brand-neutral | `src/styles/design/primitives.css` | **Upstream only** |
| Semantic — role tokens components may reference | `src/styles/design/semantic.css` | **Upstream only** |
| Type ramp — `.ds-*` named text styles | `src/styles/design/typography.css` | **Upstream only** |
| Brand skin — NOEMA surfaces, accent, typefaces | `src/styles/design/noema-theme.css` | **Upstream only** |
| Signature devices — `.noema-*` | `src/styles/design/noema-signature.css` | **Upstream only** |
| App bridge + shell — local names, layout, components | `src/styles/app.css` | This repo |
| Screen styles | `src/screens/*.css`, `src/shell/*.css`, `src/components/*.css` | This repo |

- **D-1** `src/styles/design/**` is **edit-forbidden in this repo**. It is a vendored copy of the
  shared design system (`VENDORED.md` states the contract). A change to those files is made
  upstream and re-copied, with the version in `VENDORED.md` bumped in the same change.
- **D-2** A local file never redefines a token that `src/styles/design/**` owns. It may *bridge*
  one to a local name, and it may *override* a value within a scoped selector (a trust state, a
  brand-scoped block) — it may not redeclare the token's meaning on `:root`.
- **D-3** Every custom property referenced in a local stylesheet resolves to a declaration this
  app actually loads. The token-drift lint (`npm run lint:tokens`) is the mechanical check; its
  recorded baseline (`stylelint-baseline.txt`) is the debt list, and it may only shrink.

### 2.2 The two scales — the standing adjudication

The app ships **two parallel scales**. The vendored layer declares `--space-1…--space-10` and
`--text-xs…--text-5xl`; `app.css` declares its own `--s1…--s10` and `--fs-xs…--fs-2xl`. They
overlap but do not agree — the local spacing ladder inserts `20px` and `40px`, and the local type
ladder is materially tighter (11 · 12.5 · 14 · 16 · 19 · 22 · 28) than the system's major-third
ramp.

Only one of them renders. Every screen in this app authors against the **local** names.

- **D-4** For this app, the **local** scales (`--s*`, `--fs-*`, `--r-*`) are the authoring
  surface. New CSS in this repo composes from them, never from raw px and never by reaching
  around them into `--space-*` / `--text-*` directly.
- **D-5** The divergence between the local and system scales is a **known, named** condition
  (EX-1), not a defect to be filed repeatedly. Closing it is an upstream change to the design
  system followed by a re-copy — never a local edit to `styles/design/`.

> **Ratification question R-1:** D-4 makes the tighter local ladder normative and treats the
> system ramp as upstream truth for anything shared across brands. The alternative — adopt the
> system ramp here and restyle every screen to it — is a large, visible change to a shipped app
> and is not proposed. Confirm the narrower reading, or rule the other way.

---

## 3. Color

### 3.1 The palette

Measured identically on all 32 routes — one root token set, no per-route drift:

| Token | Value | Intent |
|---|---|---|
| `--bg` | `#08090A` | The page floor. Nothing sits behind it. |
| `--panel` | `#0c0e10` | A surface holding related content — cards, rails, popovers. |
| `--raised` | `#131619` | A surface *on* a panel — hover, selected, inset fields. |
| `--hair` | `#1c2024` | The separating line. Structure, never emphasis. |
| `--text` | `#e7eaef` | Primary reading text. |
| `--muted` | `#8b929c` | Secondary text — labels, captions, supporting copy. |
| `--faint` | `#747b85` | Tertiary — metadata, shortcut hints, timestamps. |
| `--accent` | `#5b8cff` | The one live/actionable hue. |

Alongside these: modality swatches (`--m-text`, `--m-image`, `--m-video`, `--m-audio`, `--m-3d`),
economy hues (`--gold`, `--amber`), and two cross-product hues (`--egress`, `--noesis`).

- **D-6** Colour is a **role**, not a value. A stylesheet in this repo sets colour only from a
  token. A literal hex in a local `color` / `background` / `border` / `fill` / `stroke`
  declaration is a defect.
- **D-7** Four text tiers exist — `--text`, `--muted`, `--faint`, and accent — and they mean
  primary, secondary, tertiary, actionable. A fifth tier is not invented by mixing.
- **D-8** Elevation is expressed by **surface** (`--bg` → `--panel` → `--raised`) plus `--hair`,
  never by a lighter grey invented for the occasion.
- **D-9** `--accent` marks the thing the user can act on, and the count of accent-coloured
  elements on a screen is small enough to scan. Accent used as decoration devalues it everywhere.
- **D-10** Status colour is semantic and reserved: `--good` for success, `--amber` for caution,
  `--red-500` for danger. None of them are used decoratively.
- **D-11** Modality swatches are one glyph, one meaning, everywhere: the same hue means the same
  modality in the catalogue, on canvas ports, and in datasets. A screen does not re-map them.

### 3.2 The trust fade — the signature mechanic

Privacy is shown by the signal **stepping back**, never by a badge. As the user moves toward
anonymity, the accent desaturates: `.fund-bearer` remaps `--accent` to slate `#7d8aa6`;
`.exec-tee` / `.exec-local` remap it to near-neutral grey `#6a7079`. The frame, weight, and
contrast are untouched — an earlier attempt that dimmed the whole surface read as degradation
rather than privacy.

- **D-12** The trust state changes **only the accent hue chain** (`--accent`, `--accent-soft`,
  `--accent-bg`, `--color-focus`). It never changes surfaces, borders, opacity, or type.
- **D-13** No shield, no lock, no padlock glyph is used to communicate privacy. The fade *is* the
  communication.
- **D-14** Private execution outranks funding posture in the cascade: a user who is both
  identified and sealed reads as private.
- **D-15** Because the accent carries the privacy signal, nothing else may set `--accent` at the
  element level.

---

## 4. Type

### 4.1 Families

`--font-sans` Geist · `--font-mono` Geist Mono · `--font-marquee` Martian Mono.

Two registers, deliberately: **calm in the app, fierce in advertising**. Geist carries every
in-product surface. Martian Mono carries marketing display type and the wordmark only.

- **D-16** In-product text is `--font-sans`, or `--font-mono` when the content is an identifier, a
  hash, a version, a count, or code. Mono is for things that are *read as data*.
- **D-17** `--font-marquee` appears only in marketing display type and the wordmark. It never
  appears inside the application shell.
- **D-18** Every text-bearing element resolves to a house family. Form controls do not inherit
  font by default in any browser, so `button, input, select, textarea, optgroup` carry
  `font: inherit` from a single global rule rather than per-component opt-in. The census resolved
  a non-house fallback family on the majority of routes, which is what an un-reset form control
  looks like; a global reset closes the whole class at once.

### 4.2 The scale

Declared in `app.css`: `--fs-xs 11` · `--fs-sm 12.5` · `--fs-s 13` · `--fs-base 14` · `--fs-m 15` ·
`--fs-md 16` · `--fs-lg 19` · `--fs-xl 22` · `--fs-2xl 28`. Body is 14px / 1.6 / `-0.01em`.

The census counted roughly 2,100 text-bearing elements across the 32 routes. Around **57%**
rendered at a size on that scale; the remainder landed on off-ladder values — 13, 13.5, 15, 15.5,
17, 10.5, 12.9 — with 13px and 15px common enough to be de-facto steps.

- **D-19** Type size comes from `--fs-*`. A raw px `font-size` in a local stylesheet is a defect.
- **D-20** **The functional floor is 11px.** No text renders below it. The census found ~76
  sub-floor elements at 10px and 10.5px — chips, badges, byline and timestamp metadata, id
  strings. Each is fixed by moving to `--fs-xs`, not by shrinking the container.
- **D-21** The scale has nine steps: `--fs-xs`, `--fs-sm`, `--fs-s`, `--fs-base`, `--fs-m`,
  `--fs-md`, `--fs-lg`, `--fs-xl`, `--fs-2xl`. 13px and 15px are promoted, named steps (`--fs-s`,
  `--fs-m`) — ratified R-2.
- **D-22** Weight carries hierarchy in three values only: 400 body, 500 label, 600 heading. 700
  and 800 belong to marquee display type (§4.3) and appear nowhere in the app shell.
- **D-23** Line height is 1.6 for running copy, 1.3–1.4 for headings and dense rows. Tracking is
  `-0.01em` at body size, `-0.02em` at heading sizes, and `0` for mono.

> **Ratification R-2 — resolved.** 13px and 15px are promoted to named steps (`--fs-s`, `--fs-m`),
> matching what ships. Ratified by rth, 2026-08-26. The nine-step ladder is now normative; the
> ~127 existing hardcoded 13px/15px uses remain expressible-but-unmigrated, tracked separately
> (token-lint baseline).

### 4.3 Two heading registers

Measured `h1` sizes split cleanly:

- **In-app screens** — 22px / 600. One `h1` per screen, the screen's name.
- **Marketing and ceremony surfaces** — 40–46px / 600, with display type above it.

- **D-24** An application screen has exactly one `h1`, at `--fs-xl`, and it is the screen's name.
  Heading levels descend without skipping.
- **D-25** Marketing display type does not enter the application shell, and application heading
  scale does not govern marketing pages. They are two registers and each stays on its side.

### 4.4 Case

- **D-26** Sentence case for everything the user reads: headings, labels, buttons, empty states.
- **D-27** Uppercase is reserved for **marquee display type** and for a small set of overline
  labels carrying `--tracking-caps`. The census found 9 uppercase runs across 32 routes; that is
  roughly the ceiling, not a budget to spend. Section headings inside the app are sentence case —
  an uppercase section heading in the app shell fails this rule.

---

## 5. Spacing and rhythm

Declared: `--s1 4` · `--s2 8` · `--s3 12` · `--s4 16` · `--s5 20` · `--s6 24` · `--s7 32` ·
`--s8 40` · `--s9 48` · `--s10 64`. Base 4.

- **D-28** Every margin, padding, and gap composes from `--s*`. No magic numbers.
- **D-29** Space encodes grouping. Within a group, one step. Between groups, at least two steps.
  If two blocks are separated by the same space that separates rows inside them, the grouping is
  not being communicated.
- **D-30** Screen gutters and section rhythm are consistent across screens of the same kind. Two
  list screens do not use different page padding.
- **D-31** Related controls form **one** control row. A screen does not present two parallel
  filter rows, and it never presents two rows that each begin with their own `All` — that is a
  P-1d failure whichever row the user reaches for.

---

## 6. Shape, elevation, and motion

### 6.1 Radius

Declared: `--r-sm 8` · `--r 10` · `--r-lg 14` · `--r-pill 999`. What actually ships, by frequency:
**8px** dominates, then `999px` (pills), `50%` (avatars), `9px`, `10px`, then a long tail of 2, 5,
6, 7, 11, 12, 13, 14.

- **D-32** Radius comes from the radius tokens. The tail values (2, 5, 7, 11, 13) are not steps and
  do not appear in new CSS.
- **D-33** A pill (`--r-pill`) means a filter, tag, or status chip. A card or panel is never a
  pill; a pill is never a container for arbitrary content.
- **D-34** `50%` means an avatar or identity chip, and nothing else.

> **Ratification R-3 — resolved.** Tokens retuned to the observed ladder (`--r-sm 8`, `--r 10`,
> `--r-lg 14`), matching the shipped default. Ratified by rth, 2026-08-26.

### 6.2 Elevation

- **D-35** Shadows are honest black at low alpha, cast downward
  (`0 18px 50px rgba(0,0,0,.5)` for popovers is the shipped reference). No coloured shadows.
- **D-36** **No glow.** A shadow tinted with the accent to suggest light emission is not used
  anywhere. This was decided and stays decided (EX-4).
- **D-37** **No gradient text.** Type is a solid token colour (EX-5).
- **D-38** Elevation and border are alternatives, not additions: a floating surface gets a shadow
  and a hairline, a flat surface gets a hairline only. Nothing gets a shadow to look important.

### 6.3 Motion

Durations `--dur-fast 120ms` / `--dur 160ms` / `--dur-slow 300ms`, easing `--ease`.

- **D-39** Motion communicates a state change — a surface arriving, a value updating, the trust
  fade stepping. Nothing moves for decoration.
- **D-40** Transitions use the duration and easing tokens. No ad-hoc `0.25s ease-in-out`.
- **D-41** **Every animation and transition respects `prefers-reduced-motion: reduce`.** The
  census found no reduced-motion handling anywhere in the app; this rule opens that debt
  explicitly. A single global block that neutralises duration and animation under the query
  satisfies it, and per-component opt-in does not.

---

## 7. Controls, targets, and focus

- **D-42** A screen has **one** primary action, styled as the accent-filled button. Everything
  else is ghost or plain. Two accent-filled buttons on one screen is a defect.
- **D-43** An interactive element has a hit height of **at least 32px** — 44px for anything on a
  touch surface. The census flagged roughly 23% of interactive elements below 32px tall. Density
  is achieved with spacing and type, never by shrinking the target.
- **D-44** **Every interactive element has a visible `:focus-visible` style.** The census found a
  single focus-visible rule in the entire app. The default is inherited from `--color-focus` —
  which follows the trust fade, so focus reads correctly in every posture — and a component may
  restyle the ring but never remove it.
- **D-45** A control's label states its effect in the user's words ("start", "fund from a wallet"),
  not the system's ("submit", "execute").
- **D-46** Disabled is a last resort. Prefer a control that explains what is missing over one the
  user cannot press and cannot diagnose.
- **D-47** Icon-only controls carry an accessible name.

---

## 8. Screen patterns

### 8.1 The shell

- **D-48** The left rail is the only global navigation. A screen does not grow a second persistent
  nav.
- **D-49** Rail groups are stable — their order and labels do not change with state. Position is
  how the user finds things without reading.
- **D-50** The topbar carries: where you are (crumb), what you are (identity + trust), what you
  are spending (meter), and the primary global action. Nothing else earns a slot.
- **D-51** Identity and trust are **one** control. They are never split into two indicators that
  can disagree.

### 8.2 Persistent surfaces

The concierge is a persistent surface: a docked launcher and, when open, a panel.

- **D-52** A persistent floating surface never occludes content the user is reading. Layout
  reserves its footprint (the shell reserves a bottom strip for exactly this reason), and the
  reserve is sized for the surface's **open** state, not just its collapsed one.
- **D-53** A persistent surface presents **one** affordance at a time. An open panel and its own
  launcher are not both visible — that is a P-1d failure, observed on every route in the census.
- **D-54** The persistent surface keeps its thread across navigation. Moving between screens does
  not silently start a new conversation (P-3a).

### 8.3 Lists, tables, and cards

- **D-55** A list screen states its shape before its contents: what these are, how many, how to
  narrow them.
- **D-56** One filtering model per screen (D-31). Sort is a single control, and its current value
  is visible without opening it.
- **D-57** A card shows what identifies the item and what the user can do with it. Metadata that
  is neither goes to the detail view.
- **D-58** **Empty counters are suppressed.** A row of metric glyphs all reading `0` is noise
  (P-1c); render the counts that are non-zero, or a single line saying the item is new.
- **D-59** Tabular data aligns: identifiers left, numbers right, the same column widths across
  screens of the same kind.

### 8.4 Empty, loading, and error states

- **D-60** An empty state says what will appear here and gives the one action that fills it. It is
  sentence case, one line where possible.
- **D-61** Loading states hold layout. Content does not jump when it arrives.
- **D-62** An error says what happened and what to do. It never shows a raw code or stack to the
  user, and it never blames the user.
- **D-63** "Coming soon" is not a UI state. Unbuilt capability is either absent from the interface
  or presented as a roadmap statement in the one place that owns it (P-1b).

### 8.5 The return surface

This is P-3 made concrete, and it is the pattern the app was weakest on.

- **D-64** The home surface answers "what finished while I was gone" above the fold.
- **D-65** A finished item links directly to the artifact, not to the screen that launched it.
- **D-66** A pending item shows that it is pending and roughly where it is. Silence is not a state.
- **D-67** An item is removed from the awaiting-you surface when the user has seen it, not when it
  completed.

### 8.6 Copy

- **D-68** Plain and specific. No exclamation marks, no encouragement, no personality in system
  copy.
- **D-69** One noun per concept across the whole app. If the rail says "Catalogue", nothing else
  calls it a library.
- **D-70** Numbers are formatted consistently: same unit, same precision, same separator, in every
  place the same quantity appears.
- **D-71** A product claim is stated once, in the place that owns it (P-1b).

---

## 9. Exceptions and decisions

**These are adjudicated. A critique pass that files any of them is filing a finding that has
already been rejected, and it must be discarded.**

> **Ratification R-4 — resolved.** List confirmed complete: no additions or removals. Ratified by
> rth, 2026-08-26.

### Conscious keeps

- **EX-1 — Two parallel scales.** `app.css` declares `--s*` / `--fs-*` alongside the vendored
  `--space-*` / `--text-*`. This is known and named (D-4, D-5). Not a finding.
- **EX-2 — The desaturated slate/grey trust palette.** `#7d8aa6` and `#6a7079` are intentionally
  low-chroma; the fade *is* the mechanic (D-12). "Low contrast accent" against these values is not
  a finding.
- **EX-3 — Geist / Geist Mono.** The typeface pairing is settled. Font-choice findings are not
  admissible.
- **EX-4 — Honest black elevation shadows, no glow.** Shadow colour findings proposing accent
  tint or emission are rejected (D-35, D-36).
- **EX-5 — No gradient text, anywhere.** Rejected on sight (D-37).
- **EX-6 — Dark-only.** NOEMA is dark by construction; the brand scope deliberately opts out of
  the shared system's auto-dark. "Add a light theme" is not a finding against this document.
- **EX-7 — The 11px functional floor.** 11px is a legitimate size for metadata and labels (D-20).
  Findings that 11px is too small are rejected; findings **below** 11px are valid.
- **EX-8 — Mono for data.** Identifiers, versions, hashes, and counts in mono is intended
  (D-16), not inconsistency.
- **EX-9 — The older signature-spec collection is not authority.** Its posture-forward
  control-panel doctrine is the ancestry of the clutter this standard exists to remove. It may be
  read as history. It is never cited as a rule, and never seeded into a critique.
- **EX-10 — `styles/design/**` findings are out of scope for this repo.** Correct upstream and
  re-copy (D-1). A finding whose only fix is editing a vendored file is not actionable here.

### Open debts — real, tracked, not to be re-filed as new

Each of these is a **known** shortfall with a rule that already names it. Filing them again adds
nothing; a finding must point at a *specific selector or screen* to be worth reading.

- **EX-11** Reduced-motion handling is absent app-wide (D-41).
- **EX-12** Focus-visible styling is near-absent app-wide (D-44).
- **EX-13** Sub-floor type at 10 / 10.5px persists in chips, badges, and metadata (D-20).
- **EX-14** Roughly 23% of interactive elements are under the 32px hit-height minimum (D-43).
- **EX-15** Radius drift: the shipped default is 8–9px against declared 6/10 (D-32, R-3).
- **EX-16** Off-ladder type at 13 / 13.5 / 15 / 15.5 / 17px is widespread (D-21, R-2).
- **EX-17** Form controls lack a global `font: inherit` reset, so a non-house family resolves on
  most routes (D-18).
- **EX-18** The token-drift lint carries a recorded baseline of known violations. Entries in that
  baseline are tracked debt, not new findings; the baseline may only shrink.

---

## 10. Ratification questions

Collected for one pass, in priority order:

- **R-1** (§2.2) — **open.** Local scales normative, system ramp upstream-only — confirm, or
  adopt the system ramp here.
- **R-2** (§4.2) — **resolved, rth 2026-08-26.** Promoted: 13px and 15px are named steps
  (`--fs-s`, `--fs-m`).
- **R-3** (§6.1) — **resolved, rth 2026-08-26.** Retuned: radius tokens moved to the observed
  ladder (`--r-sm 8`, `--r 10`, `--r-lg 14`).
- **R-4** (§9) — **resolved, rth 2026-08-26.** Exceptions list confirmed complete, no additions
  or removals.

---

## 11. Maintenance

- This file is the standard. It changes by ratified amendment, never by a drive-by edit alongside
  a feature.
- A new rule earns an ID at the end of its section; **IDs are never reused or renumbered**, so
  that a citation in a past critique still resolves.
- A rule that turns out to be unenforceable is either given a mechanical check or struck. A rule
  nothing can test is a preference, and preferences do not belong here.
- Rules that a linter can enforce should migrate into `npm run lint:tokens` and the route-walk
  harness over time. A rule with a mechanical check outranks one without, because it stops
  producing findings and starts producing failures.
