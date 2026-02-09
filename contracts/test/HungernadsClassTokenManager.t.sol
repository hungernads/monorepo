// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HungernadsClassTokenManager} from "../src/HungernadsClassTokenManager.sol";
import {HungernadsClassToken} from "../src/HungernadsClassToken.sol";

contract HungernadsClassTokenManagerTest is Test {
    HungernadsClassTokenManager public manager;

    address public oracle = makeAddr("oracle");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");

    bytes32 public battleId = keccak256("battle-1");

    function setUp() public {
        manager = new HungernadsClassTokenManager(oracle);
        manager.initialize();

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        vm.deal(oracle, 100 ether);
    }

    // ── Helpers ──────────────────────────────────────────────────

    /// @dev Buy tokens for a user. Cost is pre-computed to avoid prank consumption.
    function _buyTokens(address user, uint8 classId, uint256 amount) internal {
        uint256 cost = manager.getBuyCost(classId, amount);
        vm.prank(user);
        manager.buyTokens{value: cost}(classId, amount);
    }

    // ──────────────────────────────────────────────
    //  Initialization
    // ──────────────────────────────────────────────

    function test_initialize_deploysAllClassTokens() public view {
        assertTrue(manager.initialized());

        for (uint8 i = 0; i < 5; i++) {
            address tokenAddr = address(manager.classTokens(i));
            assertTrue(tokenAddr != address(0), "Token not deployed");

            HungernadsClassToken token = HungernadsClassToken(tokenAddr);
            assertEq(token.classId(), i);
            assertEq(token.manager(), address(manager));
        }
    }

    function test_initialize_setsCorrectSymbols() public view {
        string[5] memory expectedSymbols = ["WARRIOR", "TRADER", "SURVIVOR", "PARASITE", "GAMBLER"];
        for (uint8 i = 0; i < 5; i++) {
            HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(i)));
            assertEq(token.symbol(), expectedSymbols[i]);
        }
    }

    function test_initialize_setsDefaultStrategies() public view {
        for (uint8 i = 0; i < 5; i++) {
            HungernadsClassTokenManager.StrategyParams memory s = manager.getClassStrategy(i);
            assertEq(s.aggressionLevel, 50);
            assertEq(s.riskTolerance, 50);
            assertEq(s.defensePreference, 50);
        }
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert(HungernadsClassTokenManager.AlreadyInitialized.selector);
        manager.initialize();
    }

    // ──────────────────────────────────────────────
    //  Token Purchase (Bonding Curve)
    // ──────────────────────────────────────────────

    function test_buyTokens_firstToken() public {
        uint256 cost = manager.getBuyCost(0, 1);
        assertEq(cost, 0.001 ether);

        vm.prank(alice);
        manager.buyTokens{value: cost}(0, 1);

        HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(0)));
        assertEq(token.balanceOf(alice), 1e18);
    }

    function test_buyTokens_multipleTokens() public {
        uint256 cost = manager.getBuyCost(0, 10);

        vm.prank(alice);
        manager.buyTokens{value: cost}(0, 10);

        HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(0)));
        assertEq(token.balanceOf(alice), 10e18);
    }

    function test_buyTokens_bondingCurvePriceIncrease() public {
        uint256 cost1 = manager.getBuyCost(0, 1);

        _buyTokens(alice, 0, 10);

        uint256 cost2 = manager.getBuyCost(0, 1);
        assertTrue(cost2 > cost1, "Price should increase with supply");
    }

    function test_buyTokens_refundsExcess() public {
        uint256 cost = manager.getBuyCost(0, 1);
        uint256 overpay = cost + 1 ether;

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        manager.buyTokens{value: overpay}(0, 1);

        assertEq(aliceBefore - alice.balance, cost);
    }

    function test_buyTokens_emitsEvent() public {
        uint256 cost = manager.getBuyCost(0, 5);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit HungernadsClassTokenManager.TokensPurchased(0, alice, 5, cost);
        manager.buyTokens{value: cost}(0, 5);
    }

    function test_buyTokens_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(HungernadsClassTokenManager.ZeroAmount.selector);
        manager.buyTokens{value: 1 ether}(0, 0);
    }

    function test_buyTokens_revert_insufficientPayment() public {
        uint256 cost = manager.getBuyCost(0, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.InsufficientPayment.selector,
            cost,
            cost - 1
        ));
        manager.buyTokens{value: cost - 1}(0, 1);
    }

    function test_buyTokens_revert_invalidClass() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HungernadsClassTokenManager.InvalidClassId.selector, 5));
        manager.buyTokens{value: 1 ether}(5, 1);
    }

    // ──────────────────────────────────────────────
    //  Class Sponsorship (Burn-to-Boost)
    // ──────────────────────────────────────────────

    function test_sponsorClass_burnsTokens() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(0)));
        assertEq(token.balanceOf(alice), 10e18);

        vm.startPrank(alice);
        token.approve(address(manager), 5e18);
        manager.sponsorClass(0, 5e18, "Warriors forever!");
        vm.stopPrank();

        assertEq(token.balanceOf(alice), 5e18);
        assertEq(manager.classSponsorshipBurns(0), 5e18);
    }

    function test_sponsorClass_emitsEvent() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(0)));

        vm.startPrank(alice);
        token.approve(address(manager), 5e18);

        vm.expectEmit(true, true, false, true);
        emit HungernadsClassTokenManager.ClassSponsorship(0, alice, 5e18, "Go warriors!");
        manager.sponsorClass(0, 5e18, "Go warriors!");
        vm.stopPrank();
    }

    function test_sponsorClass_revert_insufficientBalance() public {
        _buyTokens(alice, 0, 1);

        HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(0)));

        vm.startPrank(alice);
        token.approve(address(manager), 10e18);

        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.InsufficientTokenBalance.selector,
            10e18,
            1e18
        ));
        manager.sponsorClass(0, 10e18, "Too much!");
        vm.stopPrank();
    }

    function test_sponsorClass_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(HungernadsClassTokenManager.ZeroAmount.selector);
        manager.sponsorClass(0, 0, "Nothing");
    }

    // ──────────────────────────────────────────────
    //  Battle Rewards
    // ──────────────────────────────────────────────

    function test_recordClassWin_fundsRewardPool() public {
        vm.prank(oracle);
        manager.recordClassWin{value: 1 ether}(0, battleId);

        (uint256 wins, uint256 totalEarnings, uint256 currentPool,,) = manager.getClassStats(0);
        assertEq(wins, 1);
        assertEq(totalEarnings, 1 ether);
        assertEq(currentPool, 1 ether);
    }

    function test_recordClassWin_createsRewardEpoch() public {
        vm.prank(oracle);
        manager.recordClassWin{value: 2 ether}(0, battleId);

        HungernadsClassTokenManager.RewardEpoch memory epoch = manager.getRewardEpoch(0);
        assertEq(epoch.classId, 0);
        assertEq(epoch.totalReward, 2 ether);
        assertTrue(epoch.createdAt > 0);
    }

    function test_recordClassWin_revert_notOracle() public {
        vm.prank(alice);
        vm.expectRevert(HungernadsClassTokenManager.OnlyOracle.selector);
        manager.recordClassWin{value: 1 ether}(0, battleId);
    }

    function test_recordClassWin_noReward() public {
        vm.prank(oracle);
        manager.recordClassWin(0, battleId);

        (uint256 wins,,,,) = manager.getClassStats(0);
        assertEq(wins, 1);
    }

    // ──────────────────────────────────────────────
    //  Reward Claiming
    // ──────────────────────────────────────────────

    function test_claimReward_proportional() public {
        _buyTokens(alice, 0, 75);
        _buyTokens(bob, 0, 25);

        // Oracle funds 4 ETH reward
        vm.prank(oracle);
        manager.recordClassWin{value: 4 ether}(0, battleId);

        // Alice should get 75% = 3 ETH
        uint256 aliceClaimable = manager.getClaimableReward(0, alice);
        assertEq(aliceClaimable, 3 ether);

        // Bob should get 25% = 1 ETH
        uint256 bobClaimable = manager.getClaimableReward(0, bob);
        assertEq(bobClaimable, 1 ether);

        // Alice claims
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        manager.claimReward(0);
        assertEq(alice.balance - aliceBefore, 3 ether);

        // Bob claims
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        manager.claimReward(0);
        assertEq(bob.balance - bobBefore, 1 ether);
    }

    function test_claimReward_emitsEvent() public {
        _buyTokens(alice, 0, 10);

        vm.prank(oracle);
        manager.recordClassWin{value: 1 ether}(0, battleId);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit HungernadsClassTokenManager.ClassRewardClaimed(0, 0, alice, 1 ether);
        manager.claimReward(0);
    }

    function test_claimReward_revert_doubleClaim() public {
        _buyTokens(alice, 0, 10);

        vm.prank(oracle);
        manager.recordClassWin{value: 1 ether}(0, battleId);

        vm.prank(alice);
        manager.claimReward(0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.RewardAlreadyClaimed.selector, 0, alice
        ));
        manager.claimReward(0);
    }

    function test_claimReward_revert_noTokens() public {
        _buyTokens(alice, 0, 10);

        vm.prank(oracle);
        manager.recordClassWin{value: 1 ether}(0, battleId);

        // Charlie has no tokens
        vm.prank(charlie);
        vm.expectRevert(HungernadsClassTokenManager.NoRewardAvailable.selector);
        manager.claimReward(0);
    }

    // ──────────────────────────────────────────────
    //  Strategy Voting
    // ──────────────────────────────────────────────

    function test_createProposal() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 80,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        HungernadsClassTokenManager.Proposal memory p = manager.getProposal(proposalId);
        assertEq(p.classId, 0);
        assertEq(p.proposer, alice);
        assertEq(p.params.aggressionLevel, 80);
        assertEq(p.params.riskTolerance, 60);
        assertEq(p.params.defensePreference, 30);
        assertFalse(p.executed);
        assertFalse(p.canceled);
    }

    function test_createProposal_revert_noTokens() public {
        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 80,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.InsufficientTokenBalance.selector, 1, 0
        ));
        manager.createProposal(0, params, 3 days);
    }

    function test_createProposal_revert_invalidParams() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 101,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.InvalidStrategyParam.selector, "aggressionLevel", 101
        ));
        manager.createProposal(0, params, 3 days);
    }

    function test_vote_tokenWeighted() public {
        _buyTokens(alice, 0, 70);
        _buyTokens(bob, 0, 30);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 90,
            riskTolerance: 70,
            defensePreference: 20
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        vm.prank(alice);
        manager.vote(proposalId, true);
        vm.prank(bob);
        manager.vote(proposalId, true);

        HungernadsClassTokenManager.Proposal memory p = manager.getProposal(proposalId);
        assertEq(p.votesFor, 100e18);
        assertEq(p.votesAgainst, 0);
    }

    function test_vote_revert_doubleVote() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 80,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        vm.prank(alice);
        manager.vote(proposalId, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.AlreadyVoted.selector, proposalId, alice
        ));
        manager.vote(proposalId, true);
    }

    function test_vote_revert_votingEnded() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 80,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        vm.warp(block.timestamp + 4 days);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.VotingEnded.selector, proposalId
        ));
        manager.vote(proposalId, true);
    }

    function test_executeProposal_updatesStrategy() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 90,
            riskTolerance: 70,
            defensePreference: 20
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        vm.prank(alice);
        manager.vote(proposalId, true);

        vm.warp(block.timestamp + 4 days);

        manager.executeProposal(proposalId);

        HungernadsClassTokenManager.StrategyParams memory newStrategy = manager.getClassStrategy(0);
        assertEq(newStrategy.aggressionLevel, 90);
        assertEq(newStrategy.riskTolerance, 70);
        assertEq(newStrategy.defensePreference, 20);
    }

    function test_executeProposal_revert_votingNotEnded() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 80,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.VotingNotEnded.selector, proposalId
        ));
        manager.executeProposal(proposalId);
    }

    function test_executeProposal_revert_failed() public {
        _buyTokens(alice, 0, 70);
        _buyTokens(bob, 0, 30);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 80,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        vm.prank(alice);
        manager.vote(proposalId, false);
        vm.prank(bob);
        manager.vote(proposalId, true);

        vm.warp(block.timestamp + 4 days);

        vm.expectRevert(abi.encodeWithSelector(
            HungernadsClassTokenManager.ProposalFailed.selector, proposalId
        ));
        manager.executeProposal(proposalId);
    }

    function test_cancelProposal() public {
        _buyTokens(alice, 0, 10);

        HungernadsClassTokenManager.StrategyParams memory params = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 80,
            riskTolerance: 60,
            defensePreference: 30
        });

        vm.prank(alice);
        uint256 proposalId = manager.createProposal(0, params, 3 days);

        vm.prank(alice);
        manager.cancelProposal(proposalId);

        HungernadsClassTokenManager.Proposal memory p = manager.getProposal(proposalId);
        assertTrue(p.canceled);
    }

    // ──────────────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────────────

    function test_getClassToken() public view {
        for (uint8 i = 0; i < 5; i++) {
            address tokenAddr = manager.getClassToken(i);
            assertTrue(tokenAddr != address(0));
        }
    }

    function test_getCurrentPrice() public {
        uint256 price0 = manager.getCurrentPrice(0);
        assertEq(price0, 0.001 ether);

        _buyTokens(alice, 0, 100);

        uint256 price100 = manager.getCurrentPrice(0);
        assertEq(price100, 0.001 ether + 100 * 0.0000001 ether);
    }

    function test_getClassStats() public {
        _buyTokens(alice, 0, 50);

        HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(0)));

        vm.startPrank(alice);
        token.approve(address(manager), 10e18);
        manager.sponsorClass(0, 10e18, "Warrior tribe!");
        vm.stopPrank();

        vm.prank(oracle);
        manager.recordClassWin{value: 2 ether}(0, battleId);

        (uint256 wins, uint256 totalEarnings, uint256 currentPool, uint256 sponsorBurns, uint256 supply)
            = manager.getClassStats(0);

        assertEq(wins, 1);
        assertEq(totalEarnings, 2 ether);
        assertEq(currentPool, 2 ether);
        assertEq(sponsorBurns, 10e18);
        assertEq(supply, 40e18);
    }

    // ──────────────────────────────────────────────
    //  End-to-End Flow
    // ──────────────────────────────────────────────

    function test_endToEnd_classTokenLifecycle() public {
        // 1. Alice buys 60 WARRIOR tokens, Bob buys 40
        uint256 aliceCost = manager.getBuyCost(0, 60);
        vm.prank(alice);
        manager.buyTokens{value: aliceCost}(0, 60);

        uint256 bobCost = manager.getBuyCost(0, 40);
        vm.prank(bob);
        manager.buyTokens{value: bobCost}(0, 40);

        HungernadsClassToken token = HungernadsClassToken(address(manager.classTokens(0)));
        assertEq(token.totalSupply(), 100e18);

        // 2. Alice sponsors (burns 10 tokens)
        vm.startPrank(alice);
        token.approve(address(manager), 10e18);
        manager.sponsorClass(0, 10e18, "WARRIOR SUPREMACY");
        vm.stopPrank();

        assertEq(token.totalSupply(), 90e18);
        assertEq(token.balanceOf(alice), 50e18);

        // 3. Oracle records a WARRIOR class win with 5 ETH reward
        vm.prank(oracle);
        manager.recordClassWin{value: 5 ether}(0, battleId);

        // 4. Alice claims: 50/90 of 5 ETH
        uint256 reward = 5 ether;
        uint256 aliceTokenBal = 50e18;
        uint256 supply = 90e18;
        uint256 aliceExpected = (reward * aliceTokenBal) / supply;
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        manager.claimReward(0);
        assertEq(alice.balance - aliceBefore, aliceExpected);

        // 5. Bob claims: 40/90 of 5 ETH
        uint256 bobTokenBal = 40e18;
        uint256 bobExpected = (reward * bobTokenBal) / supply;
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        manager.claimReward(0);
        assertEq(bob.balance - bobBefore, bobExpected);

        // 6. Create and execute a strategy proposal
        HungernadsClassTokenManager.StrategyParams memory aggressiveStrategy = HungernadsClassTokenManager.StrategyParams({
            aggressionLevel: 95,
            riskTolerance: 80,
            defensePreference: 10
        });

        vm.prank(alice);
        uint256 pid = manager.createProposal(0, aggressiveStrategy, 3 days);

        vm.prank(alice);
        manager.vote(pid, true);
        vm.prank(bob);
        manager.vote(pid, true);

        vm.warp(block.timestamp + 4 days);
        manager.executeProposal(pid);

        HungernadsClassTokenManager.StrategyParams memory newS = manager.getClassStrategy(0);
        assertEq(newS.aggressionLevel, 95);
        assertEq(newS.riskTolerance, 80);
        assertEq(newS.defensePreference, 10);
    }

    function test_multipleClasses_independent() public {
        _buyTokens(alice, 0, 10); // WARRIOR
        _buyTokens(bob, 2, 10);   // SURVIVOR

        // Record wins for both classes
        vm.prank(oracle);
        manager.recordClassWin{value: 2 ether}(0, keccak256("b1"));
        vm.prank(oracle);
        manager.recordClassWin{value: 3 ether}(2, keccak256("b2"));

        // Alice can claim WARRIOR reward (epoch 0) but not SURVIVOR (epoch 1)
        uint256 aliceWarrior = manager.getClaimableReward(0, alice);
        assertEq(aliceWarrior, 2 ether);
        uint256 aliceSurvivor = manager.getClaimableReward(1, alice);
        assertEq(aliceSurvivor, 0);

        // Bob can claim SURVIVOR reward (epoch 1) but not WARRIOR (epoch 0)
        uint256 bobWarrior = manager.getClaimableReward(0, bob);
        assertEq(bobWarrior, 0);
        uint256 bobSurvivor = manager.getClaimableReward(1, bob);
        assertEq(bobSurvivor, 3 ether);
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    function test_setOracle() public {
        address newOracle = makeAddr("newOracle");
        manager.setOracle(newOracle);
        assertEq(manager.oracle(), newOracle);
    }

    function test_setOracle_revert_zeroAddress() public {
        vm.expectRevert(HungernadsClassTokenManager.ZeroAddress.selector);
        manager.setOracle(address(0));
    }

    function test_setOracle_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        manager.setOracle(alice);
    }
}
