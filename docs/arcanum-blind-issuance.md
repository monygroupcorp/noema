# Arcanum Blind Issuance — Spec

**Status:** Specced, not yet implemented  
**Depends on:** Arcanum ZK system (done), CreditVault upgrade

---

## What this is

An extension to the CreditVault contract and the platform backend that allows
a user to obtain an anonymous Arcanum note without the platform ever knowing
who obtained it. The user deposits ETH or ERC20 directly against a commitment —
the platform sees only the commitment and the amount, never the wallet address.

This closes the last identifiability gap in the anonymous credit system.

---

## What changes

Three layers:

1. **CreditVault contract** — two new functions + one new event
2. **EventWebhookProcessor** — new handler for `AnonymousDeposit`
3. **ArcanumRouter** — one new endpoint so the client can find their leaf

---

## Layer 1 — CreditVault contract changes

The contract is a UUPS upgradeable proxy. This is an upgrade — same address,
no redeployment, no migration of existing data needed.

### New functions

```solidity
// Anonymous ETH deposit — no payer in the event
function payETHAnonymous(bytes32 commitment) external payable {
    require(msg.value > 0, "CreditVault: zero value");
    emit AnonymousDeposit(commitment, ETH, msg.value);
}

// Anonymous ERC20 deposit — no payer in the event
function payAnonymous(
    address token,
    uint256 amount,
    bytes32 commitment
) external {
    require(amount > 0, "CreditVault: zero amount");
    SafeTransferLib.safeTransferFrom(token, msg.sender, address(this), amount);
    emit AnonymousDeposit(commitment, token, amount);
}
```

### New event

```solidity
event AnonymousDeposit(
    bytes32 indexed commitment,
    address         token,
    uint256         amount
);
```

**No `payer` field.** `msg.sender` is in the transaction calldata on-chain, but
the platform's event processor deliberately ignores it. The platform's internal
database records `{ commitment, token, amount }` — no wallet address, no animaId.

### What ETH is

`ETH` is the sentinel address already used in the existing `Payment` event:
`address(0xEeeee...)` or `address(0)` — match whatever the current contract uses.

### No referral key

Anonymous deposits have no referral path. Including a referral key would link
the commitment to a referral identity — defeating the purpose. The full payment
goes to protocol with no split.

### Commitment encoding

The commitment from Poseidon is a BN128 field element (< 254 bits). It fits in
32 bytes. On the TypeScript client, encode it as:

```typescript
const commitmentHex = '0x' + BigInt(commitment).toString(16).padStart(64, '0')
// pass as bytes32 to the contract
```

---

## Layer 2 — Backend: EventWebhookProcessor

### New event handler in `processWebhook()`

```javascript
const anonymousDepositFragment = this.ethereumService.getEventFragment(
  'AnonymousDeposit', this.contractConfig.abi
)
const anonymousDepositHash = anonymousDepositFragment
  ? this.ethereumService.getEventTopic(anonymousDepositFragment)
  : null

// In the log-processing loop:
} else if (anonymousDepositHash && topics[0] === anonymousDepositHash) {
  const decoded = this.ethereumService.decodeEventLog(
    anonymousDepositFragment, data, topics, this.contractConfig.abi
  )
  await this.depositProcessorService.processAnonymousDepositEvent(
    decoded, normalizedTxHash, parentBlockNumber, logIndex
  )
}
```

### New `processAnonymousDepositEvent()` on DepositProcessorService

```javascript
async processAnonymousDepositEvent(decodedLog, transactionHash, blockNumber, logIndex) {
  const { commitment, token, amount } = decodedLog

  // Idempotency: commitment is the dedup key
  const existing = await this.arcanumTree.findLeaf(commitment)
  if (existing) {
    this.logger.debug(`[AnonymousDeposit] Commitment already in tree — skipping ${transactionHash}`)
    return
  }

  // Convert raw token amount → credit valor (same pricing as identified deposits)
  const valor = await this._tokenAmountToValor(token, amount)
  if (valor <= 0n) {
    this.logger.warn(`[AnonymousDeposit] Valor resolved to zero for tx ${transactionHash} — skipping`)
    return
  }

  // Insert into Merkle tree — NO animaId, NO signum, NO ledger entry
  await this.arcanumTree.insert(commitment, valor)

  this.logger.info(`[AnonymousDeposit] Commitment inserted into tree`, {
    commitment, valor: valor.toString(), tx: transactionHash
  })
}
```

**Key property:** no call to `_resolveUserAccount()`, no call to `creditLedgerDb`,
no animaId created or looked up. The only write is `arcanumTree.insert()`.

### `_tokenAmountToValor(token, amount)`

Reuse the existing pricing logic from `_confirmFromLivePricing()`. Same token
→ USD conversion, same USD → credits conversion rate. The output is a `bigint`
denominated in the platform's credit unit (same as `Signum.valor`).

This method should be extracted as a shared helper so both paths use identical
pricing — no discount or premium for anonymous deposits.

### Dependency injection

`DepositProcessorService` needs `arcanumTree: ArcanumTreeStore` added to its
constructor. Pass `ring.arcanumTree` when wiring the service in `index.ts` or
the server setup.

---

## Layer 3 — ArcanumRouter: new endpoint

