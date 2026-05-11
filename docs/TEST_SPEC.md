# Test Overhaul Specification

## Philosophy

Tests in this codebase characterize **behavioral contracts** — what the system does
from the outside — not implementation details of the JS services underneath.

Every test here must satisfy two rules:

1. **Runs against the legacy JS today.** It documents what the system currently does.
2. **Runs against the crystal ring after cutover.** When the adapter is swapped,
   the same assertions hold (or a known divergence is explicitly documented).

Tests are written at the **service interface level** — inject fake DB/dependencies,
call the operation, assert on observable state. Never assert on internal field names,
collection shapes, or MongoDB query forms that will not exist in the crystal.

### Known intentional divergences (crystal improves on legacy)

These behaviors DIFFER between legacy and crystal. They are not test failures —
they are documented upgrades.

| # | Behavior | Legacy | Crystal |
|---|----------|--------|---------|
| D1 | Spend on completion | Deducts the full estimate | Settles actual cost; refunds delta |
| D2 | Stuck execution | Credits frozen until manual fix | `expirat` + `findExpired()` auto-releases |
| D3 | Double-completion | Silent overwrite | Throws; terminal state guard |
| D4 | Atomicity on failure | Create then spend (gap exists) | Lock-then-create with rollback |

---

## 1. Spell (Generation Execution)

**What it is:** A spell is a named composition of tools cast by a user. Casting
creates an execution record, reserves credits, runs the tool, and settles the cost.

**Crystal primitive:** `Modus` + `Actum` + `ActumInceptor` + `ActumCompletor`

**Existing coverage:** `generationExecutionService.test.js` — good on validation
and spend-on-success. Missing: failure path, stuck recovery, double-completion.

### Required behavioral tests

```
SPELL-1  cast with sufficient balance → actum created in pending state
SPELL-2  cast with insufficient balance → INSUFFICIENT_FUNDS error, no actum created,
           balance unchanged
SPELL-3  cast with unknown toolId → NOT_FOUND error, no actum created
SPELL-4  cast with missing toolId → INVALID_INPUT error
SPELL-5  successful execution → actum status = completed, credits deducted
SPELL-6  failed execution → actum status = failed, credits NOT deducted (balance unchanged)
SPELL-7  x402 execution → actum created, credits NOT checked or deducted (see §11)
SPELL-8  group pool active + pool has funds → deducts from pool, not fallback user
SPELL-9  group pool active + pool empty + fallback has funds → deducts from fallback
SPELL-10 group pool active + both empty → INSUFFICIENT_FUNDS
SPELL-11 [DIVERGENCE D3] complete already-completed actum → rejected (crystal only)
SPELL-12 [DIVERGENCE D2] actum past deadline with no completion → credits released
           on recovery (crystal only)
```

### Key business rule

Cost deduction uses **lowest funding_rate first** across active deposits (legacy).
Crystal equivalent: greedy selection of smallest-valor signa first.
Both must produce the same net balance after execution.

---

## 2. Canvas / Workspace / Nodes

**What it is:** The visual authoring surface where users compose workflows. A
workspace (tabula) is a persistent draft that publishes into a versioned modus.
Nodes are tool instances; vincula are typed connections between them.

**Crystal primitive:** `Tabula` + `TabulaNodus` + `TabulaVinculum`

**Existing coverage:** `workspacesApi.js` tests minimal or absent. Gap.

### Required behavioral tests

```
CANVAS-1  create workspace → owned by auctor, status = draft
CANVAS-2  add node with valid modusId → node appears in workspace
CANVAS-3  connect nodes with matching port types → discordantia = false
CANVAS-4  connect nodes with mismatched port types → discordantia = true,
            connection still created (mismatch is flagged, not blocked)
CANVAS-5  publish workspace → modus created with matching port schema;
            workspace status = published, modusId set
CANVAS-6  fork workspace → new workspace with fonteId pointing to original;
            new auctor owns the fork; original unchanged
CANVAS-7  set visibilitas to publica → workspace appears in public listing
CANVAS-8  set visibilitas to privata → workspace invisible to non-auctor
CANVAS-9  set visibilitas to communis → not in listing, accessible by direct id
CANVAS-10 delete node → all vincula connected to that node also removed
```

---

## 3. Tool / Expression

**What it is:** A tool (modus) is the atomic execution primitive with typed ports,
a runner (ministerium), and a version. An expression is a dynamic parameter
evaluated at cast time using a sandboxed formula language.

