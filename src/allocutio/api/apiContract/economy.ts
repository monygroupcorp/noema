import type { JsonSchema, RouteSpec } from './types'

export const DepositConfigSchema: JsonSchema = {
  type: 'object',
  description: 'Static config for the buy-credits/deposit UI.',
  properties: {
    depositAddress: { type: 'string', description: 'CreditVault address to send deposits to (same on mainnet + Base).' },
    pointsPerUsd: { type: 'number', description: 'Canonical impetus points per 1 USD (≈ 2967).' },
    defaultFundingRatePct: { type: 'number', description: 'Default funding rate as a percent (70 = 70% of USD value converts to points).' },
    chains: { type: 'array', description: 'Supported chains.', items: { type: 'object', properties: { chainId: { type: 'number' }, name: { type: 'string' } } } },
  },
  required: ['depositAddress', 'pointsPerUsd', 'defaultFundingRatePct', 'chains'],
}

export const DepositQuoteRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Quote how many impetus points a deposit would buy, right now (informational; the on-chain credit is authoritative and equal).',
  properties: {
    chainId: { type: 'string', description: "Chain id ('1' mainnet, '8453' Base)." },
    token: { type: 'string', description: 'Token address; 0x000…000 for native ETH.' },
    amount: { type: 'string', description: 'Deposit amount in RAW base units (wei for ETH, token-decimals for ERC-20), as a string.' },
  },
  required: ['chainId', 'token', 'amount'],
}

export const DepositQuoteResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The points a deposit would be credited (== what the webhook credits for the same input). Gas is NOT deducted.',
  properties: {
    chainId: { type: 'string' },
    token: { type: 'string' },
    amountRaw: { type: 'string', description: 'Echoed raw base units quoted.' },
    grossUsd: { type: 'string', description: 'Gross USD FMV, formatted (e.g. "3.000000").' },
    grossUsdMicro: { type: 'string', description: 'Exact gross USD FMV in micro-USD.' },
    fundingRatePct: { type: 'number', description: 'Per-asset funding rate applied (e.g. 70).' },
    pointsQuoted: { type: 'string', description: 'Impetus points the deposit would be credited.' },
    depositAddress: { type: 'string' },
  },
  required: ['pointsQuoted', 'grossUsd', 'fundingRatePct', 'depositAddress'],
}

export const MyDepositsResponseSchema: JsonSchema = {
  type: 'object',
  description: "The authenticated caller's own on-chain deposits, scoped to their linked wallets — real depositum status for the settle-watch UI.",
  properties: {
    deposits: {
      type: 'array',
      description: 'Newest-first.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          chainId: { type: 'string' },
          txHash: { type: 'string', description: 'On-chain transaction hash.' },
          valor: { type: 'string', description: 'Amount in base units (wei / token-decimals), as a string.' },
          status: { type: 'string', enum: ['detectum', 'confirmatum', 'processatum', 'praesolutum', 'fractum'], description: 'detectum (seen) · confirmatum (confirmed, awaiting/parked credit) · processatum (credited) · praesolutum (settled on the pre-cutover plane — recorded here, never credited here) · fractum (failed).' },
          natum: { type: 'string', format: 'date-time', description: 'When the deposit was first detected.' },
        },
        required: ['id', 'chainId', 'txHash', 'valor', 'status', 'natum'],
      },
    },
  },
  required: ['deposits'],
}

export const CheckoutRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Buy a fixed credit pack with fiat via Stripe Checkout. The pack is server-authoritative: the impetus credited is the pack constant, never a client-supplied figure. Requires an identified account (a card de-anonymizes; an anon purse is rejected).',
  properties: {
    packId: {
      type: 'string',
      enum: ['starter_10', 'standard_25', 'plus_50', 'studio_100'],
      description: 'The credit pack SKU to purchase. Fixed USD price → fixed impetus (starter_10 $10→30,000; standard_25 $25→82,500; plus_50 $50→180,000; studio_100 $100→390,000). No funding haircut.',
    },
    successUrl: { type: 'string', description: 'Optional redirect URL on completed payment; falls back to the server default.' },
    cancelUrl: { type: 'string', description: 'Optional redirect URL on abandoned checkout; falls back to the server default.' },
    allocutio: {
      type: 'string',
      enum: ['telegram', 'web'],
      description: 'Optional: the surface the buyer came from, recorded on the credit for attribution. Never changes the amount; an unknown value is ignored.',
    },
  },
  required: ['packId'],
}

