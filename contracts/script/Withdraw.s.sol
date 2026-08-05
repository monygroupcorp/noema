// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {CreditVault} from "src/CreditVault.sol";

/// @notice Withdraw ETH or ERC20 from the live CreditVault proxy.
///
/// Usage — ETH:
///   forge script script/Withdraw.s.sol \
///     --rpc-url $RPC_URL --broadcast \
///     --sig "run(address,address,uint256)" \
///     0x0000000000000000000000000000000000000000 \
///     <to>  \
///     <amount_wei>
///
/// Usage — ERC20:
///   forge script script/Withdraw.s.sol \
///     --rpc-url $RPC_URL --broadcast \
///     --sig "run(address,address,uint256)" \
///     <token>  <to>  <amount>
///
/// Required env vars:
///   PRIVATE_KEY  — owner key

contract Withdraw is Script {
    address constant PROXY = 0x00000001152D633eb2AC3Cf91eac9994aEEFc021;

    function run(address token, address to, uint256 amount) external {
        address currentOwner = CreditVault(payable(PROXY)).owner();
        console.log("Proxy:          ", PROXY);
        console.log("Vault owner:    ", currentOwner);
        console.log("Withdrawing to: ", to);
        console.log("Token (0=ETH):  ", token);
        console.log("Amount (wei):   ", amount);

        // Uses --account keystore from the forge CLI. The contract enforces onlyOwner.
        vm.startBroadcast();
        CreditVault(payable(PROXY)).withdrawProtocol(token, to, amount);
        vm.stopBroadcast();

        console.log("Done.");
    }
}
