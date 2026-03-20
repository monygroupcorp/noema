# Referral System

NOEMA's referral program lets you earn passive income by inviting new users. Register a human-readable name on-chain, share your link, and earn a percentage of every deposit made using your referral code — paid directly to your wallet in the same transaction.

---

## How It Works

Your referral code is registered on the **CreditVault** smart contract. When someone makes a deposit using your code, the contract automatically splits the payment: the protocol receives the majority, and your share is transferred directly to your wallet. No withdrawal step, no delays — it's trustless and instant.

The referral split is configured in basis points (bps) on-chain. The default is set by the protocol and applies to all new registrations.

| Platform | How to Share | Referral Split |
|----------|-------------|----------------|
| Web | `noema.art/ref/<your-code>` | On-chain split via `payETH(referralKey)` — full referral rewards |
| Telegram | Reply with your code during `/buypoints` | Code is recognized; on-chain split requires web purchase |

---

## Registering a Referral Code

### Via the Web App

1. Navigate to the referral section in your account
2. Choose a unique name (4+ characters, alphanumeric with dashes/underscores)
3. Confirm the on-chain `register(name)` transaction from your wallet
4. Your name is now permanently registered — share `noema.art/ref/<name>`

### Via the API

1. **Check availability:**
   ```
   GET /api/v1/referral-vault/check-name?name=alice&chainId=1
   ```
   Returns `{ name, referralKey, isAvailable }`.

2. **Get registration calldata:**
   ```
   POST /api/v1/referral-vault/register
   { "name": "alice", "userWalletAddress": "0x...", "chainId": "1" }
   ```
   Returns unsigned transaction data for your wallet to submit.

---

## Tracking Earnings

### Dashboard API

```
GET /api/v1/referral-vault/alice/dashboard
```

Returns:
- Total referral volume and rewards (cumulative wei)
- Per-token breakdown with deposit counts
- Current USD valuations

### My Vaults

```
GET /api/v1/referral-vault/my-vaults
```

Returns all referral codes registered to your account (requires authentication).

---

## Smart Contract Details

All referral operations happen on the **CreditVault** contract:

```
CreditVault — 0x00000001152D633eb2AC3Cf91eac9994aEEFc021 (Ethereum Mainnet, Base)
```

- **`register(name)`** — Claims a referral name. Computes `referralKey = keccak256(name)` and stores `referralOwner[key] = msg.sender`.
- **`pay(token, amount, referralKey)`** / **`payETH(referralKey)`** — Splits payment: `referralAmount = amount * referralBps / 10000` goes to the referrer, remainder to the protocol.
- **`setAddress(key, newAddress)`** — Change where your referral earnings are sent (owner only).
- **`transferName(key, newOwner)`** — Transfer ownership of a referral name.

The referral split, payout address, and ownership are all on-chain and verifiable by anyone.

---

## How Referral Links Work

When someone visits `noema.art/ref/alice`:
1. The referral code is stored in a browser cookie (90-day TTL)
2. On login, the code is saved as a user preference
3. On purchase, the code is converted to `referralKey = keccak256("alice")` and encoded into the deposit transaction calldata
4. The CreditVault contract splits the payment on-chain

---

## Limitations

- **Direct ETH transfers** (e.g., from Telegram) cannot include a referral key. Referral splits only apply to deposits made through `pay()` or `payETH()` on the web app.
- **Names are per-chain** — a name registered on Ethereum Mainnet is independent from Base.
- **Names are permanent** — once registered, a name cannot be deleted (only transferred).