**Crystal primitive:** `Modus` + `Essendi`

**Existing coverage:** `toolsApi.js` / `toolDefinitionApi.js` — mostly API shape.
Expression adapter tests minimal.

### Required behavioral tests — Tool

```
TOOL-1   register tool → retrievable by id + version
TOOL-2   resolve tool with no version → returns latest versio
TOOL-3   resolve tool with specific version → exact match
TOOL-4   tool with no registered cursor → execution throws with clear error
TOOL-5   tool port schema preserved through registration + retrieval
TOOL-6   tool with impetusFixum → reserve() returns exactly impetusFixum
```

### Required behavioral tests — Expression

```
EXPR-1   simple arithmetic expression → evaluated correctly
EXPR-2   expression referencing input variable → substituted correctly
EXPR-3   multi-line expression → last line is the result
EXPR-4   expression over array input → auto-iterates, returns array of results
EXPR-5   expression with string functions (replace, trim, split) → applied correctly
EXPR-6   expression with disallowed operation (assignment) → rejected with error
EXPR-7   expression with member access on untrusted value → rejected
EXPR-8   len / range / floor / ceil / min / max / round → all return correct values
```

---

## 4. Cook

**What it is:** Batch orchestration. A cook runs one generation per "piece" in a
collection, with concurrency control, pause/resume, and auto-resume on process restart.
Each piece routes to either a spell or a tool depending on how the cook is configured.

**Crystal primitive:** `Collectio` + multiple `Actum`

**Existing coverage:** `CookService.test.js` — partial. Missing: concurrency,
resume, trait evaluation.

### Required behavioral tests

```
COOK-1   start cook with N pieces → N actum initiated (one per piece)
COOK-2   insufficient balance for full grid → rejected before any actum created
COOK-3   one piece fails → remaining pieces continue unaffected
COOK-4   total impetus = sum of individual piece impetus
COOK-5   pause cook → no new pieces initiated; in-flight pieces complete
COOK-6   resume cook → picks up from where it stopped (nextIndex preserved)
COOK-7   cook with concurrency limit → never exceeds maxConcurrent in-flight
COOK-8   duplicate piece job → idempotent (processedJobIds dedup)
COOK-9   cook survives process restart → resumes from last known state
COOK-10  cook with spellId routes to spell execution
COOK-11  cook with toolId routes to tool execution
COOK-12  trait engine evaluation → produced traits match expected values for seed
```

---

## 5. Royalties

**What it is:** Revenue distribution fires after every completed execution.
Impetus flows to host, spell author, model authors, referrer, and platform.
All arithmetic is exact integer math — no floating point.

**Crystal primitive:** `Nexus` hooks (`hostCut`, `spellRoyalty`, `modelRoyalty`,
`platformSkim`, `referralSplit`)

**Existing coverage:** Hook unit tests exist in crystal. Legacy: no chain test.

### Required behavioral tests

```
ROYALTY-1  execution completes → host gets floor(impetus × hostRate)
ROYALTY-2  execution completes → spell author gets floor(impetus × spellRate)
ROYALTY-3  execution completes → all model authors receive equal shares of
             floor(impetus × modelRate), no rounding residue lost
ROYALTY-4  platform skim = floor(royaltyTotal × platformRate), applied to
             royalty sum not base impetus
ROYALTY-5  sum of all cuts ≤ impetus (conservation invariant)
ROYALTY-6  one hook throws → other hooks still fire and land (isolation)
ROYALTY-7  execution with no host (direct cast) → hostCut hook produces no signum
ROYALTY-8  execution with no spell author → spellRoyalty hook produces no signum
ROYALTY-9  execution with multiple model authors (3) → each gets 1/3 of
             model royalty pool (integer division, remainder stays with platform)
```

---

## 6. Model Royalties

**What it is:** Model authors earn a royalty on every execution that uses their
model. LoRA authors earn a share when their adapter fires.

**Crystal primitive:** `modelRoyalty` Nexus hook + `Intella`

**Existing coverage:** Absent. Gap.

### Required behavioral tests

```
MODELROY-1  execution using canonica model → platform retains model royalty
              (no author to pay — canonica models are platform-owned)
MODELROY-2  execution using community model → author receives royalty
MODELROY-3  execution using LoRA on top of base model → both base author and
              LoRA author receive share (split defined by hook rates)
MODELROY-4  model royalty rate is the rate set at Intella registration time,
              not the current platform default
```

