// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CreditVault} from "src/CreditVault.sol";
import {TestToken} from "test/mocks/TestToken.sol";
import {MockERC721} from "test/mocks/MockERC721.sol";
import {ReentrancyAttackerV2} from "test/mocks/ReentrancyAttackerV2.sol";
import {MockERC1155} from "test/mocks/MockERC1155.sol";
import {LibClone} from "solady/utils/LibClone.sol";

contract CreditVaultTest is Test {
    CreditVault vault;
    address owner = address(0xA11CE);
    address alice = address(0xA11CE1);
    address bob   = address(0xB0B);

    TestToken token;
    MockERC721 nft;
    MockERC1155 erc1155;

    function setUp() public {
        CreditVault impl = new CreditVault();
        // Deploy through an ERC1967 proxy so _disableInitializers() on the impl is respected.
        address proxy = LibClone.deployERC1967(address(impl));
        vault = CreditVault(payable(proxy));
        vault.initialize(owner);

        token = new TestToken();
        token.transfer(alice, 1000e18);
        token.transfer(bob, 1000e18);

        nft = new MockERC721();
        nft.mint(alice, 1);
        nft.mint(alice, 2);

        erc1155 = new MockERC1155();
        erc1155.mint(alice, 1, 10);
    }

    // =========================================================================
    // register
    // =========================================================================

    function test_register_claimsName() public {
        vm.prank(alice);
        vault.register("alice");
        bytes32 key = keccak256("alice");
        assertEq(vault.referralOwner(key), alice);
        assertEq(vault.referralAddress(key), alice);
    }

    function test_register_emitsEvent() public {
        bytes32 key = keccak256("alice");
        vm.expectEmit(true, false, false, true);
        emit CreditVault.ReferralRegistered(key, "alice", alice);
        vm.prank(alice);
        vault.register("alice");
    }

    function test_register_revertsIfTaken() public {
        vm.prank(alice);
        vault.register("alice");
        vm.prank(bob);
        vm.expectRevert(CreditVault.AlreadyRegistered.selector);
        vault.register("alice");
    }

    // =========================================================================
    // setAddress
    // =========================================================================

    function test_setAddress_updatesPayoutAddress() public {
        vm.prank(alice);
        vault.register("alice");
        bytes32 key = keccak256("alice");

        vm.prank(alice);
        vault.setAddress(key, bob);
        assertEq(vault.referralAddress(key), bob);
    }

    function test_setAddress_revertsIfNotOwner() public {
        vm.prank(alice);
        vault.register("alice");
        bytes32 key = keccak256("alice");

        vm.prank(bob);
        vm.expectRevert(CreditVault.NotReferralOwner.selector);
        vault.setAddress(key, bob);
    }

    // =========================================================================
    // transferName
    // =========================================================================

    function test_transferName_changesOwner() public {
        vm.prank(alice);
        vault.register("alice");
        bytes32 key = keccak256("alice");

        vm.prank(alice);
        vault.transferName(key, bob);
        assertEq(vault.referralOwner(key), bob);
    }

    function test_transferName_revertsIfNotOwner() public {
        vm.prank(alice);
        vault.register("alice");
        bytes32 key = keccak256("alice");

        vm.prank(bob);
        vm.expectRevert(CreditVault.NotReferralOwner.selector);
        vault.transferName(key, bob);
    }

    function test_transferName_revertsIfZeroAddress() public {
        vm.prank(alice);
        vault.register("alice");
        bytes32 key = keccak256("alice");

        vm.prank(alice);
        vm.expectRevert(CreditVault.ZeroAddress.selector);
        vault.transferName(key, address(0));
    }

    // =========================================================================
    // payCoin (ERC20, no referral)
    // =========================================================================

    function test_payCoin_noReferral_accumulatesProtocol() public {
        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vault.payCoin(address(token), 100e18, bytes32(0));
        vm.stopPrank();

        assertEq(token.balanceOf(address(vault)), 100e18);
    }

    function test_payCoin_noReferral_emitsPayment() public {
        vm.startPrank(alice);
        token.approve(address(vault), 100e18);

        vm.expectEmit(true, true, false, true);
        emit CreditVault.Payment(alice, bytes32(0), address(token), 100e18, 100e18, 0);
        vault.payCoin(address(token), 100e18, bytes32(0));
        vm.stopPrank();
    }

    // =========================================================================
    // payCoin (ERC20, with referral)
    // =========================================================================

    function test_payCoin_withReferral_splitsPushesToReferrer() public {
        vm.prank(bob);
        vault.register("bob");
        bytes32 key = keccak256("bob");

        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vault.payCoin(address(token), 100e18, key);
        vm.stopPrank();

        assertEq(token.balanceOf(bob), 1000e18 + 5e18);
        assertEq(token.balanceOf(address(vault)), 95e18);
    }

    function test_payCoin_withReferral_emitsCorrectAmounts() public {
        vm.prank(bob);
        vault.register("bob");
        bytes32 key = keccak256("bob");

        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vm.expectEmit(true, true, false, true);
        emit CreditVault.Payment(alice, key, address(token), 100e18, 95e18, 5e18);
        vault.payCoin(address(token), 100e18, key);
        vm.stopPrank();
    }

    function test_payCoin_withCustomBps_usesCustomRate() public {
        vm.prank(bob);
        vault.register("bob");
        bytes32 key = keccak256("bob");

        vm.prank(owner);
        vault.setReferralBps(key, 1000);

        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vault.payCoin(address(token), 100e18, key);
        vm.stopPrank();

        assertEq(token.balanceOf(bob), 1000e18 + 10e18);
        assertEq(token.balanceOf(address(vault)), 90e18);
    }

    function test_payCoin_zeroAmount_reverts() public {
        vm.startPrank(alice);
        token.approve(address(vault), 0);
        vm.expectRevert(CreditVault.ZeroAmount.selector);
        vault.payCoin(address(token), 0, bytes32(0));
        vm.stopPrank();
    }

    // =========================================================================
    // pay (ETH)
    // =========================================================================

    function test_pay_noReferral_accumulatesProtocol() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.pay{value: 1 ether}(bytes32(0));
        assertEq(address(vault).balance, 1 ether);
    }

    function test_pay_withReferral_pushesToReferrer() public {
        vm.prank(bob);
        vault.register("bob");
        bytes32 key = keccak256("bob");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.pay{value: 1 ether}(key);

        assertEq(bob.balance, 0.05 ether);
        assertEq(address(vault).balance, 0.95 ether);
    }

    function test_receive_noReferral_accumulatesProtocol() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 1 ether);
    }

    // =========================================================================
    // payAnonymous (ETH)
    // =========================================================================

    function test_payAnonymous_emitsAnonymousDeposit() public {
        bytes32 commitment = keccak256("nullifier:secret");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit CreditVault.AnonymousDeposit(commitment, address(0), 1 ether);
        vault.payAnonymous{value: 1 ether}(commitment);
    }

    function test_payAnonymous_accumulatesBalance() public {
        bytes32 commitment = keccak256("nullifier:secret");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.payAnonymous{value: 1 ether}(commitment);
        assertEq(address(vault).balance, 1 ether);
    }

    function test_payAnonymous_zeroValue_reverts() public {
        bytes32 commitment = keccak256("nullifier:secret");
        vm.prank(alice);
        vm.expectRevert(CreditVault.ZeroAmount.selector);
        vault.payAnonymous{value: 0}(commitment);
    }

    function test_payAnonymous_noPayer_inEvent() public {
        // Verify no payer field is emitted — event has only commitment, token, amount.
        // The AnonymousDeposit event has no address field for the sender by design.
        bytes32 commitment = keccak256("nullifier:secret");
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.recordLogs();
        vault.payAnonymous{value: 1 ether}(commitment);
        VmSafe.Log[] memory logs = vm.getRecordedLogs();
        // AnonymousDeposit(bytes32 indexed commitment, address token, uint256 amount)
        // topics[0] = event sig, topics[1] = commitment — no sender topic
        assertEq(logs[0].topics.length, 2);
    }

    // =========================================================================
    // payCoinAnonymous (ERC20)
    // =========================================================================

    function test_payCoinAnonymous_emitsAnonymousDeposit() public {
        bytes32 commitment = keccak256("nullifier:secret");
        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vm.expectEmit(true, false, false, true);
        emit CreditVault.AnonymousDeposit(commitment, address(token), 100e18);
        vault.payCoinAnonymous(address(token), 100e18, commitment);
        vm.stopPrank();
    }

    function test_payCoinAnonymous_accumulatesBalance() public {
        bytes32 commitment = keccak256("nullifier:secret");
        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vault.payCoinAnonymous(address(token), 100e18, commitment);
        vm.stopPrank();
        assertEq(token.balanceOf(address(vault)), 100e18);
    }

    function test_payCoinAnonymous_zeroAmount_reverts() public {
        bytes32 commitment = keccak256("nullifier:secret");
        vm.startPrank(alice);
        token.approve(address(vault), 0);
        vm.expectRevert(CreditVault.ZeroAmount.selector);
        vault.payCoinAnonymous(address(token), 0, commitment);
        vm.stopPrank();
    }

    // =========================================================================
    // setDefaultBps
    // =========================================================================

    function test_setDefaultBps_updatesDefault() public {
        vm.prank(owner);
        vault.setDefaultBps(1000);
        assertEq(vault.defaultReferralBps(), 1000);
    }

    function test_setDefaultBps_revertsIfExceedsCap() public {
        vm.prank(owner);
        vm.expectRevert(CreditVault.BpsExceedsCap.selector);
        vault.setDefaultBps(5001);
    }

    function test_setDefaultBps_revertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setDefaultBps(1000);
    }

    // =========================================================================
    // setReferralBps
    // =========================================================================

    function test_setReferralBps_revertsIfExceedsCap() public {
        vm.prank(bob);
        vault.register("bob");
        bytes32 key = keccak256("bob");

        vm.prank(owner);
        vm.expectRevert(CreditVault.BpsExceedsCap.selector);
        vault.setReferralBps(key, 5001);
    }

    // =========================================================================
    // withdrawProtocol
    // =========================================================================

    function test_withdrawProtocol_ETH() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.pay{value: 1 ether}(bytes32(0));

        address treasury = address(0xCAFE);
        vm.prank(owner);
        vault.withdrawProtocol(address(0), treasury, 1 ether);
        assertEq(treasury.balance, 1 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_withdrawProtocol_ERC20() public {
        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vault.payCoin(address(token), 100e18, bytes32(0));
        vm.stopPrank();

        address treasury = address(0xCAFE);
        vm.prank(owner);
        vault.withdrawProtocol(address(token), treasury, 100e18);
        assertEq(token.balanceOf(treasury), 100e18);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_withdrawProtocol_revertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.withdrawProtocol(address(0), alice, 1 ether);
    }

    // =========================================================================
    // NFT receiving
    // =========================================================================

    function test_onERC721Received_acceptsNFT() public {
        vm.prank(alice);
        nft.safeTransferFrom(alice, address(vault), 1);
        assertEq(nft.ownerOf(1), address(vault));
    }

    function test_onERC721Received_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit CreditVault.NFTReceived(alice, address(nft), 1);
        vm.prank(alice);
        nft.safeTransferFrom(alice, address(vault), 1);
    }

    // =========================================================================
    // withdrawNFT
    // =========================================================================

    function test_withdrawNFT_transfersToRecipient() public {
        vm.prank(alice);
        nft.safeTransferFrom(alice, address(vault), 1);

        vm.prank(owner);
        vault.withdrawNFT(address(nft), 1, bob);
        assertEq(nft.ownerOf(1), bob);
    }

    function test_withdrawNFT_revertsIfNotOwner() public {
        vm.prank(alice);
        nft.safeTransferFrom(alice, address(vault), 1);

        vm.prank(alice);
        vm.expectRevert();
        vault.withdrawNFT(address(nft), 1, alice);
    }

    // =========================================================================
    // ERC1155 receiving and withdrawal
    // =========================================================================

    function test_onERC1155Received_acceptsToken() public {
        vm.prank(alice);
        erc1155.safeTransferFrom(alice, address(vault), 1, 5, "");
    }

    function test_onERC1155Received_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit CreditVault.ERC1155TokenReceived(alice, address(erc1155), 1, 5);
        vm.prank(alice);
        erc1155.safeTransferFrom(alice, address(vault), 1, 5, "");
    }

    function test_withdrawERC1155_transfersToRecipient() public {
        vm.prank(alice);
        erc1155.safeTransferFrom(alice, address(vault), 1, 5, "");

        vm.prank(owner);
        vault.withdrawERC1155(address(erc1155), 1, 5, bob);
        assertEq(erc1155.balanceOf(bob, 1), 5);
    }

    function test_withdrawERC1155_revertsIfNotOwner() public {
        vm.prank(alice);
        erc1155.safeTransferFrom(alice, address(vault), 1, 5, "");

        vm.prank(alice);
        vm.expectRevert();
        vault.withdrawERC1155(address(erc1155), 1, 5, alice);
    }

    function test_onERC1155BatchReceived_acceptsAndEmits() public {
        erc1155.mint(alice, 2, 20);

        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = 1; ids[1] = 2;
        amounts[0] = 5; amounts[1] = 10;

        vm.expectEmit(true, true, false, true);
        emit CreditVault.ERC1155TokenReceived(alice, address(erc1155), 1, 5);
        vm.expectEmit(true, true, false, true);
        emit CreditVault.ERC1155TokenReceived(alice, address(erc1155), 2, 10);

        vm.prank(alice);
        erc1155.safeBatchTransferFrom(alice, address(vault), ids, amounts, "");

        assertEq(erc1155.balanceOf(address(vault), 1), 5);
        assertEq(erc1155.balanceOf(address(vault), 2), 10);
    }

    // =========================================================================
    // Reentrancy
    // =========================================================================

    function test_pay_revertingReferrer_skipsCut() public {
        address nonPayable = address(new NonPayableContract());

        vm.prank(nonPayable);
        vault.register("broken");
        bytes32 key = keccak256("broken");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.pay{value: 1 ether}(key);

        assertEq(address(vault).balance, 1 ether);
        assertEq(nonPayable.balance, 0);
    }

    function test_pay_reentrancy_cutSkipped() public {
        bytes32 key = keccak256("attacker");
        address attacker = address(new ReentrancyAttackerV2(address(vault), key));

        vm.prank(attacker);
        vault.register("attacker");
        vm.prank(attacker);
        vault.setAddress(key, attacker);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.pay{value: 1 ether}(key);

        assertEq(address(vault).balance, 1 ether);
        assertEq(attacker.balance, 0);
    }

    // =========================================================================
    // Multicall
    // =========================================================================

    function test_multicall_onlyOwner() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vault.pay{value: 2 ether}(bytes32(0));

        vm.startPrank(alice);
        token.approve(address(vault), 100e18);
        vault.payCoin(address(token), 100e18, bytes32(0));
        vm.stopPrank();

        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(vault.withdrawProtocol, (address(token), alice, 100e18));
        vm.prank(alice);
        vm.expectRevert();
        vault.multicall(calls);

        calls = new bytes[](2);
        calls[0] = abi.encodeCall(vault.withdrawProtocol, (address(0), owner, 2 ether));
        calls[1] = abi.encodeCall(vault.withdrawProtocol, (address(token), owner, 100e18));

        vm.prank(owner);
        vault.multicall(calls);

        assertEq(address(vault).balance, 0);
        assertEq(token.balanceOf(owner), 100e18);
    }
}

/// @dev Helper: a contract with no receive() — reverts on ETH push
contract NonPayableContract {}
