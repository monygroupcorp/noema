# Privacy Policy — DRAFT
**Last updated:** 2026-08-26
**Status:** DRAFT. Not legal advice. Requires review before publication.
**Controller:** MONY GROUP LLC, a Tennessee limited liability company, foreign-qualified in North Carolina.

---

## The short version

We collect as little as we can and we do not track you. Here is what that means in practice:

- **We never ask who you are.** No email, at any point. Sign up with a wallet and there is no
  username either — the account is a signature. Anonymous credits work with no account at all.
- Your runs — the inputs you submit and the outputs they produce — **are kept**, as **your own
  history**, so you can go back to what you made and what it cost. We can technically read them.
  We do not use them to train models, and there is no automatic expiry today (see Section 2c).
- We do not run Google Analytics or any third-party tracking.
- If you use purse anonymous credits, we cannot link your spend to an identity. The billing is a zero-knowledge proof.
- Your session content travels encrypted, but it is **executed on rented third-party GPU hardware**. The operator of that hardware is inside the trust boundary. We do not claim otherwise (see Section 2d).
- A hardware-sealed private-compute tier (TEE), in which session content would be technically inaccessible to us and to the host, is **in development and not available** (see Section 2e).

The long version follows.

---

## 1. Who we are

MONY GROUP LLC, a Tennessee limited liability company, foreign-qualified in North Carolina, operates the Noema Crystal platform, an AI compute service. References to "we," "us," or "our" mean MONY GROUP LLC. Our registered address is 116 Agnes Rd, Ste 200, Knoxville, TN 37919-6306.

For GDPR purposes, MONY GROUP LLC is the data controller for account, billing, and run data, and uses the processors listed in Section 5 to deliver the service.

---

## 2. What we collect and why

### 2a. Account data (if you create an account)

| Data | Why we collect it | Retention |
|---|---|---|
| Username | Sign-in and account identification | Until you erase your account (see Section 8) |
| Password hash | Authentication | Until you erase your account |
| Account ID (animaId) | Run and billing association | Pseudonymized on erasure; the opaque id is retained (Section 7) |
| Wallet address (if crypto sign-up) | Payment rail association | Until you erase your account |

**We never ask for an email address.** There is no email field in sign-up, no verification mail,
and no outbound mail provider configured in the deployment. Account recovery does not use email
either: you bind a wallet or a Telegram account yourself, from your profile, and proving one of
those is what recovers the account.

**You can hold an account without a username.** Signing up with a wallet mints the account from a
signature alone — no username, no password, and nothing to remember. In that case the only row
above we hold is the wallet address and the opaque account id.

You can also use anonymous credits without any account at all. If you do, we hold none of the
above.

### 2b. Billing and payment data

We do not store payment card numbers. Card payments are processed by Stripe, subject to their privacy policy; we hold the reference identifiers their webhooks return.

Crypto deposits: deposit events reach us through Alchemy's webhooks, so the depositing address and transaction hash are visible to that provider and to us. We screen incoming deposit addresses against OFAC sanctions lists. This is a legal obligation, not surveillance. We retain the deposit address and transaction ID for compliance record-keeping (see Section 6).

Anonymous credit: a purse token is a Groth16 zero-knowledge proof. We verify the proof and dispense compute; we cannot link the spend to your identity or prior transactions. We retain: that a proof was verified, the credit amount, the timestamp.

### 2c. Run records

A run is one piece of work you asked for. When it settles, we keep its record:

| Data | Why we keep it | Retention |
|---|---|---|
| The inputs you submitted | Your run history — so you can see and reuse what you asked for | Until you erase your account |
| The outputs produced | Your run history — so your results stay available to you | Until you erase your account |
| Run id, start / end timestamps | Billing reconciliation and your history | Until you erase your account |
| Compute consumed and credit charged | Billing; part of the append-only spend ledger | Retained (Section 7) |

This is a deliberate design: a spend history is worth little if the thing you spent on is gone. The record is visible to you in the product, and to us — we can technically read it. It is not used to train models and it is not shared beyond the processors in Section 5.

We do not currently operate an automatic expiry window on run records. When that machinery ships, this section will state the window; until then the honest statement is: retained until account erasure.

