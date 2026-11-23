<!-- Reference copy of the page published at /legal/api-terms. The published page is the source of
     truth: `src/platforms/web/app/src/content/api-terms.md`. Keep the two in step. -->

# API Customer Agreement

**Version:** api-2026-09-17
**Last updated:** 2026-09-17

---

This agreement governs commercial access to the noema API. It is between MONY GROUP LLC
("we", "us") and the organization whose authorized representative signs it ("you"). It is
separate from the [Terms & Conditions](/legal/terms) that govern the consumer service: where
the two differ for API use, this agreement controls. Everything not addressed here — sanctions
screening, prohibited content, privacy — is governed by those terms and by the
[Privacy Policy](/legal/privacy), which apply to you unchanged.

## 1. What we provide

Access to the same models the consumer service runs, over the documented HTTP API, authenticated
by an API key issued to you. We provide the compute; we do not review, approve, or curate what
you send through it. There is no service-level commitment in this agreement: capacity is rented
GPU capacity and we do not promise availability, latency, or throughput.

## 2. Your inputs, and what you warrant about them

"Inputs" means everything you send us: prompts, reference images, model weights, datasets,
fine-tuning material, and anything your own users send you that you pass on to us.

You warrant, for every input, that:

- you hold or have been granted every right needed to send it to us and to have a model process
  it, and that our processing of it infringes nobody's copyright, trademark, publicity, privacy,
  or contract rights;
- it is lawful in your jurisdiction and in the United States;
- it contains no material depicting a minor sexually, and no intimate imagery of an identifiable
  person who did not consent to it;
- where an input is a person's likeness, name, or voice, you have that person's consent for the
  use you are making.

This is the substance of the arrangement. You choose the data; you carry the risk of that choice.
We are not in a position to verify the provenance of what you send, and this agreement does not
put us in one.

## 3. No named-artist styles, in either direction

Neither side trades on a named living artist's identity.

- **You** will not send prompts, adapters, or fine-tuning material whose purpose is to reproduce
  the style of a named living artist, and will not present outputs as that artist's work.
- **We** will not offer you a model, adapter, or preset that we have named after, or trained to
  imitate, a named living artist, and we will not build one at your request.

Either side may end this agreement for a breach of this section without waiting out a cure period.

## 4. Indemnity

You will defend, indemnify, and hold us harmless against any claim, demand, proceeding, loss,
liability, damages, and reasonable legal costs arising out of or relating to:

- your inputs, including any claim that an input or its processing infringed someone's rights;
- your outputs, and your or your users' use, publication, or sale of them;
- your breach of section 2 or section 3;
- your own service, product, or terms with your users, to the extent the claim reaches us because
  you passed their material through our API.

We will tell you about a claim promptly, let you control the defense, and cooperate at your cost.
You may not settle a claim in a way that admits fault on our part or binds us to an obligation
without our written agreement.

## 5. Your key, and our right to cut it

An API key is issued to you only after this agreement is signed and a billing account is on file,
and it stops working when either stops being true. The key is a bearer credential: anything done
with it is done by you, and you are responsible for keeping it secret and for telling us promptly
if it leaks.

**We may suspend or revoke any key immediately, without notice and at our discretion**, where we
believe it is being used in breach of this agreement, in breach of the prohibited-content terms,
in breach of a model's upstream licence, or where a law, a court, or a payment or infrastructure
provider requires it. We may also cut a key to stop an in-progress harm while we work out what
happened. Revocation does not release you from amounts already metered.

Revising this agreement is a new version. Your existing key keeps working under the version it
was issued against until we retire that version; a retired version means signing the current one
and rotating your key. You can rotate a key yourself at any time, which retires the previous one.

## 6. Metering and payment

Every API call that starts a generation is metered against the key that made it, and the record
carries the model that ran and the units it consumed — compute seconds, and the platform's
internal unit of account derived from them. That meter is the only basis on which you are billed.
You can read your own meter through the API at any time; a call that fails and is refunded is
recorded but not billed.

Billing is **post-paid**: at the end of each period we issue an invoice drawn from the meter,
itemized by flow, and you pay it. Payment is due on the terms recorded on your billing account.
Invoiced amounts are payments for services rendered — they are **not** consumer credits: nothing
you pay under this agreement is added to a spendable credit balance, and nothing in this agreement
is refundable as an unspent credit would be. Disputed line items must be raised within 30 days of
the invoice, and we will settle a dispute against the meter.

We may suspend keys on non-payment.

## 7. Outputs, confidentiality, and data

Outputs are yours to use, subject to the upstream licence of the model that produced them, some
of which carry use-based restrictions that flow down to you. We keep the record of each run — its
inputs and its outputs — as the account's history, the same as the consumer service does, and the
Privacy Policy sets out what is held and for how long. We do not train models on your inputs.

Inference runs on plaintext on GPUs we operate. Treat this as ordinary hosted compute: do not send
protected health information, payment card data, or anything else you are under a regulatory duty
to keep from a processor who offers no agreement covering it. We offer no Business Associate
Agreement and the API is not offered for regulated workloads.

## 8. Warranty disclaimer and limit of liability

The API and the model outputs are provided **"as is", without warranty of any kind**. Model outputs
may be wrong, offensive, or unsuitable for your use; reviewing them is your job.

To the maximum extent permitted by law, our aggregate liability under this agreement is limited to
the amounts you paid us under it in the twelve months before the claim arose, and neither side is
liable for indirect or consequential damages. Nothing in this section limits your indemnity under
section 4, which is not capped.

## 9. Term and termination

This agreement runs until either side ends it on 30 days' written notice, and either side may end
it immediately for a material breach the other does not cure within 15 days — or, under section 3,
with no cure period. Ending it revokes your keys. Sections 2, 4, 6 (for amounts already metered),
7, and 8 survive.

## 10. Governing law and changes

Governed by the laws of the State of Tennessee. We may publish a new version of this agreement;
a new version applies to you when you sign it, and until then the version you signed governs.

## Signing

You sign this agreement through your partner account: the API returns the current version, and a
signature records the version, who signed, and when. Reading this page is not signing it, and no
key is issued until the signature is on file.

Questions: mony.group.corporation@gmail.com