The client needs to find their `leafIndex` after the deposit lands in the tree.
They know their commitment (they generated it), but the tree's leafIndex is
assigned server-side.

```typescript
// GET /arcanum/tree/leaf/:commitment
// Returns the leaf record for a commitment, or 404 if not yet in the tree.
// Client polls this after the on-chain deposit until the leaf appears.

router.get('/tree/leaf/:commitment', async (req, res) => {
  try {
    const leaf = await arcanumTree.findLeaf(req.params.commitment)
    if (!leaf) return res.status(404).json({ error: 'commitment not yet in tree' })
    return res.json({ leaf })  // { commitment, leafIndex, valor, insertedAt }
  } catch (err) {
    console.error('[arcanumRouter] findLeaf error:', err)
    return res.status(500).json({ error: 'internal error' })
  }
})
```

---

## ABI update

Add to `creditVault.json`:

```json
{
  "type": "function",
  "name": "payETHAnonymous",
  "inputs": [{ "name": "commitment", "type": "bytes32", "internalType": "bytes32" }],
  "outputs": [],
  "stateMutability": "payable"
},
{
  "type": "function",
  "name": "payAnonymous",
  "inputs": [
    { "name": "token",      "type": "address", "internalType": "address"  },
    { "name": "amount",     "type": "uint256", "internalType": "uint256"  },
    { "name": "commitment", "type": "bytes32", "internalType": "bytes32"  }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
},
{
  "type": "event",
  "name": "AnonymousDeposit",
  "inputs": [
    { "name": "commitment", "type": "bytes32", "indexed": true,  "internalType": "bytes32" },
    { "name": "token",      "type": "address", "indexed": false, "internalType": "address" },
    { "name": "amount",     "type": "uint256", "indexed": false, "internalType": "uint256" }
  ],
  "anonymous": false
}
```

---

## Alchemy webhook config

The existing Alchemy webhook is configured to listen for logs from the
CreditVault address. It will automatically pick up `AnonymousDeposit` events
as soon as the contract is upgraded and the ABI is updated — no webhook
reconfiguration needed.

---

## Complete client flow

```
1. CLIENT  generates (nullifier, secret) locally using circomlibjs
           computes commitment = poseidon(nullifier, secret)
           stores (nullifier, secret, commitment) — never transmitted

2. CLIENT  calls payETHAnonymous(bytes32(commitment)) with msg.value
           on CreditVault (same address, Mainnet or Base)

3. CONTRACT emits AnonymousDeposit(commitment, ETH, amount)
            — no payer in the log

4. PLATFORM Alchemy webhook fires → EventWebhookProcessor routes to
            processAnonymousDepositEvent → arcanumTree.insert(commitment, valor)

5. CLIENT  polls GET /arcanum/tree/leaf/:commitment until 200
           receives { leafIndex, valor, insertedAt }

6. CLIENT  calls GET /arcanum/tree/proof/:leafIndex
           receives current { root, pathElements, pathIndices }

7. CLIENT  generates Groth16 proof locally (WASM)
           using (nullifier, secret, pathElements, pathIndices) as private inputs
           and (root, nullifierHash, valor, recipient) as public signals

8. CLIENT  calls inceptor with { arcanumProof }
           platform verifies proof, creates actum
           nullifierHash recorded — note is spent, cannot replay
```

---

## Privacy model with blind issuance

| Layer | Platform knows | Platform cannot link to |
|-------|---------------|------------------------|
| On-chain deposit | commitment, token, amount | wallet address (deliberately not captured), animaId |
| Merkle tree | commitment, leafIndex, valor | any identity |
| Spend | nullifierHash, valor, root, recipient | commitment, wallet, animaId |

**Residual on-chain visibility:** Any chain observer CAN see `msg.sender` in
the transaction. This is a property of EVM, not of this system. If the user
wants full unlinkability even from chain observers, they use a fresh wallet
(no prior transaction history connecting it to their identity). The platform
itself provides no additional linkage beyond what's already on-chain.

**Compared to identified issuance:** With identified issuance, the platform has
an internal record: "animaId X converted at time T." With blind issuance, that
record does not exist. Even with full access to the platform's database, an
adversary cannot determine who obtained which note.

---

## What doesn't change

- The ZK circuit (`arcanum.circom`) — unchanged. Blind issuance produces the
  same kind of note, proved the same way.
- The spend path — identical. `arcanumVerifier.verify()` doesn't care how the
  note was issued.
- The Merkle tree — one tree, one anonymity set. Blind-issued notes and
  identified-issued notes sit in the same tree. This is intentional — a larger
  anonymity set is better for everyone.
- The trusted setup ceremony — the same verification key covers both paths.

---

## Implementation order

1. Write and test `payETHAnonymous` / `payAnonymous` in Solidity
2. Update `creditVault.json` ABI
3. Add `processAnonymousDepositEvent` to `DepositProcessorService`
   (wire `arcanumTree` into its constructor)
4. Add `AnonymousDeposit` handler to `EventWebhookProcessor`
5. Add `GET /arcanum/tree/leaf/:commitment` to `arcanumRouter.ts`
6. Deploy contract upgrade (UUPS — same address)
7. Test against Sepolia with a fresh wallet

No new collections, no schema changes, no index changes needed.
The `arcanum_leaves` collection already exists and is already indexed on `commitment`.
