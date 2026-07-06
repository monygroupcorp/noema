// Injected-wallet (EIP-1193) helper — connect an Ethereum wallet and sign a message.
// This is the app's ONLY browser-wallet touch point: used to prove control of a wallet
// for the account backup/recovery channel (bind in Profile, recover on the login screen).
// No transactions, no chain reads — just eth_requestAccounts + personal_sign.

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
