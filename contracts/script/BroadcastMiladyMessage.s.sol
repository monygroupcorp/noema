// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {MiladyMessage} from "src/MiladyMessage.sol";

/// @notice Deploys MiladyMessage and broadcasts to every address in
/// owners.json, in batches (one owner per Milady holder, deduped).
///
/// Usage (Sepolia):
///   forge script script/BroadcastMiladyMessage.s.sol \
///     --fork-url $TEST_RPC_URL --broadcast --account <keystore-name> -vvvv
///
/// Environment variables:
///   OWNERS_JSON  – path to owners.json (default: path produced by
///                  scripts/milady-sepolia-message/fetch-owners.mjs,
///                  relative to this contracts/ directory)
///   BATCH_SIZE   – owners per broadcast() call (default 500)
contract BroadcastMiladyMessage is Script {
    function run() external {
        string memory ownersPath =
            vm.envOr("OWNERS_JSON", string("../scripts/milady-sepolia-message/owners.json"));
        uint256 batchSize = vm.envOr("BATCH_SIZE", uint256(500));

        string memory json = vm.readFile(ownersPath);
        address[] memory owners = vm.parseJsonAddressArray(json, ".uniqueOwnerAddresses");
        console2.log("owners to message:", owners.length);

        vm.startBroadcast();
        MiladyMessage target = new MiladyMessage();
        console2.log("MiladyMessage deployed at:", address(target));

        for (uint256 i = 0; i < owners.length; i += batchSize) {
            uint256 end = i + batchSize;
            if (end > owners.length) end = owners.length;
            address[] memory batch = new address[](end - i);
            for (uint256 j = i; j < end; j++) {
                batch[j - i] = owners[j];
            }
            target.broadcast(batch);
            console2.log("broadcast batch", i, end);
        }
        vm.stopBroadcast();
    }
}
