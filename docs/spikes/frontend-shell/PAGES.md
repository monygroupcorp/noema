# Page Skeleton Set

The screens the frontend needs, grouped by the two-axis model
(`docs/plans/2026-06-15-frontend-vision.md`). Phase tags map to the roadmap (§9).

## Shell (persistent frame)
- **App Shell** — the dark-precise frame: keyring/identity switcher, trust-state indicator
  (luminance/temperature), layer nav, the active-identity skin zone. Everything mounts here. `P0`

## Creation axis
1. **Chat / Concierge** (Layer 1) — the front door. Intent → verb run → streamed result. `P1` ← **SPIKE**
2. **Tool Card / Gradio** (Layer 2) — one `Essentia` as an auto-form: inputs + quote + run + result. `P1`
3. **Flow catalog / discover** — browse runnable flows; feeds the card. `P1`
4. **Run detail / streaming** — a run in flight (SSE stages) + final `exitus`. `P1`
5. **Canvas / Workspace** (Layer 3) — accumulated `Acta` wired into a `compositus` spell. `P3`

## Memory axis
6. **3D Vestigium space** (Layer 4) — fly / search / cluster / cultivate. `P2`
7. **Trace detail** — one `Vestigium`: lineage, reactions, save → spell / `Corpus`. `P2`

## Identity / vault / privacy
8. **Keyring** — manage & switch identities; create new (choose trust tier). `P0/P2.5`
9. **Vault / arcanum** — secrets, recovery phrase, purse balance, fund/deposit, export/import. `P2.5`
10. **Profile / customization** — skins, BYO assets (banner/pfp/bg), optional generate-kit. `P1/P4`
11. **TEE session** — provision private pod, tunnel status, the redaction "what we receive"
    view, ephemerality cues. `P5`

## Account / economic
12. **Status / ledger** — `signa` balance, spend, quote history (identified). `P1`
13. **Studio** — warm pod session (Conductor); metered session HUD. `P-later`
14. **Onboarding / first-run** — cold start; pick entry; create first identity. `P1`

## Marketing (separate surface, subdomain split already exists)
15. **Landing / docs** — public marketing.

---

**STATUS (2026-06-16): all 16 screens spiked.** Entry point = **`map.html`** (the rail's
"map" link) — a clickable directory of every screen. Shared system: `app.css` (component
library + dark-precise tokens + 4 font pairings) and `app.js` (generated rail/nav,
identity keyring, trust-state signature, font toggle, concierge bubble). Default type:
Geist + Geist Mono.

Files: `index` (chat) · `card` (flow card) · `catalog` (discover) · `run` (streaming) ·
`canvas` (compositus board) · `space` (3D Vestigium) · `trace` (one Vestigium) ·
`keyring` (manage identities) · `vault` (arcanum secrets) · `profile` (skins) ·
`status` (ledger) · `studio` (warm pod HUD) · `tee` (private session) · `onboard` ·
`landing` · `map`.

To iterate: edit `app.css` for system-wide visual changes, individual `*.html` for a
screen, `app.js` for shared chrome/behavior. Served over Tailscale (`archbox:8742`).

---

### Origin: Spike #1 = App Shell + Chat/Concierge (`index.html`)
Proved the dark-precise system voice, the keyring switcher, the trust-state signature
(identity-transform + plain-language visibility, *not* luminance — see visual-language
doc), the redaction view, and the primary interaction.