---

## 7. Marketplace

**What it is:** Public catalog of spells, tools, workspaces, datasets, and models.
Items are discoverable based on their visibilitas. Items can be purchased,
sold, and rated.

**Crystal primitive:** `Tabula` + `Intella` + `Corpus` + `Vestigium`

**Existing coverage:** `marketplaceApi.js` tested minimally. Gap.

### Required behavioral tests

```
MARKET-1  item with visibilitas=publica → appears in marketplace listing
MARKET-2  item with visibilitas=communis → not in listing, accessible by direct id
MARKET-3  item with visibilitas=privata → not in listing, returns 404 to non-auctor
MARKET-4  marketplace search by tag → returns only matching items
MARKET-5  marketplace sort by popularity (amor count) → ordered correctly
MARKET-6  purchase dataset → buyer can access it; seller receives impetus
MARKET-7  purchase private model → buyer can use it in their tools
MARKET-8  forked item → fonteId preserved in listing; original auctor attributed
MARKET-9  featured items → returned by featured endpoint regardless of sort
```

---

## 8. Private Models

**What it is:** Users upload their own model weights (LoRAs, fine-tunes) and
keep them private or publish to the marketplace. Private models can be used
in private tools without being published.

**Crystal primitive:** `Intella` (canonica=false)

**Existing coverage:** `LoraService.test.js` — partial CRUD. Missing: access control.

### Required behavioral tests

```
PRIVMODEL-1  register private model → only auctor can use it in tools
PRIVMODEL-2  non-auctor attempts to use private model in their tool → rejected
PRIVMODEL-3  non-auctor attempts to read private model metadata → 404 (not 403)
PRIVMODEL-4  auctor publishes private model → becomes visible in marketplace
PRIVMODEL-5  contentHash set at registration → verified on use (mismatched hash rejected)
PRIVMODEL-6  private LoRA requires its base model → execution fails with clear error
               if base model is not available on the target pod
```

---

## 9. Model Training

**What it is:** Users train LoRAs on their own datasets. Training is an actum —
it costs impetus and produces an Intella on completion.

**Crystal primitive:** `Corpus` + `Intella` + `Actum`

**Existing coverage:** `trainingsApi.js` tested minimally. Gap.

### Required behavioral tests

```
TRAINING-1  create corpus with images → corpus record created, auctor set
TRAINING-2  initiate training → actum created in pending state
TRAINING-3  training completes → Intella created with baseIntellaId + corpusId
TRAINING-4  training fails → credits released, no Intella created
TRAINING-5  corpus not owned by caller → training initiation rejected
TRAINING-6  training impetus = actual pod-time used (per-second billing)
TRAINING-7  completed Intella is private by default (canonica=false, auctor set)
```

---

## 10. Referral Codes

**What it is:** On-chain referral codes. Creating a code requires 50,000 EXP.
A referral fires once per user on their first deposit. The referrer earns a
cut of the referred user's deposit.

**Crystal primitive:** `referralSplit` Nexus hook + `Catena`

**Existing coverage:** `referralVaultApi.js` — API shape only. No behavioral tests.

### Required behavioral tests

```
REFERRAL-1  register code with ≥ 50,000 EXP → calldata returned
REFERRAL-2  register code with < 50,000 EXP → rejected with clear error
REFERRAL-3  code name < 4 chars → rejected
REFERRAL-4  code name with invalid characters → rejected
REFERRAL-5  code name collision (on-chain) → rejected
REFERRAL-6  first deposit with referral code → referrer receives split
REFERRAL-7  second deposit from same user with same code → referrer does NOT
              receive a second split (fires once per user, not once per deposit)
REFERRAL-8  deposit without referral code → no referral split
REFERRAL-9  referrer dashboard → aggregates correct total volume + rewards
```

### Key business rule

Referral key = keccak256(name). On-chain collision check must precede registration.
Minimum code name: 4 characters, alphanumeric + underscore/dash only.

---

## 11. Onchain Payment (Deposit)

**What it is:** Users deposit ETH/tokens to the CreditVault contract. The deposit
processor detects the on-chain event, converts to impetus points
(1 impetus = $0.000337 = 1 RunPod SECURE second), and issues credit signa.

Magic-amount flow: user sends an exact ETH amount to link their wallet to their anima.
Trusted NFT collections receive preferred funding rates (Milady=1.0, Bonkler=0.65,
baseline=0.70).