**IP addresses:** used in memory for rate limiting, in a rolling fifteen-minute window. They are not written to the database.

### 2d. Where your session content is executed

To produce your results, your inputs and outputs are processed on external GPU compute (RunPod) and, for concierge/chat, an external LLM provider (via OpenRouter). These providers are inside the trust boundary: we and they can technically access session content in order to run it.

The transport hop is encrypted end to end. That is a statement about the wire, not about the host: the compute runs on rented third-party hardware without attestation, so the operator of that hardware is inside the boundary too. We do not claim your session content is unseen by the compute provider. That guarantee requires the hardware-sealed tier described in 2e, which is not available.

Generated media is stored in our Cloudflare R2 outputs bucket, which is bound to a public URL: anyone holding an output's link can fetch it. Treat an output link as a shareable link.

### 2e. Private compute (TEE) — in development

We are building a hardware-sealed private-compute tier in which a tunnel runs directly between your browser and a single-tenant GPU pod, with browser-verified attestation of the host, so that session content would be technically inaccessible to us and to the host operator. In that tier, inputs and outputs would not be retained after the request completes.

**This tier is in development and is not available.** Nothing in this section describes the service as it runs today. Until it ships, do not treat any session as sealed from the compute provider. This policy will be updated when the tier launches.

### 2f. Reports you file

If you file a bug report, feature request, or feedback from inside the product, we store what you wrote along with the route you were on, the run it concerned (if any), your browser's user-agent string, and the error your client surfaced. Reports are tied to the account or purse that filed them. They stay in our own database — no report is forwarded to a third-party tracker or issue service. Retention: until the report is handled, or until you erase your account.

### 2g. Usage and error logs

We collect server-side diagnostic logs (component, message, error detail, and identifiers such as the account id and run id) for debugging. Prompt and output bodies are not written to these logs. The logs go to the host's container log; they are not stored in the application database.

### 2h. What we do not collect

- Browser fingerprints
- Third-party analytics (no Google Analytics, no Mixpanel, no similar services). The optional telemetry forwarder built into the service is not configured in production.
- Advertising identifiers
- Cross-site tracking data
- Device identifiers beyond what's necessary for rate limiting

---

## 3. Cookies and browser storage

We set **one** cookie, and only if you contribute to the trusted-setup ceremony:

| Cookie | Purpose | Properties |
|---|---|---|
| `noema-cer-sid` | Holds one ceremony contribution slot per session, so refresh-spam cannot inflate the transcript | httpOnly, SameSite=Lax, scoped to `/v1/ceremony`, 30 days. A signed random id, carrying no account data |

Your sign-in session is **not** a cookie. It is a token held in your browser's `localStorage` and sent on each API call. The full browser-storage inventory is in the [Cookie Policy](/legal/cookies).

We do not use advertising cookies, analytics cookies, or third-party tracking cookies. There is nothing to opt out of.

---

## 4. How we use your data

We use collected data to:
- Provide and operate the service
- Show you your own run history
- Bill for compute usage
- Detect and prevent abuse, fraud, and prohibited content (see Section 6)
- Comply with legal obligations (OFAC screening, CSAM reporting)
- Respond to reports and support requests

We do not:
- Sell your data to third parties
- Use your data for advertising
- Train AI models on your inputs or outputs
- Share your data with third parties except as described in Section 5

---

## 5. Sharing and disclosure

We share data only in these limited circumstances:

**Compute providers:** RunPod for GPU compute and, for concierge/chat, an external LLM provider (via OpenRouter). Session content is transmitted to these providers as necessary to run your request.

**Storage:** Cloudflare R2 holds generated outputs and data-export bundles.

**Payments:** Stripe handles card processing. Alchemy's webhooks deliver on-chain deposit events, which carry the depositing address and transaction hash.

**Legal requirements:** We will disclose data when required by law, court order, or to cooperate with law enforcement. We will attempt to notify you before disclosing (where legally permitted).

**CSAM reporting:** If we detect or receive notice of child sexual abuse material, we are required by 18 U.S.C. § 2258A to report to NCMEC and preserve evidence. This overrides all other privacy commitments.

