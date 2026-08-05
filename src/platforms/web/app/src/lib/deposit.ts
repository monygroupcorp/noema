// Build (and send) the CreditVault ETH deposit transaction. Mainnet-only, ETH-only v1 —
// no ERC-20 / approve path (see noema-007). No custody change: the tx is built here and
// signed/sent by the user's own wallet via wallet.ts.

import { encodeFunctionData, keccak256, toBytes, zeroHash, type Hex } from 'viem';
import {
  getChainId,
  sendTransaction,
  switchChain,
  waitForReceipt,
  type EthTxRequest,
  type TxReceipt,
} from './wallet';

/** CreditVault contract address (mainnet). */
export const VAULT: Hex = '0x00000001152d633eb2ac3cf91eac9994aeefc021';

/** Mainnet chain id (decimal) and its hex form for `wallet_switchEthereumChain`. */
export const MAINNET_CHAIN_ID = 1;
const MAINNET_CHAIN_ID_HEX = '0x1';

/** `pay(bytes32 referralKey) payable` — the only CreditVault entrypoint this app uses. */
export const PAY_ABI = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'payable',
    inputs: [{ name: 'referralKey', type: 'bytes32' }],
    outputs: [],
  },
] as const;

export interface BuildEthDepositTxArgs {
  /** Deposit amount in wei. */
  amountWei: bigint;
  /** Optional referral code; hashed with keccak256 to derive `referralKey`. Defaults to ZeroHash. */
  referralCode?: string;
}

export interface EthDepositTx {
  to: Hex;
  data: Hex;
  value: bigint;
}

/** Build the calldata + value for a CreditVault ETH deposit. Does not send anything. */
export function buildEthDepositTx({ amountWei, referralCode }: BuildEthDepositTxArgs): EthDepositTx {
  const referralKey: Hex = referralCode ? keccak256(toBytes(referralCode)) : zeroHash;
  const data = encodeFunctionData({ abi: PAY_ABI, functionName: 'pay', args: [referralKey] });
  return { to: VAULT, data, value: amountWei };
}

/**
 * Guard against sending on the wrong chain: assert mainnet, or request a switch, or throw.
 * Never sends a transaction on the wrong chain.
 */
async function ensureMainnet(): Promise<void> {
  const chainId = await getChainId();
  if (chainId === MAINNET_CHAIN_ID) return;
  try {
    await switchChain(MAINNET_CHAIN_ID_HEX);
  } catch (err) {
    throw new Error(
      `Wrong network (chain ${chainId}) and could not switch to mainnet: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  const after = await getChainId();
  if (after !== MAINNET_CHAIN_ID) {
    throw new Error(`Wrong network (chain ${after}) after switch attempt; refusing to send.`);
  }
}

/** Build, chain-guard, and send the CreditVault ETH deposit tx from `from`. Returns the tx hash. */
export async function sendEthDeposit(from: string, args: BuildEthDepositTxArgs): Promise<string> {
  await ensureMainnet();
  const { to, data, value } = buildEthDepositTx(args);
  const tx: EthTxRequest = { from, to, value: '0x' + value.toString(16), data };
  return sendTransaction(tx);
}

/** Send the deposit and wait for its receipt. See `wallet.waitForReceipt` for timing. */
export async function sendEthDepositAndWait(
  from: string,
  args: BuildEthDepositTxArgs,
): Promise<TxReceipt> {
  const hash = await sendEthDeposit(from, args);
  return waitForReceipt(hash);
}
