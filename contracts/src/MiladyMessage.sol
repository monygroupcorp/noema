// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Broadcasts a fixed message to a list of addresses via on-chain
/// events, never by sending value or calldata directly to those addresses.
/// A direct send (plain ETH transfer with the message as calldata) would
/// revert against any recipient that is a contract with no matching
/// function and no payable fallback — many NFT owner addresses are
/// marketplace/custody contracts, not EOAs. Logging an event keyed on the
/// owner's address instead means the broadcast never reverts on their
/// account, and the owner (or anyone) can still find it by searching their
/// address on a block explorer.
contract MiladyMessage {
    string public constant MESSAGE = "try this. It was made for you";
    address public immutable sender;

    event MiladyMessageSent(address indexed owner);

    error NotSender();

    constructor() {
        sender = msg.sender;
    }

    function broadcast(address[] calldata owners) external {
        if (msg.sender != sender) revert NotSender();
        for (uint256 i = 0; i < owners.length; i++) {
            emit MiladyMessageSent(owners[i]);
        }
    }
}