export const CheckoutResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The hosted Stripe Checkout session to redirect the caller to. Credit is applied only later, by the signature-verified webhook, when the payment completes.',
  properties: {
    url: { type: 'string', description: 'The Stripe-hosted checkout URL to redirect the caller to.' },
    sessionId: { type: 'string', description: 'The Stripe Checkout Session id.' },
  },
  required: ['url', 'sessionId'],
}

export const ProMonthlyPlanSchema: JsonSchema = {
  type: 'object',
  description: 'The public Pro Monthly subscription plan (Option B), for display on the pricing page.',
  properties: {
    plan: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        usd: { type: 'number', description: 'Monthly price in whole USD.' },
        creditsPerMonth: { type: 'number', description: 'Display credits granted each cycle (impetus / 10) — parity with the standard_25 pack, not a discount.' },
        rolloverCycles: { type: 'number', description: 'How many cycles of standing allowance (this one plus rolled-over) the fair-use cap permits before a renewal throttles.' },
        label: { type: 'string' },
      },
      required: ['id', 'usd', 'creditsPerMonth', 'rolloverCycles', 'label'],
    },
  },
  required: ['plan'],
}

export const ProMonthlyCheckoutRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Subscribe to Pro Monthly via Stripe Checkout (mode: subscription). Server-priced; requires an identified account (a card de-anonymizes; an anon purse is rejected). The first and every later cycle grant impetus only via the signature-verified webhook, never at checkout time.',
  properties: {
    successUrl: { type: 'string', description: 'Optional redirect URL on completed checkout; falls back to the server default.' },
    cancelUrl: { type: 'string', description: 'Optional redirect URL on abandoned checkout; falls back to the server default.' },
  },
  required: [],
}

export const ProMonthlyCheckoutResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The hosted Stripe Checkout session to redirect the caller to.',
  properties: {
    url: { type: 'string', description: 'The Stripe-hosted checkout URL to redirect the caller to.' },
    sessionId: { type: 'string', description: 'The Stripe Checkout Session id.' },
  },
  required: ['url', 'sessionId'],
}

export const depositPaymentsRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/deposit/config',
      summary: 'Buy-credits/deposit UI config: deposit address, points/USD rate, default funding rate, supported chains.',
      auth: false,
      response: DepositConfigSchema,
    },
    {
      method: 'POST',
      path: '/deposit/quote',
      summary: 'Quote how many impetus points a deposit of a given asset+amount would buy (informational; equals the on-chain credit).',
      auth: false,
      request: DepositQuoteRequestSchema,
      response: DepositQuoteResponseSchema,
    },
    {
      method: 'GET',
      path: '/deposit/mine',
      summary: "The authenticated caller's own deposits, scoped to their linked wallets — real depositum status (confirmatum/processatum) for the settle-watch UI.",
      auth: true,
      response: MyDepositsResponseSchema,
    },
    {
      method: 'POST',
      path: '/payments/checkout',
      summary: 'Buy a fixed credit pack with fiat: create a Stripe Checkout session for the chosen pack and return the hosted-checkout URL. Requires an identified account; the impetus credited is the server-side pack constant, applied later by the signature-verified webhook on payment completion.',
      auth: true,
      request: CheckoutRequestSchema,
      response: CheckoutResponseSchema,
    },
    {
      method: 'GET',
      path: '/payments/promonthly',
      summary: 'The public Pro Monthly subscription plan (Option B) for display on the pricing page.',
      auth: false,
      response: ProMonthlyPlanSchema,
    },
    {
      method: 'POST',
      path: '/payments/promonthly/checkout',
      summary: 'Subscribe to Pro Monthly: create a Stripe Checkout session (mode: subscription) and return the hosted-checkout URL. Requires an identified account; impetus is granted each cycle only by the signature-verified webhook, never at checkout time.',
      auth: true,
      request: ProMonthlyCheckoutRequestSchema,
      response: ProMonthlyCheckoutResponseSchema,
    },
]
