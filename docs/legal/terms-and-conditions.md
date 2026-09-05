<!-- Reference copy of the page published at /legal/terms. The published page is the source of
     truth: `src/platforms/web/app/src/content/terms.md`. Keep the two in step. -->

# Terms & Conditions

**Last updated:** 2026-09-05

---

## 1. The Service

MONY GROUP LLC ("we", "us") provides access to rented GPU compute for running AI models
("Service"). Two usage modes:

- **Catalog mode** — you select from models we provide and pay per use ("Credits").
- **Bring-your-own (BYO) mode** — you supply your own model weights to a compute instance.

We are a **compute provider and merchant of our own services**. Credits are a **closed-loop,
non-transferable prepaid balance** redeemable solely for Service usage. **Unused credits are
refundable within 14 days of purchase; credits that have been spent, in whole or in part, are
non-refundable for the spent portion.** They are not money, not a security, not a deposit, confer
no ownership or profit expectation, and cannot be cashed out or transferred to other users.

## 2. Eligibility & sanctions

You represent you are not located in, or acting on behalf of any person in, a jurisdiction
or on any list subject to **OFAC or other applicable sanctions**. We screen deposit
addresses and may refuse or freeze access on a sanctions match. You must be of legal age in
your jurisdiction.

## 3. Acceptable use — prohibited content & conduct

You will not use the Service to generate, store, transmit, or facilitate:

- **Child sexual abuse material (CSAM)** or any sexual content involving minors, real or
  AI-generated. Nothing reaches a public surface without clearing a moderation gate, and where
  that gate cannot run the publication is refused rather than allowed. Apparent CSAM is
  confirmed by a human reviewer, reported to **NCMEC** as required by **18 U.S.C. § 2258A**,
  and preserved as evidence; we cooperate with law enforcement. This is a zero-tolerance,
  immediate-termination offense.
- **Non-consensual intimate imagery**, including AI deepfakes of real persons (per the
  **TAKE IT DOWN Act** and state law). We honor takedown requests within 48 hours.
- Content that is illegal in your jurisdiction or ours, infringes others' rights, or
  facilitates violence, terrorism, or trafficking.

Screening reads the content itself as it passes the **trust boundary**, not who you are, and
publication to a public surface is where it is enforced. We do not log private-session content
beyond what these controls require.

## 4. Model licensing & intellectual property

- **Catalog mode:** we are responsible for clearing the license of models we provide for
  commercial use, and only offer models so licensed. Some models carry **use-based
  restrictions** (e.g., OpenRAIL-M, Meta Llama Community License); by using them you agree to
  comply with those upstream restrictions, which **flow down** to you as a condition of use.
  The applicable restrictions are those of the upstream model's own licence, which travels with the weights; we do not publish a consolidated list of them today.
- **BYO mode:** you represent and warrant that you hold all rights necessary to use the
  weights you supply, and you indemnify us against any claim arising from your model. We do
  not review or license your supplied weights.
- **Outputs:** subject to each model's license terms, outputs you generate are yours to use;
  you are responsible for your use of them, including any required AI-content disclosure
  under the **EU AI Act** or other law.

## 5. Privacy & confidentiality

- Sessions route through an encrypted WireGuard tunnel whose keys are generated on your device,
  terminating at a single-tenant compute instance. This is network isolation only: the
  infrastructure provider hosting the instance can technically access its memory, so do not treat
  a session as sealed from the compute provider. We retain only metadata necessary to bill and
  operate (that a session occurred, its cost, its duration).
- In **bot-mediated (Simple Case)** sessions, we act as your client and necessarily process
  your prompts, outputs, and identity to deliver the Service.
- The Service is **not offered for regulated workloads**. We do not act as a HIPAA Business
  Associate and offer no Business Associate Agreement. Do not transmit protected health
  information, or privileged material, through the Service.

## 6. Payment

Credits are purchased via supported crypto and/or fiat on-ramps and convert to a single
closed-loop balance. **Unused credits are refundable within 14 days of purchase; once credits
have been spent, the spent portion is non-refundable.** We may suspend access for suspected abuse,
sanctions match, or chargeback.

## 7. Disclaimers & limitation of liability

The Service and model outputs are provided **"as is", without warranty**. AI outputs may be
inaccurate, offensive, or unsuitable; you are responsible for reviewing and for your use. To
the maximum extent permitted by law, our aggregate liability is limited to the Credits you
paid for the Service. We are not liable for indirect or consequential
damages.

## 8. Indemnification

You indemnify and hold us harmless from claims arising out of your use of the Service, your
supplied content or weights, your outputs, and your breach of these terms.

## 9. Termination

We may suspend or terminate access immediately for violations of Section 3, sanctions
matches, or legal requirement. Prohibited-content violations are reported as required by law.

## 10. Governing law & changes

Governed by the laws of the State of Tennessee. We may update these terms; continued use constitutes
acceptance. Material changes will be notified by in-app notice.
