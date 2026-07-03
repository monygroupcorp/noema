# Privacy Policy — DRAFT
**Last updated:** 2026-06-17
**Status:** DRAFT. Not legal advice. Requires counsel review before publication.
**Entity placeholder:** [ENTITY NAME], [JURISDICTION]

---

## The short version

We built the architecture so that private compute sessions **do not route through our servers** — being out of the data path is an architectural fact, not just a promise we make. Here is what that means in practice:

- In a private session, your prompts, outputs, and model selection never reach our servers. We see: a session opened, GPU-hours consumed, a session ended.
- We do not run Google Analytics or any third-party tracking.
- If you use Bursa anonymous credits, we cannot link your spend to an identity. The billing is a zero-knowledge proof.
- We do not train on your data.

The long version follows.

---

## 1. Who we are

[ENTITY NAME] operates the Noema Crystal platform, a private AI compute service. References to "we," "us," or "our" mean [ENTITY NAME]. Our registered address is [ADDRESS].

For GDPR purposes, [ENTITY NAME] is the data controller for account and billing data. For private sessions, we are not a controller of session content — we never receive it.

---

## 2. What we collect and why

### 2a. Account data (if you create an account)

| Data | Why we collect it | Retention |
|---|---|---|
| Email address | Account creation, service notices | Until account deletion + 30 days |
| Password hash | Authentication | Until account deletion |
| Account ID (animaId) | Session and billing association | Until account deletion + 30 days |
| Wallet address (if crypto sign-up) | Payment rail association | Until account deletion + 30 days |

You can use anonymous credits (Bursa) without an account. If you do, we hold none of the above.

### 2b. Billing and payment data

We do not store payment card numbers. Credit card payments are processed by [PAYMENT PROCESSOR], subject to their privacy policy.

Crypto deposits: we screen incoming deposit addresses against OFAC sanctions lists. This is a legal obligation, not surveillance. We retain the deposit address and transaction ID for compliance record-keeping (see Section 6).

Anonymous credit (Bursa): a Bursa token is a Groth16 zero-knowledge proof. We verify the proof and dispense compute; we cannot link the spend to your identity or prior transactions. We retain: that a proof was verified, the credit amount, the timestamp.

### 2c. Session metadata (all session types)

| Data | Why we collect it | Retention |
|---|---|---|
| Session ID | Billing reconciliation | 90 days |
| Session start / end timestamps | Billing | 90 days |
| GPU-hours consumed | Billing | 90 days |
| Credit amount charged | Billing | 90 days |
| IP address (connection establishment only) | Rate limiting, abuse prevention | 24 hours |

We do not retain IP addresses beyond 24 hours. We do not correlate IPs with account identities.

### 2d. Session content — private sessions

**We do not receive, store, or have access to:**
- Your prompts or inputs
- Model outputs
- Which AI model you selected
- Any content exchanged through the WireGuard tunnel

The WireGuard tunnel is established directly between your browser and the GPU pod. After tunnel establishment, our servers are architecturally excluded from the data path. The pod receives only what you send through the tunnel.

The pod runs on single-tenant infrastructure from our compute provider. Until the confidential-compute hardware tier ships, the provider hosting the pod is technically positioned to access the pod's memory (see Section 5); we are not.

The platform receives exactly three signals from a private session, all content-free: session started, heartbeat (GPU-hours), session ended.

### 2e. Session content — non-private sessions (API, bot)

In non-private sessions (Telegram bot, direct API without a private session), we process your prompts and outputs to deliver the service. We do not retain prompt or output content after the request completes. We do not use prompt or output content to train models.

We retain session metadata as described in 2c.

### 2f. Usage and error logs

We collect server-side error logs (stack traces, request metadata, error codes) for debugging. These logs do not contain prompt or output content. Retention: 30 days.

### 2g. What we do not collect

- Browser fingerprints
- Third-party analytics (no Google Analytics, no Mixpanel, no similar services)
- Advertising identifiers
- Cross-site tracking data
- Device identifiers beyond what's necessary for rate limiting

---

## 3. Cookies

We use strictly necessary cookies only:

| Cookie | Purpose | Duration |
|---|---|---|
| Session token | Authentication | Session / 30 days if "stay logged in" |
| CSRF token | Security | Session |

We do not use advertising cookies, analytics cookies, or third-party tracking cookies. You cannot opt out of strictly necessary cookies without disabling the service. There is nothing else to opt out of.

---

## 4. How we use your data

We use collected data to:
- Provide and operate the service
- Bill for compute usage
- Detect and prevent abuse, fraud, and prohibited content (see Section 7)
- Comply with legal obligations (OFAC screening, CSAM reporting)
- Respond to support requests

We do not:
- Sell your data to third parties
- Use your data for advertising
- Train AI models on your prompts or outputs
- Share your data with third parties except as described in Section 5

---

## 5. Sharing and disclosure

We share data only in these limited circumstances:

**Infrastructure providers:** We use RunPod for GPU compute. Session metadata is shared as necessary to provision and bill for compute. Session content in private sessions is never transmitted to us; it reaches the provider's GPU pod only through your encrypted tunnel. Because the pod runs on the provider's hardware, the provider is technically positioned to access pod memory until the confidential-compute tier ships; we do not share content with them, and NOEMA has no access path of its own.

**Payment processors:** [PROCESSOR NAME] handles payment card processing. We share only what's necessary to process your payment.

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
| Account data | Until account deletion + 30 days |
| Session metadata (billing) | 90 days |
| IP addresses | 24 hours |
| Error logs | 30 days |
| Prompt / output content (private sessions) | Never received |
| Prompt / output content (non-private sessions) | Not retained after request |
| OFAC screening records | 5 years (legal requirement) |
| CSAM reporting records | As required by law |
| Bursa ZK proof records | Proof verification timestamp + credit amount, 90 days |

---

## 8. Your rights

Depending on your jurisdiction, you may have the right to:
- Access the personal data we hold about you
- Correct inaccurate data
- Delete your account and associated data
- Export your data
- Object to processing
- Lodge a complaint with your supervisory authority (EU: your national DPA)

To exercise these rights: [CONTACT EMAIL]

Because we hold minimal data by architecture, most requests can be fulfilled immediately. Private-session content is not held by us and cannot be retrieved or deleted — it was never received.

---

## 9. International transfers

If you are located in the EU/EEA, your data may be transferred to and processed in [JURISDICTION]. We rely on [TRANSFER MECHANISM — e.g., Standard Contractual Clauses] for such transfers.

---

## 10. Children

The service is not directed to children under 13 (or 16 in the EU). We do not knowingly collect data from children. If we learn we have, we will delete it promptly.

---

## 11. Changes

We will notify you of material changes via [email / in-app notice] at least 14 days before they take effect. The "last updated" date at the top of this policy reflects the most recent revision.

---

## 12. Contact

Privacy questions: [PRIVACY EMAIL]
Data protection officer (if applicable): [DPO NAME / EMAIL]
Address: [ADDRESS]

---

*Counsel review checklist:*
- [ ] Confirm GDPR controller/processor classification for each data type
- [ ] Confirm DPA registration requirement in target jurisdictions
- [ ] Finalize OFAC retention period with compliance counsel
- [ ] Confirm Standard Contractual Clauses or alternative transfer mechanism
- [ ] Add DPO contact if required (EU entities with large-scale processing)
- [ ] Review cookie section against ePrivacy Directive requirements
- [ ] Confirm CCPA compliance (if serving California residents)
