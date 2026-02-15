// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {HungernadsArena} from "../src/HungernadsArena.sol";
import {HNADSMock} from "../src/HNADSMock.sol";

contract HungernadsArenaTiersTest is Test {
    HungernadsArena public arena;
    HNADSMock public hnads;
    address public oracle;
    address public treasury;
    address public player1;
    address public player2;

    bytes32 public constant BATTLE_ID = bytes32(uint256(1));
    uint256[] public agentIds;

    event HnadsFeeDeposited(bytes32 indexed battleId, address indexed player, uint256 amount);
    event HnadsBurned(bytes32 indexed battleId, uint256 amount);
    event HnadsTreasuryTransferred(bytes32 indexed battleId, uint256 amount);
    event HnadsTokenUpdated(address indexed previousToken, address indexed newToken);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    function setUp() public {
        oracle = makeAddr("oracle");
        treasury = makeAddr("treasury");
        player1 = makeAddr("player1");
        player2 = makeAddr("player2");

        // Deploy HNADS mock token
        hnads = new HNADSMock();

        // Deploy Arena proxy
        HungernadsArena impl = new HungernadsArena();
        bytes memory initData = abi.encodeCall(HungernadsArena.initialize, (oracle));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        arena = HungernadsArena(payable(address(proxy)));

        // Set HNADS token and treasury
        arena.setHnadsToken(address(hnads));
        arena.setTreasury(treasury);

        // Setup agent IDs
        agentIds.push(1);
        agentIds.push(2);
        agentIds.push(3);

        // Mint HNADS to players
        hnads.mint(player1, 10000 ether);
        hnads.mint(player2, 10000 ether);
    }

    function test_SetHnadsToken() public {
        HNADSMock newToken = new HNADSMock();

        vm.expectEmit(true, true, false, true);
        emit HnadsTokenUpdated(address(hnads), address(newToken));

        arena.setHnadsToken(address(newToken));
        assertEq(address(arena.hnadsToken()), address(newToken));
    }

    function test_SetHnadsToken_RevertWhenZeroAddress() public {
        vm.expectRevert(HungernadsArena.ZeroAddress.selector);
        arena.setHnadsToken(address(0));
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");

        vm.expectEmit(true, true, false, true);
        emit TreasuryUpdated(treasury, newTreasury);

        arena.setTreasury(newTreasury);
        assertEq(arena.treasury(), newTreasury);
    }

    function test_DepositHnadsFee() public {
        // Register battle
        vm.prank(oracle);
        arena.registerBattle(BATTLE_ID, agentIds, 0);

        // Approve HNADS spending
        vm.startPrank(player1);
        hnads.approve(address(arena), 100 ether);

        // Deposit HNADS fee
        vm.expectEmit(true, true, false, true);
        emit HnadsFeeDeposited(BATTLE_ID, player1, 100 ether);

        arena.depositHnadsFee(BATTLE_ID, 100 ether);
        vm.stopPrank();

        // Verify state
        assertEq(arena.hnadsFeesCollected(BATTLE_ID), 100 ether);
        assertTrue(arena.hnadsFeePaid(BATTLE_ID, player1));
        assertEq(hnads.balanceOf(address(arena)), 100 ether);
    }

    function test_DepositHnadsFee_RevertWhenAlreadyPaid() public {
        vm.prank(oracle);
        arena.registerBattle(BATTLE_ID, agentIds, 0);

        vm.startPrank(player1);
        hnads.approve(address(arena), 200 ether);
        arena.depositHnadsFee(BATTLE_ID, 100 ether);

        vm.expectRevert(HungernadsArena.AlreadyPaid.selector);
        arena.depositHnadsFee(BATTLE_ID, 100 ether);
        vm.stopPrank();
    }

    function test_DepositHnadsFee_RevertWhenBattleNotFound() public {
        vm.startPrank(player1);
        hnads.approve(address(arena), 100 ether);

        vm.expectRevert(abi.encodeWithSelector(HungernadsArena.BattleNotFound.selector, BATTLE_ID));
        arena.depositHnadsFee(BATTLE_ID, 100 ether);
        vm.stopPrank();
    }

    function test_BurnHnads() public {
        // Register and setup battle
        vm.prank(oracle);
        arena.registerBattle(BATTLE_ID, agentIds, 0);

        // Player 1 deposits 100 HNADS
        vm.startPrank(player1);
        hnads.approve(address(arena), 100 ether);
        arena.depositHnadsFee(BATTLE_ID, 100 ether);
        vm.stopPrank();

        // Player 2 deposits 100 HNADS
        vm.startPrank(player2);
        hnads.approve(address(arena), 100 ether);
        arena.depositHnadsFee(BATTLE_ID, 100 ether);
        vm.stopPrank();

        // Total collected: 200 HNADS

        // Activate and complete battle
        vm.startPrank(oracle);
        arena.activateBattle(BATTLE_ID);

        arena.recordResult(BATTLE_ID, 1);

        // Burn 50% (100 HNADS)
        vm.expectEmit(true, false, false, true);
        emit HnadsBurned(BATTLE_ID, 100 ether);

        arena.burnHnads(BATTLE_ID);
        vm.stopPrank();

        // Verify burned amount
        assertEq(arena.hnadsBurned(BATTLE_ID), 100 ether);
        assertEq(hnads.balanceOf(arena.BURN_ADDRESS()), 100 ether);
    }

    function test_TransferHnadsToTreasury() public {
        // Register and setup battle
        vm.prank(oracle);
        arena.registerBattle(BATTLE_ID, agentIds, 0);

        // Players deposit fees
        vm.startPrank(player1);
        hnads.approve(address(arena), 100 ether);
        arena.depositHnadsFee(BATTLE_ID, 100 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        hnads.approve(address(arena), 100 ether);
        arena.depositHnadsFee(BATTLE_ID, 100 ether);
        vm.stopPrank();

        // Complete battle
        vm.startPrank(oracle);
        arena.activateBattle(BATTLE_ID);

        arena.recordResult(BATTLE_ID, 1);

        // Transfer 50% to treasury (100 HNADS)
        vm.expectEmit(true, false, false, true);
        emit HnadsTreasuryTransferred(BATTLE_ID, 100 ether);

        arena.transferHnadsToTreasury(BATTLE_ID);
        vm.stopPrank();

        // Verify treasury received funds
        assertEq(arena.hnadsTreasury(BATTLE_ID), 100 ether);
        assertEq(hnads.balanceOf(treasury), 100 ether);
    }

    function test_AwardKillBonus() public {
        // Fund arena with HNADS for bonuses
        hnads.mint(address(arena), 1000 ether);

        // Award kill bonus to player1
        vm.prank(oracle);
        arena.awardKillBonus(player1, 50 ether);

        // Verify player1 received bonus
        assertEq(hnads.balanceOf(player1), 10000 ether + 50 ether);
    }

    function test_AwardSurvivalBonus() public {
        // Fund arena with HNADS for bonuses
        hnads.mint(address(arena), 1000 ether);

        // Award survival bonus to player2
        vm.prank(oracle);
        arena.awardSurvivalBonus(player2, 100 ether);

        // Verify player2 received bonus
        assertEq(hnads.balanceOf(player2), 10000 ether + 100 ether);
    }

    function test_FullTierFlow_BronzeTier() public {
        // Simulate BRONZE tier: 10 MON + 100 HNADS entry fee
        // 5 players join, total 500 HNADS collected
        // 250 HNADS burned, 250 HNADS to treasury

        vm.prank(oracle);
        arena.registerBattle(BATTLE_ID, agentIds, 10 ether); // 10 MON entry fee

        address[5] memory players = [
            makeAddr("p1"),
            makeAddr("p2"),
            makeAddr("p3"),
            makeAddr("p4"),
            makeAddr("p5")
        ];

        // Each player deposits 100 HNADS
        for (uint i = 0; i < 5; i++) {
            hnads.mint(players[i], 100 ether);
            vm.startPrank(players[i]);
            hnads.approve(address(arena), 100 ether);
            arena.depositHnadsFee(BATTLE_ID, 100 ether);
            vm.stopPrank();
        }

        // Verify total collected
        assertEq(arena.hnadsFeesCollected(BATTLE_ID), 500 ether);

        // Complete battle
        vm.startPrank(oracle);
        arena.activateBattle(BATTLE_ID);

        arena.recordResult(BATTLE_ID, 1);

        // Burn and transfer
        arena.burnHnads(BATTLE_ID);
        arena.transferHnadsToTreasury(BATTLE_ID);
        vm.stopPrank();

        // Verify final state
        assertEq(arena.hnadsBurned(BATTLE_ID), 250 ether); // 50% burned
        assertEq(arena.hnadsTreasury(BATTLE_ID), 250 ether); // 50% to treasury
        assertEq(hnads.balanceOf(arena.BURN_ADDRESS()), 250 ether);
        assertEq(hnads.balanceOf(treasury), 250 ether);
    }
}
