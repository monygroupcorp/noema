<!-- Reference copy of the page published at /legal/terms. The published page is the source of
     truth: `src/platforms/web/app/src/content/terms.md`. Keep the two in step. -->

# Terms & conditions

**Last updated:** 2026-11-14

---

## 1. The service

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
  that gate cannot run the publication is refused rather than allowed. A human reviewer confirms
  an apparent match before any report is filed; on confirmation the publication is rejected and
  the evidence preserved. We are required by **18 U.S.C. § 2258A** to report child sexual abuse
  material to **NCMEC**, and we cooperate with law enforcement. This is a zero-tolerance,
  immediate-termination offense.
- **Non-consensual intimate imagery**, including AI deepfakes of real persons (per the
  **TAKE IT DOWN Act** and state law). We honor takedown requests within 48 hours — send one to
  mony.group.corporation+privacy@gmail.com.
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
  The exception is **MiniMax H3**, whose restrictions are set out in full in Section 11 and must
  be accepted before your first MiniMax H3 run.
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
  a session as sealed from the compute provider. We keep the record of each run — the inputs you
  submitted and the outputs they produced — as your own history. Erasing your account severs
  that record from you rather than deleting it. We do not train models on it. The Privacy Policy sets out what is held and for how long.
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
acceptance, except that Section 11 is accepted explicitly, as it says. Material changes will be
notified by in-app notice.

## 11. MiniMax H3 — additional terms

The video flows marked **MiniMax H3** run the MiniMax H3 model, which MiniMax licenses to us under
the [MiniMax H3 Community License Agreement](/legal/minimax-h3-license). That agreement requires us
to bind everyone who uses MiniMax H3 through the Service to its use restrictions, and these terms
do so. **You must accept this section before your first MiniMax H3 run**, and again whenever it
changes materially. Until you do, a MiniMax H3 run is refused before anything is charged. These
terms are in addition to the rest of these terms, and where the two differ the stricter one applies.

**11.1 Where you may use it.** MiniMax's licence does not extend to the European Union, the United
Kingdom or the Republic of Korea. You will not run MiniMax H3, or use, reproduce, modify,
distribute or display it or its outputs, from or into any of them. (We hold a separate licence from MiniMax for the
United States.)

**11.2 What you may not do with it.** You will not use MiniMax H3, any model derived from it, or
any of its outputs:

1. in or into any territory 11.1 excludes;
2. in any manner that violates any applicable national, federal, state, local or international
   law, regulation or other legal requirement (including trade-compliance laws), or that infringes, misappropriates or otherwise
   violates anyone's intellectual-property or other proprietary rights, including through
   unauthorized reproduction, distribution, public display, public performance or creation of
   derivative works;
3. in any manner that may harm yourself or others;
4. to repurpose or distribute its outputs in order to harm yourself or others;
5. to circumvent or bypass any safety guardrail or safeguard, ours or MiniMax's;
6. in any manner that exploits or harms, or intends to exploit or harm, minors;
7. to generate or disseminate verifiably false information or content for the purpose of harming
   others or influencing elections;
8. to manufacture or facilitate false online engagement, including fake reviews;
9. to intentionally defame, disparage or otherwise harass others;
10. to generate or disseminate malware (including ransomware) or any other content intended to
    damage electronic systems;
11. to generate or disseminate personally identifiable information for the purpose of harming
    others;
12. to generate or disseminate information or content (including images, video, code, posts or
    articles) in or to any public environment, including by bot posts or similar means, without
    clearly and prominently disclosing that it is machine-generated;
13. to impersonate another person without that person's consent, authorization or lawful right;
14. to make high-risk automated decisions in critical domains that affect individual safety, rights
    or well-being, such as law enforcement, immigration, healthcare or medical services,
    critical-infrastructure management, product-safety components, essential services, credit,
    employment, housing, education, social scoring or insurance;
15. in any manner that violates or disregards the social, ethical or moral standards of other
    countries or regions;
16. to carry out, assist, threaten, incite, plan, advocate for or encourage violent extremism or
    terrorism;
17. for any purpose intended to discriminate against or harm individuals or groups based on
    protected characteristics or categories, online or offline social behavior, or known or
    predicted personality traits;
18. to intentionally exploit the vulnerabilities of specific populations based on age, social,
    physical or psychological characteristics, so as to materially distort the behavior of a member
    of that group in a manner that causes, or is likely to cause, physical or psychological harm to
    that person or to others;
19. for military purposes;
20. to engage in any unauthorized or unlicensed professional activity, including financial, legal,
    medical or healthcare, or other professional practice.

**11.3 No training other models.** You will not use MiniMax H3 or any of its outputs or results to
improve any other artificial-intelligence model, including by distillation or by training on its
outputs.

**11.4 Updates from MiniMax.** You will also comply with MiniMax's acceptable-use policy for
MiniMax H3 as MiniMax revises it from time to time, wherever it is stricter than 11.2. When it
changes we will update this section and ask you to accept the revised section before your next
MiniMax H3 run.

**11.5 Reporting and suspension.** Anyone can report a MiniMax H3 output they believe breaks this
section: use **Report this output** on the run, or write to
mony.group.corporation+abuse@gmail.com with a link to it. We investigate every good-faith report.
Where we confirm a violation we may remove or disable access to the content, and the confirmed
violation is recorded against the account that ran it. **An account with two confirmed violations
is suspended from MiniMax H3 flows.** This is in addition to suspension or termination under
Section 9, which a single serious violation can warrant on its own.

**11.6 Responsibility.** You are responsible for your MiniMax H3 outputs and any use of them.
MiniMax claims no rights in them, and provides MiniMax H3 "as is", without warranty.
