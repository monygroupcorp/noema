// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {MiladyMessage} from "src/MiladyMessage.sol";

contract MiladyMessageTest is Test {
    MiladyMessage target;
    address deployer = address(0xBEEF);

    function setUp() public {
        vm.prank(deployer);
        target = new MiladyMessage();
    }

    function test_senderIsDeployer() public view {
        assertEq(target.sender(), deployer);
    }

    function test_broadcastEmitsOnePerOwner() public {
        address[] memory owners = new address[](3);
        owners[0] = address(0x1);
        owners[1] = address(0x2);
        owners[2] = address(0x3);

        vm.recordLogs();
        vm.prank(deployer);
        target.broadcast(owners);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 3);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(address(uint160(uint256(logs[i].topics[1]))), owners[i]);
        }
    }

    function test_broadcastRevertsForNonSender() public {
        address[] memory owners = new address[](1);
        owners[0] = address(0x1);

        vm.expectRevert(MiladyMessage.NotSender.selector);
        target.broadcast(owners);
    }

    function test_broadcastEmptyArrayIsNoop() public {
        address[] memory owners = new address[](0);
        vm.prank(deployer);
        target.broadcast(owners);
    }
}