**Crystal primitive:** `Catena` (Depositum) + `Signorum.issue()` + `referralSplit` hook

**Existing coverage:** `DepositProcessorService.test.js` — magic amount. Gap elsewhere.

### Required behavioral tests

```
DEPOSIT-1  valid deposit tx → signa issued, balance increases by correct impetus amount
DEPOSIT-2  USD→impetus conversion: 1 impetus = 1 A10G ComfyDeploy GPU second = $0.000337
             therefore $1 = floor(1 / 0.000337) = 2967 impetus points
DEPOSIT-3  duplicate tx_hash → no-op (idempotent; signa not double-issued)
DEPOSIT-4  magic amount deposit → wallet linked to anima
DEPOSIT-5  non-magic amount → wallet NOT linked
DEPOSIT-6  deposit with referral code → referral split fires
DEPOSIT-7  second deposit from same user → referral split does NOT fire again
DEPOSIT-8  Milady NFT holder deposit → funding_rate = 1.0 applied
DEPOSIT-9  standard deposit → funding_rate = 0.70 applied
DEPOSIT-10 deposit credited in PENDING status → no balance until CONFIRMED
DEPOSIT-11 PENDING → CONFIRMED transition → balance increases, referral fires
```

---

## 12. X402 Payment

**What it is:** HTTP-level payment via the x402 protocol. Callers pay per-request
with USDC on Base without pre-deposited credits. The server verifies the payment
proof before execution.

Pricing uses historical p95 cost (if > 100 runs), max (if 10–100 runs), or
tool definition estimate. Confidence tiers add 20/30/50/75% markup.
Platform markup = 20% base. Minimum charge = $0.01.
USDC: Base mainnet `0x833589...`, Sepolia `0x036Cb...`.

**Crystal primitive:** `Catena` (Solutio) + `Actum` (no signa consumed)

**Existing coverage:** `x402GenerationApi.js` — minimal. Gap.

### Required behavioral tests

```
X402-1   valid payment proof → execution proceeds, actum created
X402-2   invalid payment proof → 402 returned with payment requirements,
           no actum created
X402-3   replay attack (same signature twice) → second request rejected
X402-4   payment amount insufficient → 402 returned
X402-5   x402 execution still creates actum (auditability preserved)
X402-6   x402 execution does NOT deduct from impetus ledger (no signa consumed)
X402-7   x402 execution fires distribution hooks (revenue still distributed)
X402-8   tool cost pricing: > 100 historical runs → uses p95 cost
X402-9   tool cost pricing: 10–100 runs → uses max cost
X402-10  tool cost pricing: < 10 runs → uses tool definition estimate
X402-11  platform markup applied: final price = estimated_cost × 1.20
X402-12  minimum charge enforced: price never < $0.01
X402-13  settlement records tx hash after on-chain confirmation
```

---

## 13. Telegram Integration

**What it is:** The Telegram adapter receives messages (Nuntius), resolves the
caller's Anima via their Persona, translates commands into Inceptio, and sends
Responsum back to the chat. Events before bot startup time are silently ignored.

**Crystal primitive:** `Allocutio` + `Persona` + `Anima`

**Existing coverage:** None. Gap.

### Required behavioral tests

```
TELEGRAM-1  message from known user → resolves to correct anima
TELEGRAM-2  message from unknown user → guest flow triggered (or register prompt)
TELEGRAM-3  /spell command → Inceptio created with correct modusId + aditus
TELEGRAM-4  successful execution → result sent back to chat
TELEGRAM-5  failed execution → error message sent, does not throw
TELEGRAM-6  long-running job → progress updates sent at intervals
TELEGRAM-7  delivery failure (Telegram API down) → actum status unaffected;
              error logged, not propagated to actum
TELEGRAM-8  event timestamp < botStartupTime → silently ignored (not replayed)
TELEGRAM-9  group message with group pool active → uses group pool identity
```

---

## 14. Discord Integration

**What it is:** Same adapter pattern as Telegram. Discord messages resolve to
Anima via Persona. Commands map to Inceptio. Results delivered as Discord embeds.

**Crystal primitive:** `Allocutio` + `Persona` + `Anima`

**Existing coverage:** None. Gap.

### Required behavioral tests

```
DISCORD-1  slash command from known user → resolves to correct anima
DISCORD-2  slash command from unknown user → guest flow / registration prompt
DISCORD-3  /spell command → Inceptio created with correct modusId + aditus
DISCORD-4  successful execution → result posted as embed in channel
DISCORD-5  failed execution → error embed sent, actum status = failed
DISCORD-6  delivery failure (Discord API error) → actum status unaffected
DISCORD-7  server (guild) with group pool → group pool identity used
```

