// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {HungernadsBetting} from "../src/HungernadsBetting.sol";

contract HungernadsBettingTest is Test {
    HungernadsBetting public betting;

    address public oracle = makeAddr("oracle");
    address public treasury = makeAddr("treasury");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");

    bytes32 public battleId = keccak256("battle-1");
    uint256 public constant AGENT_1 = 1;
    uint256 public constant AGENT_2 = 2;
    uint256 public constant AGENT_3 = 3;

    function setUp() public {
        betting = new HungernadsBetting(oracle, treasury);

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);

        // Oracle creates a battle
        vm.prank(oracle);
        betting.createBattle(battleId);
    }

    // ──────────────────────────────────────────────
    //  Battle Creation
    // ──────────────────────────────────────────────

    function test_createBattle() public {
        bytes32 newBattle = keccak256("battle-2");
        vm.prank(oracle);
        betting.createBattle(newBattle);

        (bool exists,,,,,) = betting.battles(newBattle);
        assertTrue(exists);
    }

    function test_createBattle_revert_notOracle() public {
        bytes32 newBattle = keccak256("battle-2");
        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.OnlyOracle.selector);
        betting.createBattle(newBattle);
    }

    function test_createBattle_revert_alreadyExists() public {
        vm.prank(oracle);
        vm.expectRevert(HungernadsBetting.BattleAlreadyExists.selector);
        betting.createBattle(battleId);
    }

    // ──────────────────────────────────────────────
    //  Place Bets
    // ──────────────────────────────────────────────

    function test_placeBet() public {
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        assertEq(betting.getBattlePool(battleId), 1 ether);
        assertEq(betting.agentPools(battleId, AGENT_1), 1 ether);

        HungernadsBetting.Bet[] memory bets = betting.getUserBets(battleId, alice);
        assertEq(bets.length, 1);
        assertEq(bets[0].agentId, AGENT_1);
        assertEq(bets[0].amount, 1 ether);
    }

    function test_placeBet_multipleBets() public {
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        vm.prank(bob);
        betting.placeBet{value: 2 ether}(battleId, AGENT_2);

        vm.prank(charlie);
        betting.placeBet{value: 3 ether}(battleId, AGENT_1);

        assertEq(betting.getBattlePool(battleId), 6 ether);
        assertEq(betting.agentPools(battleId, AGENT_1), 4 ether);
        assertEq(betting.agentPools(battleId, AGENT_2), 2 ether);
    }

    function test_placeBet_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit HungernadsBetting.BetPlaced(battleId, alice, AGENT_1, 1 ether);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);
    }

    function test_placeBet_revert_battleDoesNotExist() public {
        bytes32 fakeBattle = keccak256("fake");
        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.BattleDoesNotExist.selector);
        betting.placeBet{value: 1 ether}(fakeBattle, AGENT_1);
    }

    function test_placeBet_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.ZeroAmount.selector);
        betting.placeBet{value: 0}(battleId, AGENT_1);
    }

    function test_placeBet_revert_afterSettlement() public {
        // Place a bet first
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        // Settle
        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        // Try to bet again
        vm.prank(bob);
        vm.expectRevert(HungernadsBetting.BattleAlreadySettled.selector);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);
    }

    // ──────────────────────────────────────────────
    //  Settle Battle + Prize Distribution
    // ──────────────────────────────────────────────

    function test_settleBattle_prizeDistribution() public {
        // Alice bets 1 ETH on Agent 1, Bob bets 2 ETH on Agent 2, Charlie bets 3 ETH on Agent 1
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);
        vm.prank(bob);
        betting.placeBet{value: 2 ether}(battleId, AGENT_2);
        vm.prank(charlie);
        betting.placeBet{value: 3 ether}(battleId, AGENT_1);

        uint256 totalPool = 6 ether;
        uint256 expectedTreasury = (totalPool * 500) / 10000; // 0.3 ETH
        uint256 expectedBurn = (totalPool * 500) / 10000; // 0.3 ETH
        uint256 expectedWinners = totalPool - expectedTreasury - expectedBurn; // 5.4 ETH

        uint256 treasuryBefore = treasury.balance;
        uint256 burnBefore = betting.BURN_ADDRESS().balance;

        // Agent 1 wins (Alice + Charlie backed agent 1)
        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        // Check treasury received 5%
        assertEq(treasury.balance - treasuryBefore, expectedTreasury);
        // Check burn received 5%
        assertEq(betting.BURN_ADDRESS().balance - burnBefore, expectedBurn);

        // Check claimable amounts
        // Alice bet 1 ETH on agent 1 (total agent 1 pool = 4 ETH), so she gets 1/4 of winners pool
        uint256 aliceExpected = (expectedWinners * 1 ether) / 4 ether;
        // Charlie bet 3 ETH on agent 1, so she gets 3/4 of winners pool
        uint256 charlieExpected = (expectedWinners * 3 ether) / 4 ether;

        assertEq(betting.claimable(battleId, alice), aliceExpected);
        assertEq(betting.claimable(battleId, charlie), charlieExpected);
        assertEq(betting.claimable(battleId, bob), 0); // Bob lost
    }

    function test_settleBattle_emitsEvent() public {
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        vm.prank(oracle);
        vm.expectEmit(true, false, false, true);
        emit HungernadsBetting.BattleSettled(battleId, AGENT_1, 1 ether);
        betting.settleBattle(battleId, AGENT_1);
    }

    function test_settleBattle_revert_notOracle() public {
        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.OnlyOracle.selector);
        betting.settleBattle(battleId, AGENT_1);
    }

    function test_settleBattle_revert_doubleSettlement() public {
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        vm.prank(oracle);
        vm.expectRevert(HungernadsBetting.BattleAlreadySettled.selector);
        betting.settleBattle(battleId, AGENT_1);
    }

    function test_settleBattle_noWinningBets() public {
        // Only Bob bets on Agent 2, but Agent 1 wins. Winners pool stays in contract.
        vm.prank(bob);
        betting.placeBet{value: 2 ether}(battleId, AGENT_2);

        uint256 treasuryBefore = treasury.balance;
        uint256 burnBefore = betting.BURN_ADDRESS().balance;

        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        uint256 totalPool = 2 ether;
        uint256 expectedTreasury = (totalPool * 500) / 10000;
        uint256 expectedBurn = (totalPool * 500) / 10000;

        assertEq(treasury.balance - treasuryBefore, expectedTreasury);
        assertEq(betting.BURN_ADDRESS().balance - burnBefore, expectedBurn);

        // No one can claim
        assertEq(betting.claimable(battleId, bob), 0);
    }

    function test_settleBattle_emptyPool() public {
        // Settle with zero pool - should work cleanly
        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        (,, bool settled,,,) = betting.battles(battleId);
        assertTrue(settled);
    }

    // ──────────────────────────────────────────────
    //  Claim Prize (Withdraw Pattern)
    // ──────────────────────────────────────────────

    function test_claimPrize() public {
        vm.prank(alice);
        betting.placeBet{value: 4 ether}(battleId, AGENT_1);
        vm.prank(bob);
        betting.placeBet{value: 6 ether}(battleId, AGENT_2);

        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        uint256 aliceClaimable = betting.claimable(battleId, alice);
        assertTrue(aliceClaimable > 0);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        betting.claimPrize(battleId);

        assertEq(alice.balance - aliceBefore, aliceClaimable);
        assertTrue(betting.claimed(battleId, alice));
        assertEq(betting.claimable(battleId, alice), 0);
    }

    function test_claimPrize_emitsEvent() public {
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        uint256 aliceClaimable = betting.claimable(battleId, alice);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit HungernadsBetting.PrizeDistributed(battleId, alice, aliceClaimable);
        betting.claimPrize(battleId);
    }

    function test_claimPrize_revert_nothingToClaim() public {
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_2); // Agent 2 wins, Alice loses

        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.NothingToClaim.selector);
        betting.claimPrize(battleId);
    }

    function test_claimPrize_revert_doubleClaim() public {
        vm.prank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);

        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        vm.prank(alice);
        betting.claimPrize(battleId);

        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.AlreadyClaimed.selector);
        betting.claimPrize(battleId);
    }

    // ──────────────────────────────────────────────
    //  Reentrancy Protection
    // ──────────────────────────────────────────────

    function test_claimPrize_reentrancyProtected() public {
        // Deploy attacker
        ReentrancyAttacker attacker = new ReentrancyAttacker(betting, battleId);
        vm.deal(address(attacker), 10 ether);

        // Attacker places bet
        attacker.placeBet{value: 1 ether}();

        // Settle - attacker's agent wins
        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        // Attacker tries reentrancy attack on claim
        vm.expectRevert(); // ReentrancyGuard or out of gas
        attacker.attack();
    }

    // ──────────────────────────────────────────────
    //  Sponsorship
    // ──────────────────────────────────────────────

    function test_sponsorAgent() public {
        vm.prank(alice);
        betting.sponsorAgent{value: 1 ether}(battleId, AGENT_1, "Go Agent 1!");

        assertEq(betting.getBattlePool(battleId), 1 ether);
    }

    function test_sponsorAgent_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit HungernadsBetting.SponsorshipSent(battleId, AGENT_1, alice, 1 ether, "Go Agent 1!");
        betting.sponsorAgent{value: 1 ether}(battleId, AGENT_1, "Go Agent 1!");
    }

    function test_sponsorAgent_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.ZeroAmount.selector);
        betting.sponsorAgent{value: 0}(battleId, AGENT_1, "Free sponsor");
    }

    function test_sponsorAgent_revert_battleDoesNotExist() public {
        bytes32 fakeBattle = keccak256("fake");
        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.BattleDoesNotExist.selector);
        betting.sponsorAgent{value: 1 ether}(fakeBattle, AGENT_1, "msg");
    }

    function test_sponsorAgent_revert_afterSettlement() public {
        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.BattleAlreadySettled.selector);
        betting.sponsorAgent{value: 1 ether}(battleId, AGENT_1, "Too late");
    }

    // ──────────────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────────────

    function test_getOdds() public {
        vm.prank(alice);
        betting.placeBet{value: 3 ether}(battleId, AGENT_1);
        vm.prank(bob);
        betting.placeBet{value: 7 ether}(battleId, AGENT_2);

        uint256[] memory agentIds = new uint256[](3);
        agentIds[0] = AGENT_1;
        agentIds[1] = AGENT_2;
        agentIds[2] = AGENT_3;

        uint256[] memory pools = betting.getOdds(battleId, agentIds);
        assertEq(pools[0], 3 ether);
        assertEq(pools[1], 7 ether);
        assertEq(pools[2], 0);
    }

    function test_getUserBets_multiple() public {
        vm.startPrank(alice);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);
        betting.placeBet{value: 2 ether}(battleId, AGENT_2);
        betting.placeBet{value: 0.5 ether}(battleId, AGENT_1);
        vm.stopPrank();

        HungernadsBetting.Bet[] memory bets = betting.getUserBets(battleId, alice);
        assertEq(bets.length, 3);
        assertEq(bets[0].agentId, AGENT_1);
        assertEq(bets[0].amount, 1 ether);
        assertEq(bets[1].agentId, AGENT_2);
        assertEq(bets[1].amount, 2 ether);
        assertEq(bets[2].agentId, AGENT_1);
        assertEq(bets[2].amount, 0.5 ether);
    }

    // ──────────────────────────────────────────────
    //  End-to-End Flow
    // ──────────────────────────────────────────────

    function test_endToEnd_fullBettingFlow() public {
        // 1. Multiple users place bets
        vm.prank(alice);
        betting.placeBet{value: 2 ether}(battleId, AGENT_1);
        vm.prank(bob);
        betting.placeBet{value: 3 ether}(battleId, AGENT_2);
        vm.prank(charlie);
        betting.placeBet{value: 5 ether}(battleId, AGENT_1);

        // Pool = 10 ETH. Agent 1 pool = 7 ETH. Agent 2 pool = 3 ETH.
        assertEq(betting.getBattlePool(battleId), 10 ether);

        // 2. Add sponsorship
        vm.prank(alice);
        betting.sponsorAgent{value: 1 ether}(battleId, AGENT_1, "May the nads be ever in your favor");

        // Pool = 11 ETH
        assertEq(betting.getBattlePool(battleId), 11 ether);

        // 3. Settle - Agent 1 wins
        uint256 treasuryBefore = treasury.balance;
        uint256 burnBefore = betting.BURN_ADDRESS().balance;

        vm.prank(oracle);
        betting.settleBattle(battleId, AGENT_1);

        uint256 pool = 11 ether;
        uint256 treasuryCut = (pool * 500) / 10000; // 0.55 ETH
        uint256 burnCut = (pool * 500) / 10000; // 0.55 ETH
        uint256 winnersCut = pool - treasuryCut - burnCut; // 9.9 ETH

        assertEq(treasury.balance - treasuryBefore, treasuryCut);
        assertEq(betting.BURN_ADDRESS().balance - burnBefore, burnCut);

        // 4. Alice claims (2/7 of 9.9 ETH)
        uint256 aliceExpected = (winnersCut * 2 ether) / 7 ether;
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        betting.claimPrize(battleId);
        assertEq(alice.balance - aliceBefore, aliceExpected);

        // 5. Charlie claims (5/7 of 9.9 ETH)
        uint256 charlieExpected = (winnersCut * 5 ether) / 7 ether;
        uint256 charlieBefore = charlie.balance;
        vm.prank(charlie);
        betting.claimPrize(battleId);
        assertEq(charlie.balance - charlieBefore, charlieExpected);

        // 6. Bob can't claim (lost)
        vm.prank(bob);
        vm.expectRevert(HungernadsBetting.NothingToClaim.selector);
        betting.claimPrize(battleId);

        // 7. No more bets after settlement
        vm.prank(alice);
        vm.expectRevert(HungernadsBetting.BattleAlreadySettled.selector);
        betting.placeBet{value: 1 ether}(battleId, AGENT_1);
    }
}

// ──────────────────────────────────────────────
//  Reentrancy Attacker Contract
// ──────────────────────────────────────────────

contract ReentrancyAttacker {
    HungernadsBetting public betting;
    bytes32 public battleId;
    uint256 public attackCount;

    constructor(HungernadsBetting _betting, bytes32 _battleId) {
        betting = _betting;
        battleId = _battleId;
    }

    function placeBet() external payable {
        betting.placeBet{value: msg.value}(battleId, 1);
    }

    function attack() external {
        betting.claimPrize(battleId);
    }

    receive() external payable {
        if (attackCount < 3) {
            attackCount++;
            betting.claimPrize(battleId);
        }
    }
}
