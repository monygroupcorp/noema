// Injected-wallet (EIP-1193) helper — connect an Ethereum wallet, sign a message, and
// (as of noema-007) send a raw transaction from the user's own wallet (no custody change).
// Used for the account backup/recovery channel (bind in Profile, recover on the login
// screen) and for sending the CreditVault ETH deposit tx (see deposit.ts).

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injected(): Eip1193Provider | null {
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

export function hasWallet(): boolean {
  return injected() != null;
}

export interface ConnectedWallet {
  address: string;
  /** Sign `message` (EIP-191 personal_sign) with the connected account. */
  signMessage(message: string): Promise<string>;
}

// Prompt the user to connect a wallet and return the selected account + a signer.
export async function connectWallet(): Promise<ConnectedWallet> {
  const eth = injected();
  if (!eth) throw new Error('No Ethereum wallet found. Install MetaMask (or another wallet) to use this.');
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error('No wallet account was selected.');
  return {
    address,
    signMessage: (message: string) =>
      eth.request({ method: 'personal_sign', params: [message, address] }) as Promise<string>,
  };
}

/** Raw EIP-1193 transaction request shape (all fields hex-encoded per the JSON-RPC spec). */
export interface EthTxRequest {
  from: string;
  to: string;
  value?: string;
  data?: string;
}

/** Current chain id, decimal (e.g. `1` for mainnet). */
export async function getChainId(): Promise<number> {
  const eth = injected();
  if (!eth) throw new Error('No Ethereum wallet found.');
  const hex = (await eth.request({ method: 'eth_chainId' })) as string;
  return parseInt(hex, 16);
}

/** Ask the wallet to switch to `chainIdHex` (e.g. `'0x1'` for mainnet). Throws if it can't/won't. */
export async function switchChain(chainIdHex: string): Promise<void> {
  const eth = injected();
  if (!eth) throw new Error('No Ethereum wallet found.');
  await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
}

/** Submit `tx` via `eth_sendTransaction`. Returns the transaction hash. */
export async function sendTransaction(tx: EthTxRequest): Promise<string> {
  const eth = injected();
  if (!eth) throw new Error('No Ethereum wallet found.');
  return (await eth.request({ method: 'eth_sendTransaction', params: [tx] })) as string;
}

export interface TxReceipt {
  status: string;
  blockNumber: string;
  [key: string]: unknown;
}

/**
 * Poll `eth_getTransactionReceipt` until the tx is mined (or `maxMs` elapses).
 * Timing ported from the legacy sandbox's BuyPointsModal `_waitForConfirmation`
 * (120s max, 2s poll). Throws on revert or timeout.
 */
export async function waitForReceipt(
  hash: string,
  maxMs = 120_000,
  pollMs = 2_000,
): Promise<TxReceipt> {
  const eth = injected();
  if (!eth) throw new Error('No Ethereum wallet found.');
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const receipt = (await eth.request({
        method: 'eth_getTransactionReceipt',
        params: [hash],
      })) as TxReceipt | null;
      if (receipt && receipt.blockNumber) {
        if (parseInt(receipt.status, 16) === 0) throw new Error('Transaction reverted on-chain');
        return receipt;
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Transaction reverted on-chain') throw err;
      console.warn('[wallet] receipt poll error:', err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Confirmation timeout after ${maxMs / 1000}s`);
}