---

## 15. API

**What it is:** The external REST API. All endpoints require auth except health.
Authenticated requests resolve animaId from the API key. Keys are scoped and
revocable.

**Crystal primitive:** `Anima` + `Actum` + `ActumInceptor`

**Existing coverage:** `internal.test.js` — health only. Gap.

### Required behavioral tests

```
API-1   GET /health → 200 with no auth required
API-2   any authenticated endpoint with no key → 401
API-3   any authenticated endpoint with invalid key → 401
API-4   any authenticated endpoint with revoked key → 401 (immediate, not cached)
API-5   POST /acta (initiate execution) → 202 with actumId
API-6   GET /acta/:id → status field reflects current actum status
API-7   GET /acta/:id for actum owned by different anima → 404 (not 403)
API-8   daily rate limit exceeded → 429 with retry-after header
API-9   API key scoped to specific modus → rejected for other modi
API-10  API key not scoped → accepted for any modus
API-11  error responses always use shape { error: { code, message } }
```

---

## 16. MCP (Model Context Protocol)

**What it is:** The MCP server exposes tool (modus) execution to Claude and
other AI agents as structured tool calls. Auth via API key. Tool list reflects
all publica modi. Execution uses the same rail as the REST API.

**Crystal primitive:** `Modus` + `Actum` + `ActumInceptor` (same rail as API)

**Existing coverage:** `mcpServer.js` tested minimally. Gap.

### Required behavioral tests

```
MCP-1   list tools → returns all publica modi as MCP tool definitions
MCP-2   tool definition schema maps Modus.portae to MCP inputSchema
MCP-3   tool call with valid inputs → actum created, result returned in MCP format
MCP-4   tool call with unknown toolId → MCP error response (not unhandled throw)
MCP-5   tool call with insufficient balance → MCP error with payment message
MCP-6   auth failure → MCP error response
MCP-7   private tool → not in MCP tool list; call returns error
```

---

## Coverage matrix

| Domain | Legacy test file | Status | Gap tests needed |
|--------|-----------------|--------|-----------------|
| Spell | `generationExecutionService.test.js` | Partial | SPELL-6, 11, 12 |
| Canvas | None | Gap | CANVAS 1–10 |
| Tool | Partial | Partial | TOOL 4–6 |
| Expression | None | Gap | EXPR 1–8 |
| Cook | `CookService.test.js` | Partial | COOK 5–12 |
| Royalties | Crystal hooks only | Gap in chain | ROYALTY 1–9 |
| Model royalties | None | Gap | MODELROY 1–4 |
| Marketplace | None | Gap | MARKET 1–9 |
| Private models | `LoraService.test.js` | Partial | PRIVMODEL 1–6 |
| Model training | None | Gap | TRAINING 1–7 |
| Referral codes | None | Gap | REFERRAL 1–9 |
| Onchain deposit | `DepositProcessorService.test.js` | Partial | DEPOSIT 3–11 |
| X402 | None | Gap | X402 1–13 |
| Telegram | None | Gap | TELEGRAM 1–9 |
| Discord | None | Gap | DISCORD 1–7 |
| API | `internal.test.js` (health only) | Gap | API 2–11 |
| MCP | None | Gap | MCP 1–7 |

---

## Writing order (priority)

Write the highest-risk chains first — the ones where a divergence would lose money
or break a user's trust:

1. **Spell full chain** (SPELL 1–10) — core revenue path
2. **Royalties chain** (ROYALTY 1–9) — money distribution, unrecoverable if wrong
3. **Onchain deposit** (DEPOSIT 1–11) — trust boundary; wrong credits = real money lost
4. **X402** (X402 1–13) — payment without ledger; no recovery if proof validation is wrong
5. **Referral codes** (REFERRAL 1–9) — on-chain state; can't undo
6. **Cook** (COOK 1–12) — batch spend; N× the blast radius of a single spell
7. **Telegram + Discord** (TELEGRAM, DISCORD) — delivery failure isolation critical
8. **Canvas + Tool** (CANVAS, TOOL, EXPR) — correctness, not revenue-critical
9. **Marketplace + Private Models + Training** (MARKET, PRIVMODEL, TRAINING)
10. **API + MCP** (API, MCP) — auth surface
