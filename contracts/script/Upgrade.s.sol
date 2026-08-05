// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {CreditVault} from "src/CreditVault.sol";

/// @notice Deploy a new CreditVault implementation and upgrade the live proxy.
///
/// Usage:
///   # Dry run (no broadcast)
///   forge script script/Upgrade.s.sol --rpc-url $RPC_URL
///
///   # Live upgrade — mainnet
///   forge script script/Upgrade.s.sol --rpc-url $RPC_URL --broadcast --verify
///
///   # Live upgrade — Base
///   forge script script/Upgrade.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
///
/// Required env vars:
///   PRIVATE_KEY   — deployer private key (must be the proxy owner)
///   RPC_URL       — node RPC endpoint
///
/// The proxy address is hardcoded — same address on Mainnet and Base.

contract Upgrade is Script {
    address constant PROXY = 0x00000001152D633eb2AC3Cf91eac9994aEEFc021;

    function run() external {
        // Pre-flight: log owner so operator can confirm key matches before broadcast.
        address currentOwner = CreditVault(payable(PROXY)).owner();
        console.log("Upgrading CreditVault proxy:", PROXY);
        console.log("Vault owner (your key must match):", currentOwner);

        // Uses --account keystore from the forge CLI. upgradeToAndCall reverts if not owner.
        vm.startBroadcast();

        // 1. Deploy new implementation (constructor calls _disableInitializers).
        CreditVault newImpl = new CreditVault();
        console.log("New implementation deployed:", address(newImpl));

        // 2. Upgrade proxy to new implementation.
        //    upgradeToAndCall with empty calldata — no re-initialization needed.
        CreditVault(payable(PROXY)).upgradeToAndCall(address(newImpl), "");
        console.log("Proxy upgraded.");

        vm.stopBroadcast();
    }
}
