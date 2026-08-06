# noema — web app (the new React frontend)

The new frontend for noema, replacing the legacy microact app (`../frontend`, untouched).
Vite + React + TypeScript. Talks to the crystal `/v1` API same-origin in prod.

> **If you're picking this up cold:** read this file, then `src/styles/app.css` (the design
> system) and `src/shell/` (the frame). Everything else composes from those.

## Run it

```bash
npm install
npm run dev            # http://localhost:5174  (host:true → reachable over Tailscale)
```

The dev server **proxies `/v1` + `/api` → `https://staging.noema.art`** (see `vite.config.ts`,
`API_ORIGIN` to override). So the app runs against the **live staging cluster** with no local
backend. In production it's served by staging itself and the calls are same-origin.

```bash
npm run build          # tsc -b && vite build  → dist/
npm run typecheck
```

## Deploy to staging

Served at `staging.noema.art` (gated by `SERVE_WEB_APP=1`, which also gates production — not
just staging). **Full runbook:
`docs/ops/staging-deploy.md`.** TL;DR: `git push origin HEAD:staging` → wait for the build →
`ssh noema 'cd /opt/noema && ./deploy-staging.sh'`. Deploy is **manual on purpose** (parallel
work must not be auto-clobbered).

## The design system (the constitution)

Single stylesheet `src/styles/app.css` — fully **tokenized**: spacing `--s1..--s10`, type
`--fs-*`, radii `--r-*`, motion `--dur/--ease`, color tokens, breakpoints sm680/md760/lg1080.
**A magic number is a bug — compose from tokens.** Full rules: `docs/plans/2026-06-16-design-system.md`
(local scratch) + `AGENTS.md`.

**Taste, decided (don't re-litigate):**
- **Dark & precise** (Linear/Apple execution), accent **icy blue `#5b8cff`**, **airy** density,
  **minimal-crisp** motion. Type: **Geist + Geist Mono**.
- **Privacy is the brand.** Trust state is one signal: the identity control (top-left) shows
  *who you are + who can see this*; click it for the proof (a redaction view). Tiers shift the
  **accent hue only** (identified=icy / anonymous=slate / private=grey-fade) — never dim the frame.
- **Two voices:** the system chrome stays reserved; user *skins* may be loud.
- **No internal/Latin terms in the UI** (credits not signa, run not Actum, tool not Modus, …).
- **Privacy iconography = absence**, not shields (anon = venetian-mask, private = eye-off).

## Architecture

- `src/main.tsx` — root: `IdentityProvider` → `BrowserRouter` → `App`.
- `src/App.tsx` — routes. Heavy screens (Space=three.js, Canvas=React Flow) are **lazy-loaded**.
- `src/state/identity.tsx` — the active identity (context); switching sets the `tier-*` class on
  `<html>` so the accent shifts app-wide.
- `src/shell/` — `AppShell` (the frame), `Rail` (nav + Account menu + keyring), `IdentityControl`
  (+ trust popover), `Webring` (altitude bar), `Concierge` (collapsed chat bubble + prompt
  augmentation), `ErrorBoundary`.
- **Prompt augmentation** — focus any free-text field and the Concierge slides open with a
  tailored example (Use / Copy) + a "write it for me" draft. Wire a field in one line with
  `useAssistField()` (`state/promptAssist.tsx`); examples + local drafter in `lib/promptExamples.ts`.
  The field's schema `description` is surfaced as the hint — **enrich essentiae input descriptions
  to give it sharper teeth** (no frontend change needed). Live on Card + Profile kit.
- `src/lib/` — `api.ts` (typed `/v1` client + anon `x-commitment`), `icons.tsx` (Lucide registry),
  `idents.ts` (identities + tiers).
- `src/screens/` — one file per screen. `src/content/` — markdown for the site/legal pages.

## Screens (state)

| Screen | Route | State |
|---|---|---|
| Chat (Concierge) | `/` | UI real, mock messages |
| Flow card | `/card?id=` | **LIVE** — real schema (`/v1/flows/:id`) + live quote (`/v1/runs/quote`) |
| Catalog | `/catalog` | **LIVE** — real flows (`/v1/flows`) |
| Run detail | `/run` | UI real, simulated lifecycle |
| Canvas | `/canvas` | **React Flow** node graph, drag-to-wire; compile=stub |
| Space (3D Vestigium) | `/space` | **R3F** embedding scatter; mock points (→ `/api/vestigia` later) |
| Trace · Keyring · Vault · Profile · Studio · TEE · Map | … | UI real, mock data |
| Status (Account) | `/status` | mock (→ wire `/v1/me/status`) |
| Funding | `/funding` | the 3 funding rungs (privacy gradient); fiat=stub (spec: `docs/spec/fiat-onramp-stripe.md`) |
| Onboard · Landing | `/onboard` `/landing` | standalone marketing; Landing has the architecture diagram + site/legal pages |
| Site/legal | `/about /features /pricing /blog /legal/*` | markdown from `src/content/` |

## How to add a screen (no slop)

1. Reuse first — most things exist in `app.css` (page/pw/pagehead/sectionhead/grid/gcard/list/
   stats/stepline/badge/pill/btn/btn-ghost/…). Read it.
2. `export function X()` returning `<AppShell crumb=… [context=…]>…</AppShell>`.
3. Tokens only for any inline style (`var(--s4)` not `16px`). Icons via `<Ic name="…" />`.
4. No Latin in copy. Translate domain terms.
5. Wire the route in `App.tsx`. Verify all 3 breakpoints + identity switch + `tsc -b`.

## Known gaps / next

- **Run/generate is parked** — needs funded credits (arcanum deposit / bursa, or the Stripe
  onramp). Unfunded anon run currently 500s (backend bug). Discover→configure→quote is live.
- **Space → live `/api/vestigia`** once there are real creations to plot (CLIP embeddings exist;
  it's a data-source swap, not a rebuild).
- **Account/Status → `/v1/me/status`** — ✅ live (`Status.tsx` reads the real snapshot).
- **Pinning flows** — ✅ live: star toggle on the Card (`lib/pins.ts`, localStorage + pub/sub),
  pins render in the Rail's Cards slot.
- **Vault** → the real arcanum flow (backend ZK is "largely put together").
- Legacy `frontend/` keeps `micro-web3` for the eventual chain/wallet integration.
