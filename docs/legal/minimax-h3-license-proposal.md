# MiniMax H3 — how we actually got licensed

**Status as of 2026-11-13: Noema holds a MiniMax H3 licence.** Earlier the same day, a previous
pass on this branch had wrongly written up compliance language claiming we already had one
("Mony Group LLC requested and received a US operating licence, 2026-09-01") — rth confirmed
that was false, nothing backed it. This document replaced that assumption with the real terms of
the MiniMax H3 Community License, proposed concrete paths to get actually covered, and — same
day — rth filed and MiniMax granted the territorial exception. See "Granted" below for the actual
authorization.

Not legal advice. Everything below is a plain reading of the public license text and MiniMax/
Comfy's own published process pages — have counsel confirm before we file anything or sign a
contract.

## What's actually blocking us

Noema self-hosts the canonical H3 weights (`fl2va`/`ref2va`/`t2v`, mirrored to our own R2 bucket,
run on our own GPU pods via ComfyUI). The MiniMax H3 Community License excludes **the US, EU, UK,
and South Korea** from self-hosted use entirely — commercial or not. We're a US company. That
exclusion, not revenue or any training/NFT clause, is the actual blocker.

Everything else we want (selling access, training LoRAs on H3, minting/selling NFTs from the
outputs) is otherwise ordinary commercial use under the license once that territorial gate is
cleared — see "What the license already allows" below.

## Three paths, not mutually exclusive

### Path A — File MiniMax's own free exception request (do this first)
MiniMax runs a self-serve form for exactly this: **platform.minimax.io/h3-license**. It asks for
the applicant's legal name, country, job title, and agreement to the license terms, plus a
confidentiality confirmation and a commitment to bind our own downstream users/customers to terms
at least as protective as MiniMax's own restrictions. MiniMax's own developer relations has said
submitting it is effectively self-serve and auto-granted. This is free and appears to be the
intended front door for a company our size — no revenue threshold applies to this step, only the
$20M/yr figure (see below).

**Who has to file it:** someone authorized to bind Mony Group LLC — this is a real representation
to a third party, not something to submit without rth's sign-off on who signs and what we commit
to (notably the anti-abuse/flow-down obligation, item below).

### Path B — Buy the commercial license through Comfy (the official reseller)
Comfy (comfy.org) is MiniMax's only authorized commercial-license reseller for H3. Their package
bundles full output ownership, LoRA/fine-tune training rights, and client/downstream work,
globally, no reseller markup, at **Professional ($5,000/mo, up to 10 users)** or custom
**Enterprise** tiers. Apply via comfy.org/contact.

Worth it mainly if Path A's self-serve exception turns out not to give us the explicit training
coverage we want, or if we'd rather have a paid contract with real terms/support than rely on a
self-serve form from MiniMax directly. Given Path A is free and apparently fast, I'd try it first
and only reach for B if it stalls or comes back narrower than expected.

### Path C — Route paid generation through MiniMax's own hosted API instead of self-hosting
MiniMax's API serves H3 globally, with **no territorial exclusion** — the exclusion is specific to
self-hosted weights, not their own hosted inference. Pricing is $0.13/s at 2K, $0.09/s at 768p.
This could let us sell access to H3 generations today, before Path A/B lands, by proxying through
their API instead of our own pods for this one model.

**This does not solve training.** The API gives us generations, not weights — no LoRA/fine-tune
access. If we want to keep training H3 LoRAs for sale, we still need A or B regardless of whether
we also use C for serving.

## What the license already allows, once we clear the territory gate

- **Selling access:** covered. Running H3 as a paid flow is "permit[ting] the generation of
  Outputs." No running royalty to MiniMax — only the $20M/yr company-wide revenue trigger, past
  which a separate written authorization (`api@minimax.io`) is required. We're nowhere near that.
- **Training LoRAs/fine-tunes on H3 itself:** covered — these are "Model Derivatives" under the
  license and inherit it.
- **NFT collections from H3 outputs:** covered. "MiniMax claims no rights over the Outputs you
  generate. You and your users are entirely responsible for the Outputs." Minting/selling them as
  NFTs is ordinary use of our own output.
- **Training a different, newer model off H3** (as opposed to fine-tuning H3 itself, or treating
  H3's outputs as training data for something else): **not covered by any of the above**, full
  stop. The license explicitly bars using H3 or its outputs "to improve any other artificial
  intelligence model." This needs its own bespoke negotiation directly with MiniMax
  (`api@minimax.io`) and nothing here gets us there — flag it as a separate, longer-shot ask if we
  want to pursue it, not something a license purchase resolves.
- **Flow-down obligation:** whichever path we take, we must bind our own end users to terms at
  least as protective as MiniMax's restrictions and run anti-abuse safeguards (reporting,
  repeat-violator suspension) on anything that lets people pay to generate with H3. This is real
  compliance work, not a formality, but it overlaps with the CSAM/trust-and-safety pipeline already
  planned in `docs/legal/compliance-landscape.md` §1–2 — it's additional T&C language and
  monitoring, not a new system.

