// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {OwnableRoles} from "solady/auth/OwnableRoles.sol";
import {UUPSUpgradeable} from "solady/utils/UUPSUpgradeable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

interface IERC1155 {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

contract CreditVault is OwnableRoles, UUPSUpgradeable, Initializable, ReentrancyGuard {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @dev Sentinel address representing ETH in balance mappings.
    address public constant ETH = address(0);

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    // @dev DEPRECATED — on-chain referral payouts were removed (tax-liability
    //      surface; rewards now pay spend-only internal credits off-chain). These
    //      four slots are retained UNCHANGED to preserve the UUPS storage layout of
    //      the live proxy — do not reorder, repurpose, or delete them. They are no
    //      longer written or read by any function.
    mapping(bytes32 => address) private __deprecated_referralOwner;
    mapping(bytes32 => address) private __deprecated_referralAddress;
    mapping(bytes32 => uint16)  private __deprecated_referralBps;
    uint16                      private __deprecated_defaultReferralBps;

    /// @dev commitment => already deposited. Prevents front-running: a second payAnonymous
    ///      with the same commitment would otherwise lock the second depositor's funds forever
    ///      (the webhook idempotency check skips the second leaf insertion).
    mapping(bytes32 => bool) public usedCommitments;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        _disableInitializers();
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @dev Emitted on every identified deposit. The on-chain referral cut was
    ///      removed, so `referralAmount` is always 0 and `protocolAmount == amount`.
    ///      `referralKey` is retained as an inert attribution tag: the backend uses
    ///      it to credit the referrer with spend-only internal credits off-chain.
    ///      Fields kept stable for ABI/decoder compatibility.
    event Payment(
        address indexed payer,
        bytes32 indexed referralKey,
        address token,
        uint256 amount,
        uint256 protocolAmount,
        uint256 referralAmount
    );

    /// @dev Anonymous deposit — no payer recorded. commitment is a Poseidon field element.
    event AnonymousDeposit(
        bytes32 indexed commitment,
        address         token,
        uint256         amount
    );

    event NFTReceived(address indexed from, address indexed token, uint256 tokenId);
    event ERC1155TokenReceived(address indexed from, address indexed token, uint256 id, uint256 amount);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAmount();
    error TransferFailed();
    error ZeroAddress();
    error CommitmentAlreadyUsed();

    // -------------------------------------------------------------------------
    // Initializer
    // -------------------------------------------------------------------------

    function initialize(address _owner) external initializer {
        _initializeOwner(_owner);
    }

    function _guardInitializeOwner() internal pure override returns (bool) {
        return true;
    }

    // -------------------------------------------------------------------------
    // Payments
    // -------------------------------------------------------------------------

    receive() external payable nonReentrant {
        _processPayment(msg.sender, ETH, msg.value, bytes32(0));
    }

    /// @notice Identified ETH deposit. `referralKey` is an optional attribution tag
    ///         (bytes32(0) for none) echoed in the Payment event; it moves no funds
    ///         on-chain — referral rewards are issued off-chain as internal credits.
    function pay(bytes32 referralKey) external payable nonReentrant {
        _processPayment(msg.sender, ETH, msg.value, referralKey);
    }

    /// @notice Identified ERC20 deposit. `referralKey` is an optional attribution tag
    ///         (bytes32(0) for none) echoed in the Payment event; it moves no funds
    ///         on-chain — referral rewards are issued off-chain as internal credits.
    function payCoin(address token, uint256 amount, bytes32 referralKey)
        external nonReentrant
    {
        SafeTransferLib.safeTransferFrom(token, msg.sender, address(this), amount);
        _processPayment(msg.sender, token, amount, referralKey);
    }

    /// @notice Anonymous ETH deposit. commitment is poseidon(nullifier, secret).
    ///         No payer is recorded — the platform sees only commitment + amount.
    function payAnonymous(bytes32 commitment) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (usedCommitments[commitment]) revert CommitmentAlreadyUsed();
        usedCommitments[commitment] = true;
        emit AnonymousDeposit(commitment, ETH, msg.value);
    }

    /// @notice Anonymous ERC20 deposit. commitment is poseidon(nullifier, secret).
    ///         No payer is recorded — the platform sees only commitment + amount.
    function payCoinAnonymous(address token, uint256 amount, bytes32 commitment)
        external nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (usedCommitments[commitment]) revert CommitmentAlreadyUsed();
        SafeTransferLib.safeTransferFrom(token, msg.sender, address(this), amount);
        usedCommitments[commitment] = true;
        emit AnonymousDeposit(commitment, token, amount);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function withdrawProtocol(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == ETH) {
            SafeTransferLib.safeTransferETH(to, amount);
        } else {
            SafeTransferLib.safeTransfer(token, to, amount);
        }
    }

    function withdrawNFT(address token, uint256 tokenId, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        SafeTransferLib.safeTransferFrom(token, address(this), to, tokenId);
    }

    function withdrawERC1155(address token, uint256 tokenId, uint256 amount, address to)
        external onlyOwner
    {
        if (to == address(0)) revert ZeroAddress();
        IERC1155(token).safeTransferFrom(address(this), to, tokenId, amount, "");
    }

    // -------------------------------------------------------------------------
    // NFT Receivers
    // -------------------------------------------------------------------------

    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external returns (bytes4)
    {
        emit NFTReceived(from, msg.sender, tokenId);
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address from, uint256 id, uint256 amount, bytes calldata)
        external returns (bytes4)
    {
        emit ERC1155TokenReceived(from, msg.sender, id, amount);
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address from, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata)
        external returns (bytes4)
    {
        for (uint256 i; i < ids.length; i++) {
            emit ERC1155TokenReceived(from, msg.sender, ids[i], amounts[i]);
        }
        return this.onERC1155BatchReceived.selector;
    }

    // -------------------------------------------------------------------------
    // Multicall
    // -------------------------------------------------------------------------

    /// @notice Batch multiple calls in a single transaction via delegatecall.
    function multicall(bytes[] calldata data) external onlyOwner returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i; i < data.length; i++) {
            (bool ok, bytes memory result) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly { revert(add(result, 0x20), mload(result)) }
            }
            results[i] = result;
        }
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _processPayment(address payer, address token, uint256 amount, bytes32 referralKey) internal {
        if (amount == 0) revert ZeroAmount();

        // No on-chain referral cut is taken — the full deposit is retained by the
        // protocol. Any referral reward is issued off-chain as spend-only internal
        // credits, keyed off `referralKey` in this event.
        emit Payment(payer, referralKey, token, amount, amount, 0);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