**Business transfer:** If the company is acquired or merged, your data may transfer to the acquiring entity subject to the same commitments in this policy.

---

## 6. Legal obligations and compliance

We screen crypto deposit addresses against OFAC sanctions lists. We retain this screening record for compliance. If a deposit address matches a sanctioned entity, we freeze the associated balance and report as required.

We run content classifiers and hash-matching against known CSAM databases at the trust boundary (model input and output). This scanning does not require us to store or surveil your content — it runs on the content as it passes through and retains nothing on a clean match.

---

## 7. Data retention summary

| Data type | Retention |
|---|---|
| Account credentials and profile | Until you erase your account |
| Run records (inputs, outputs, timestamps) | Until you erase your account |
| Generated media in object storage | Until you erase your account |
| Credit ledger, deposits, and payment records | Retained — the ledger is append-only and is never rewritten. After erasure it carries no identifying fields (Section 8) |
| Account anchor after erasure | Pseudonymized shell, 7 years, for financial-record and dispute-resolution duties |
| In-progress workflow state | 30 days from last update (automatic expiry) |
| Sign-in links and short-lived secrets | Expire at their own stated expiry (automatic) |
| Data-export bundles | Private bucket; the download link expires 15 minutes after it is issued |
| IP addresses | Not stored |
| Diagnostic logs | Host container log; not stored in the application database |
| OFAC screening records | 5 years (legal requirement) |
| CSAM reporting records | As required by law |
| Purse ZK proof records | Proof verification timestamp + credit amount |

---

## 8. Your rights

Depending on your jurisdiction, you may have the right to:
- Access the personal data we hold about you
- Correct inaccurate data
- Erase your account and associated data
- Export your data
- Object to processing
- Lodge a complaint with your supervisory authority (EU: your national DPA)

**Export** is self-service: the product assembles everything held under your account into a downloadable bundle, delivered by a link that expires fifteen minutes after it is issued.

**Erasure** is self-service, and it works by pseudonymization rather than by rewriting the ledger. When you erase your account:

1. Your live sessions are revoked immediately.
2. Your account record is stripped of its identifying fields — name, credentials, wallet — and marked erased. What remains is an opaque id with nothing in it that points to a person.
3. Identity and content collections are deleted outright: profiles, credentials, preferences, memory, projects, requests, and your chat conversations and their messages.
4. The financial ledger — credits, payments, deposits, revenue — is **not** modified. It is append-only by design. Those rows keep the opaque account id, which after step 2 identifies nobody.
5. Run records and any works you published keep the same opaque id, for the same reason. Published works stay live and are shown as authored by an anonymous creator.

We state this plainly rather than promise a deletion we do not perform: erasure severs the person from the record, and the anonymized financial and run rows remain.

To exercise these rights: use the account controls in the product, or contact mony.group.corporation+privacy@gmail.com.

---

## 9. International transfers

If you are located in the EU/EEA, your data may be transferred to and processed in the United States. We rely on [TRANSFER MECHANISM — e.g., Standard Contractual Clauses] for such transfers.

---

## 10. Children

The service is not directed to children under 13 (or 16 in the EU). We do not knowingly collect data from children. If we learn we have, we will delete it promptly.

---

## 11. Changes

We will notify you of material changes by in-app notice at least 14 days before they take effect. We cannot notify you by email, because we do not hold one. The "last updated" date at the top of this policy reflects the most recent revision.

---

## 12. Contact

Privacy questions: mony.group.corporation+privacy@gmail.com
Data protection officer: none appointed. We are below the thresholds that require one; if that changes this section will name the appointee.
Address: 116 Agnes Rd, Ste 200, Knoxville, TN 37919-6306

---

*Review checklist:*
- [ ] Confirm GDPR controller/processor classification for each data type
- [ ] Confirm DPA registration requirement in target jurisdictions
- [ ] Finalize OFAC retention period
- [ ] Confirm Standard Contractual Clauses or alternative transfer mechanism
- [ ] Add DPO contact if required (EU entities with large-scale processing)
- [ ] Review cookie section against ePrivacy Directive requirements
- [ ] Confirm CCPA compliance (if serving California residents)
- [ ] Re-state Section 2c once run-record expiry windows exist