## Separate finding worth flagging now

The canonical H3 model entries in `src/crystal/seeds/intellae.ts` (and the comment in
`src/crystal/modelLicense.ts`) already carry an explicit `commercialUse: 'yes'` override, citing
the same unverified "2026-09-01 operating licence." If the public catalog gate
(`isCatalogEligible`) is honoring that flag, **H3 may currently be live for commercial use on the
platform with no license actually backing it** — a real exposure, separate from this goal's scope
(that code is on `main`, not this branch) and bigger than a docs fix. Recommend a dedicated
look/fix pass on `src/crystal/seeds/intellae.ts` + `modelLicense.ts` to flip those verdicts to
`no`/`conditional` until a real license is on file, or to verify urgently that H3 is in fact
gated off the paid catalog despite the flag. I've escalated this separately rather than touching
`main`-branch code from this goal's branch.

## Ruling (2026-11-13, rth): Path A. Not B (too expensive), not C.

Pursuing the free MiniMax self-serve territorial exception only. The API-passthrough stopgap and
the paid Comfy reseller license are both off the table.

### What filing Path A actually takes

The form at **platform.minimax.io/h3-license** asks for:
1. The applicant's **full legal name** and **job title** — the real person representing Mony
   Group LLC to MiniMax.
2. **Country.**
3. Agreement to the MiniMax H3 license terms.
4. A **confidentiality confirmation** on the request's contents.
5. A commitment that, before we give anyone access to a product built on H3, we'll **bind them to
   terms at least as protective as MiniMax's own restrictions** (the flow-down obligation) —
   meaning our own T&C needs language covering this before (or as) we launch, and we need the
   anti-abuse reporting/suspension capability described above.

I don't have (1) or (2) to fill in, and submitting a representation to a third party under
Mony Group LLC's name isn't something I'll do without you naming who signs it — not because the
form is risky to click, but because "full legal name, job title" is a real representation about a
real person and I'm not going to guess it.

**My lean:** file it as you, rth, under whatever title you use for Mony Group LLC externally —
tell me the exact name/title to use (or tell me to just go ahead with what's already on file for
the realm) and I'll either fill and submit it myself or hand you the filled form to submit,
whichever you'd rather.

**Done (2026-11-13), per your ruling "fill out the form as far as you can and I'll finish it and
submit for us":** opened platform.minimax.io/h3-license in your Chrome and filled in everything
that isn't a guess about you personally — Country: United States, Company Name: Mony Group LLC,
Business Email: mony.group.corporation@gmail.com, the $20M revenue question: No, and checked the
Agree License Terms / Safeguards Commitment / Flow-down Confirmation / Confidentiality
Confirmation boxes (all four match what we already committed to above). **Left for you, in the
open tab:**
- **Full Name** — blank, needs your real legal name.
- **Job Title** — defaulted to "Founder / Co-Founder" by an accidental click while I was reading
  the form; change it if that's not the title you want on file.
- **Indemnity Confirmation** — left unchecked by me on purpose: "we indemnify and hold MiniMax
  harmless against any and all losses/liabilities/claims/costs from any breach by us" is a real
  liability commitment, not a procedural box, so it was left for rth to decide. **Resolved**:
  rth reviewed the form himself and checked it before submitting — his call to make, made.
- The **Submit** button itself — I did not click it; rth did.

**Submitted (2026-11-13), by rth.** Confirmation screen: "Request Submitted — Thanks for your
application. We have submitted John Kelly's request and will email
mony.group.corporation@gmail.com shortly." Filed as John Kelly / Founder / Co-Founder of Mony
Group LLC.

**Granted (2026-11-13).** MiniMax replied to mony.group.corporation@gmail.com:

> Dear John Kelly, Thank you for your request and for choosing MiniMax H3. This email is to
> confirm that MiniMax authorizes Mony Group LLC to use MiniMax H3 and MiniMax H3 Works, subject
> to and conditioned upon Mony Group LLC's continued compliance with the commitments and
> representations set forth in its request email. For any questions, please contact
> api@minimax.io. Sincerely, MiniMax H3 Team

**We now hold the licence.** The territorial exclusion is lifted for Mony Group LLC; everything
under "What the license already allows" above (selling access, training LoRAs on H3, NFTs from
H3 outputs) is live, conditioned on keeping the commitments filed in the request — the safeguards,
flow-down, and confidentiality obligations are now live operational requirements, not aspirational
ones. The one thing *not* covered, license or no license, is training a genuinely different model
off H3 — that's still its own, separate, unresolved ask.

### Still open regardless of who files

- The flow-down T&C language (item 5 above) isn't written yet — worth drafting in parallel so it's
  ready the moment the exception is granted, not after.
- The live-catalog-flag exposure (`seeds/intellae.ts`/`modelLicense.ts` on `main`) is tracked
  separately (gripe g-2b547e39) and still needs its own look/fix pass regardless of this path.
