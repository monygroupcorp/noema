import { describe, expect, it } from 'vitest';
import { encodeFunctionData, toFunctionSelector, zeroHash } from 'viem';
import { buildEthDepositTx, PAY_ABI, VAULT } from './deposit';

describe('buildEthDepositTx', () => {
  it('targets the CreditVault address', () => {
    const tx = buildEthDepositTx({ amountWei: 1_000_000_000_000_000_000n });
    expect(tx.to).toBe(VAULT);
  });

  it('encodes pay(bytes32) with the ZeroHash referral key by default', () => {
    const tx = buildEthDepositTx({ amountWei: 1n });
    const expected = encodeFunctionData({ abi: PAY_ABI, functionName: 'pay', args: [zeroHash] });
    expect(tx.data).toBe(expected);
    expect(tx.data.slice(0, 10)).toBe(toFunctionSelector('pay(bytes32)'));
  });

  it('carries the exact amountWei as value', () => {
    const amountWei = 123_456_789n;
    const tx = buildEthDepositTx({ amountWei });
    expect(tx.value).toBe(amountWei);
  });
});
