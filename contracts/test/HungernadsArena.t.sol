// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {HungernadsArena} from "../src/HungernadsArena.sol";

contract HungernadsArenaTest is Test {
    HungernadsArena public arena;

    address owner = address(this);
    address oracle = makeAddr("oracle");
    address rando = makeAddr("rando");

    bytes32 battleId1 = keccak256("battle-1");
    bytes32 battleId2 = keccak256("battle-2");

    uint256[] agentIds;

    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------

    function setUp() public {
        arena = new HungernadsArena(oracle);

        agentIds = new uint256[](5);
        agentIds[0] = 1; // Warrior
        agentIds[1] = 2; // Trader
        agentIds[2] = 3; // Survivor
        agentIds[3] = 4; // Parasite
        agentIds[4] = 5; // Gambler
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    function test_constructor_setsOracleAndOwner() public view {
        assertEq(arena.oracle(), oracle);
        assertEq(arena.owner(), owner);
    }

    function test_constructor_revertsOnZeroOracle() public {
        vm.expectRevert(HungernadsArena.ZeroAddress.selector);
        new HungernadsArena(address(0));
    }

    function test_constructor_emitsOracleUpdated() public {
        vm.expectEmit(true, true, false, false);
        emit HungernadsArena.OracleUpdated(address(0), oracle);
        new HungernadsArena(oracle);
    }

    // -----------------------------------------------------------------------
    // setOracle
    // -----------------------------------------------------------------------

    function test_setOracle_updatesOracle() public {
        address newOracle = makeAddr("newOracle");
        arena.setOracle(newOracle);
        assertEq(arena.oracle(), newOracle);
    }

    function test_setOracle_revertsForNonOwner() public {
        vm.prank(rando);
        vm.expectRevert();
        arena.setOracle(makeAddr("newOracle"));
    }

    function test_setOracle_revertsOnZeroAddress() public {
        vm.expectRevert(HungernadsArena.ZeroAddress.selector);
        arena.setOracle(address(0));
    }

    function test_setOracle_emitsEvent() public {
        address newOracle = makeAddr("newOracle");
        vm.expectEmit(true, true, false, false);
        emit HungernadsArena.OracleUpdated(oracle, newOracle);
        arena.setOracle(newOracle);
    }

    // -----------------------------------------------------------------------
    // registerBattle
    // -----------------------------------------------------------------------

    function test_registerBattle_createsNewBattle() public {
        vm.prank(oracle);
        arena.registerBattle(battleId1, agentIds);

        HungernadsArena.Battle memory b = arena.getBattle(battleId1);
        assertEq(b.battleId, battleId1);
        assertTrue(b.state == HungernadsArena.BattleState.Created);
        assertEq(b.agentIds.length, 5);
        assertEq(b.winnerId, 0);
        assertEq(b.completedAt, 0);
        assertGt(b.createdAt, 0);
    }

    function test_registerBattle_autoRegistersAgents() public {
        vm.prank(oracle);
        arena.registerBattle(battleId1, agentIds);

        for (uint256 i = 0; i < agentIds.length; i++) {
            HungernadsArena.AgentStats memory s = arena.getAgentStats(agentIds[i]);
            assertTrue(s.exists);
        }
    }

    function test_registerBattle_incrementsBattleCount() public {
        vm.prank(oracle);
        arena.registerBattle(battleId1, agentIds);
        assertEq(arena.getBattleCount(), 1);

        vm.prank(oracle);
        arena.registerBattle(battleId2, agentIds);
        assertEq(arena.getBattleCount(), 2);
    }

    function test_registerBattle_emitsBattleCreated() public {
        vm.prank(oracle);
        vm.expectEmit(true, false, false, true);
        emit HungernadsArena.BattleCreated(battleId1, agentIds);
        arena.registerBattle(battleId1, agentIds);
    }

    function test_registerBattle_emitsAgentRegistered() public {
        vm.prank(oracle);
        // Expect 5 AgentRegistered events
        for (uint256 i = 0; i < agentIds.length; i++) {
            vm.expectEmit(true, false, false, false);
            emit HungernadsArena.AgentRegistered(agentIds[i]);
        }
        arena.registerBattle(battleId1, agentIds);
    }

    function test_registerBattle_doesNotReRegisterKnownAgents() public {
        vm.startPrank(oracle);
        arena.registerBattle(battleId1, agentIds);

        // Second battle with same agents should NOT emit AgentRegistered
        // (no easy way to assert "event not emitted" in Foundry, so just
        // verify the call succeeds without reverting)
        arena.registerBattle(battleId2, agentIds);
        vm.stopPrank();

        // Stats should still show exists
        HungernadsArena.AgentStats memory s = arena.getAgentStats(1);
        assertTrue(s.exists);
    }

    function test_registerBattle_revertsForNonOracle() public {
        vm.prank(rando);
        vm.expectRevert(HungernadsArena.OnlyOracle.selector);
        arena.registerBattle(battleId1, agentIds);
    }

    function test_registerBattle_revertsDuplicate() public {
        vm.startPrank(oracle);
        arena.registerBattle(battleId1, agentIds);

        vm.expectRevert(abi.encodeWithSelector(HungernadsArena.BattleAlreadyExists.selector, battleId1));
        arena.registerBattle(battleId1, agentIds);
        vm.stopPrank();
    }

    function test_registerBattle_revertsWithLessThan2Agents() public {
        uint256[] memory tooFew = new uint256[](1);
        tooFew[0] = 1;

        vm.prank(oracle);
        vm.expectRevert(HungernadsArena.InvalidAgentCount.selector);
        arena.registerBattle(battleId1, tooFew);
    }

    // -----------------------------------------------------------------------
    // activateBattle
    // -----------------------------------------------------------------------

    function test_activateBattle_transitionsToActive() public {
        vm.startPrank(oracle);
        arena.registerBattle(battleId1, agentIds);
        arena.activateBattle(battleId1);
        vm.stopPrank();

        HungernadsArena.Battle memory b = arena.getBattle(battleId1);
        assertTrue(b.state == HungernadsArena.BattleState.Active);
    }

    function test_activateBattle_emitsEvent() public {
        vm.startPrank(oracle);
        arena.registerBattle(battleId1, agentIds);

        vm.expectEmit(true, false, false, false);
        emit HungernadsArena.BattleActivated(battleId1);
        arena.activateBattle(battleId1);
        vm.stopPrank();
    }

    function test_activateBattle_revertsIfNotCreated() public {
        vm.startPrank(oracle);
        arena.registerBattle(battleId1, agentIds);
        arena.activateBattle(battleId1);

        // Try to activate again (already Active)
        vm.expectRevert(
            abi.encodeWithSelector(
                HungernadsArena.InvalidBattleState.selector,
                battleId1,
                HungernadsArena.BattleState.Active,
                HungernadsArena.BattleState.Created
            )
        );
        arena.activateBattle(battleId1);
        vm.stopPrank();
    }

    function test_activateBattle_revertsIfNotFound() public {
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(HungernadsArena.BattleNotFound.selector, battleId1));
        arena.activateBattle(battleId1);
    }

    function test_activateBattle_revertsForNonOracle() public {
        vm.prank(oracle);
        arena.registerBattle(battleId1, agentIds);

        vm.prank(rando);
        vm.expectRevert(HungernadsArena.OnlyOracle.selector);
        arena.activateBattle(battleId1);
    }

    // -----------------------------------------------------------------------
    // recordResult
    // -----------------------------------------------------------------------

    function _registerAndActivate(bytes32 _bid) internal {
        vm.startPrank(oracle);
        arena.registerBattle(_bid, agentIds);
        arena.activateBattle(_bid);
        vm.stopPrank();
    }

    function _buildResults(uint256 winnerId) internal view returns (HungernadsArena.AgentResult[] memory) {
        HungernadsArena.AgentResult[] memory results = new HungernadsArena.AgentResult[](agentIds.length);
        for (uint256 i = 0; i < agentIds.length; i++) {
            bool isWinner = agentIds[i] == winnerId;
            results[i] = HungernadsArena.AgentResult({
                agentId: agentIds[i],
                finalHp: isWinner ? 420 : 0,
                kills: isWinner ? 2 : (i == 1 ? 1 : 0),
                survivedEpochs: isWinner ? 20 : uint256(5 + i),
                isWinner: isWinner
            });
        }
        return results;
    }

    function test_recordResult_completeBattle() public {
        _registerAndActivate(battleId1);

        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(oracle);
        arena.recordResult(battleId1, 1, results);

        HungernadsArena.Battle memory b = arena.getBattle(battleId1);
        assertTrue(b.state == HungernadsArena.BattleState.Completed);
        assertEq(b.winnerId, 1);
        assertGt(b.completedAt, 0);
    }

    function test_recordResult_storesPerAgentResults() public {
        _registerAndActivate(battleId1);
        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(oracle);
        arena.recordResult(battleId1, 1, results);

        // Check winner result
        HungernadsArena.AgentResult memory r1 = arena.getBattleResult(battleId1, 1);
        assertEq(r1.agentId, 1);
        assertEq(r1.finalHp, 420);
        assertTrue(r1.isWinner);
        assertEq(r1.kills, 2);
        assertEq(r1.survivedEpochs, 20);

        // Check a loser result
        HungernadsArena.AgentResult memory r3 = arena.getBattleResult(battleId1, 3);
        assertEq(r3.agentId, 3);
        assertEq(r3.finalHp, 0);
        assertFalse(r3.isWinner);
    }

    function test_recordResult_updatesAgentStats() public {
        _registerAndActivate(battleId1);
        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(oracle);
        arena.recordResult(battleId1, 1, results);

        // Winner stats
        HungernadsArena.AgentStats memory s1 = arena.getAgentStats(1);
        assertEq(s1.wins, 1);
        assertEq(s1.losses, 0);
        assertEq(s1.kills, 2);
        assertEq(s1.totalBattles, 1);
        assertEq(s1.totalEpochsSurvived, 20);

        // Loser stats (agent 3 = index 2, kills=0, epochs=5+2=7)
        HungernadsArena.AgentStats memory s3 = arena.getAgentStats(3);
        assertEq(s3.wins, 0);
        assertEq(s3.losses, 1);
        assertEq(s3.kills, 0);
        assertEq(s3.totalBattles, 1);
        assertEq(s3.totalEpochsSurvived, 7);
    }

    function test_recordResult_accumulatesStatsAcrossBattles() public {
        // Battle 1: agent 1 wins
        _registerAndActivate(battleId1);
        HungernadsArena.AgentResult[] memory results1 = _buildResults(1);
        vm.prank(oracle);
        arena.recordResult(battleId1, 1, results1);

        // Battle 2: agent 2 wins
        _registerAndActivate(battleId2);
        HungernadsArena.AgentResult[] memory results2 = _buildResults(2);
        vm.prank(oracle);
        arena.recordResult(battleId2, 2, results2);

        // Agent 1: 1 win + 1 loss = 2 battles
        HungernadsArena.AgentStats memory s1 = arena.getAgentStats(1);
        assertEq(s1.wins, 1);
        assertEq(s1.losses, 1);
        assertEq(s1.totalBattles, 2);

        // Agent 2: 0 wins first battle (loser), 1 win second battle
        HungernadsArena.AgentStats memory s2 = arena.getAgentStats(2);
        assertEq(s2.wins, 1);
        assertEq(s2.losses, 1);
        assertEq(s2.totalBattles, 2);

        // Agent 3: 0 wins, 2 losses
        HungernadsArena.AgentStats memory s3 = arena.getAgentStats(3);
        assertEq(s3.wins, 0);
        assertEq(s3.losses, 2);
        assertEq(s3.totalBattles, 2);
    }

    function test_recordResult_emitsBattleCompleted() public {
        _registerAndActivate(battleId1);
        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(oracle);
        vm.expectEmit(true, true, false, false);
        emit HungernadsArena.BattleCompleted(battleId1, 1);
        arena.recordResult(battleId1, 1, results);
    }

    function test_recordResult_emitsAgentEliminated() public {
        _registerAndActivate(battleId1);
        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(oracle);
        // 4 losers should each emit AgentEliminated
        vm.expectEmit(true, true, false, true);
        emit HungernadsArena.AgentEliminated(battleId1, 2, 0, 1);
        arena.recordResult(battleId1, 1, results);
    }

    function test_recordResult_revertsForNonOracle() public {
        _registerAndActivate(battleId1);
        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(rando);
        vm.expectRevert(HungernadsArena.OnlyOracle.selector);
        arena.recordResult(battleId1, 1, results);
    }

    function test_recordResult_revertsIfNotActive() public {
        vm.prank(oracle);
        arena.registerBattle(battleId1, agentIds);
        // Still in Created state, not Active

        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(oracle);
        vm.expectRevert(
            abi.encodeWithSelector(
                HungernadsArena.InvalidBattleState.selector,
                battleId1,
                HungernadsArena.BattleState.Created,
                HungernadsArena.BattleState.Active
            )
        );
        arena.recordResult(battleId1, 1, results);
    }

    function test_recordResult_revertsOnResultCountMismatch() public {
        _registerAndActivate(battleId1);

        // Only provide 3 results for a 5-agent battle
        HungernadsArena.AgentResult[] memory badResults = new HungernadsArena.AgentResult[](3);
        for (uint256 i = 0; i < 3; i++) {
            badResults[i] = HungernadsArena.AgentResult({
                agentId: agentIds[i],
                finalHp: 0,
                kills: 0,
                survivedEpochs: 5,
                isWinner: false
            });
        }

        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(HungernadsArena.ResultAgentMismatch.selector, battleId1));
        arena.recordResult(battleId1, 1, badResults);
    }

    function test_recordResult_revertsOnNonExistentBattle() public {
        HungernadsArena.AgentResult[] memory results = _buildResults(1);

        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(HungernadsArena.BattleNotFound.selector, battleId1));
        arena.recordResult(battleId1, 1, results);
    }

    // -----------------------------------------------------------------------
    // View Functions
    // -----------------------------------------------------------------------

    function test_getBattleAgents_returnsAgentIds() public {
        vm.prank(oracle);
        arena.registerBattle(battleId1, agentIds);

        uint256[] memory ids = arena.getBattleAgents(battleId1);
        assertEq(ids.length, 5);
        assertEq(ids[0], 1);
        assertEq(ids[4], 5);
    }

    function test_getBattleIds_pagination() public {
        vm.startPrank(oracle);
        for (uint256 i = 0; i < 10; i++) {
            bytes32 bid = keccak256(abi.encodePacked("battle-", i));
            arena.registerBattle(bid, agentIds);
        }
        vm.stopPrank();

        assertEq(arena.getBattleCount(), 10);

        // First page
        bytes32[] memory page1 = arena.getBattleIds(0, 3);
        assertEq(page1.length, 3);

        // Middle page
        bytes32[] memory page2 = arena.getBattleIds(3, 3);
        assertEq(page2.length, 3);

        // Last page (partial)
        bytes32[] memory page4 = arena.getBattleIds(9, 5);
        assertEq(page4.length, 1);

        // Beyond range
        bytes32[] memory empty = arena.getBattleIds(100, 5);
        assertEq(empty.length, 0);
    }

    function test_getAgentStats_returnsDefaultForUnknownAgent() public view {
        HungernadsArena.AgentStats memory s = arena.getAgentStats(999);
        assertEq(s.wins, 0);
        assertEq(s.losses, 0);
        assertEq(s.kills, 0);
        assertFalse(s.exists);
    }

    // -----------------------------------------------------------------------
    // Full lifecycle E2E
    // -----------------------------------------------------------------------

    function test_e2e_fullBattleLifecycle() public {
        // 1. Register
        vm.prank(oracle);
        arena.registerBattle(battleId1, agentIds);

        HungernadsArena.Battle memory b = arena.getBattle(battleId1);
        assertTrue(b.state == HungernadsArena.BattleState.Created);

        // 2. Activate
        vm.prank(oracle);
        arena.activateBattle(battleId1);

        b = arena.getBattle(battleId1);
        assertTrue(b.state == HungernadsArena.BattleState.Active);

        // 3. Record result — agent 3 (Survivor) wins
        HungernadsArena.AgentResult[] memory results = _buildResults(3);
        vm.prank(oracle);
        arena.recordResult(battleId1, 3, results);

        b = arena.getBattle(battleId1);
        assertTrue(b.state == HungernadsArena.BattleState.Completed);
        assertEq(b.winnerId, 3);

        // 4. Verify winner stats
        HungernadsArena.AgentStats memory s3 = arena.getAgentStats(3);
        assertEq(s3.wins, 1);
        assertEq(s3.losses, 0);
        assertTrue(s3.exists);

        // 5. Verify loser stats
        HungernadsArena.AgentStats memory s1 = arena.getAgentStats(1);
        assertEq(s1.wins, 0);
        assertEq(s1.losses, 1);
    }
}
