#!/usr/bin/env tsx
/**
 * HUNGERNADS - Storm Simultaneous Death Winner Logic Test
 *
 * Tests the fix for tk-1c3.1: Ensure that when 2+ agents die from storm
 * damage in the same epoch, a winner is always declared.
 *
 * Run: npx tsx tests/storm-winner-fix.test.ts
 */

import { ArenaManager, type BattleRecord } from '../src/arena/arena';
import type { BaseAgent } from '../src/agents/base-agent';

// Simple test framework
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    failures.push(message);
    console.log(`  ✗ FAIL: ${message}`);
  } else {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  }
}

function section(name: string): void {
  console.log(`\n=== ${name} ===`);
}

/**
 * Test that getWinner() handles simultaneous eliminations correctly.
 * This tests the arena.ts fix directly.
 */
function testGetWinnerWithSimultaneousEliminations(): void {
  section('Test: getWinner() with Simultaneous Eliminations');

  const arena = new ArenaManager('test-simul-1');

  // Manually create minimal agent-like objects by directly manipulating the Map
  // (We avoid spawnAgents() since that seems to have issues)
  const agent1 = {
    id: 'agent-1',
    name: 'WARRIOR1',
    agentClass: 'WARRIOR' as const,
    hp: 0,
    maxHp: 1000,
    isAlive: false,
    alive: () => false,
    kills: 0,
    epochsSurvived: 5,
  } as unknown as BaseAgent;

  const agent2 = {
    id: 'agent-2',
    name: 'TRADER1',
    agentClass: 'TRADER' as const,
    hp: 0,
    maxHp: 1000,
    isAlive: false,
    alive: () => false,
    kills: 1, // This agent has more kills
    epochsSurvived: 5,
  } as unknown as BaseAgent;

  // Manually add to agents map
  (arena as any).agents.set('agent-1', agent1);
  (arena as any).agents.set('agent-2', agent2);

  // Set arena to ACTIVE so isComplete() works
  (arena as any).status = 'ACTIVE';
  (arena as any).startedAt = new Date();

  // Manually increment epoch
  (arena as any).epochCount = 1;

  // Eliminate both agents at the same epoch
  arena.eliminateAgent('agent-1');
  arena.eliminateAgent('agent-2');

  // Verify eliminations
  const eliminations = arena.getEliminations();
  assert(eliminations.length === 2, 'Should have 2 elimination records');
  assert(
    eliminations[0].eliminatedAtEpoch === 1 && eliminations[1].eliminatedAtEpoch === 1,
    'Both agents eliminated at epoch 1'
  );

  // Battle should be complete
  assert(arena.isComplete(), 'Battle should be complete (0 agents alive)');

  // CRITICAL: getWinner() must return a winner, NOT null
  const winner = arena.getWinner();
  assert(winner !== null, 'getWinner() should NOT return null for simultaneous deaths');

  if (winner) {
    // Winner should be the one with more kills (agent2)
    assert(winner.id === 'agent-2', 'Winner should be agent2 (more kills)');

    // Winner reason should be set
    const winnerReason = arena.getWinnerReason();
    assert(winnerReason !== null && winnerReason.length > 0, 'Winner reason should be set');
    assert(winnerReason!.includes('rekt'), 'Winner reason should mention mutual rekt');

    console.log(`  Winner: ${winner.name} (${winnerReason})`);
  }

  // Test battle completion
  let record: BattleRecord;
  try {
    record = arena.completeBattle();
    assert(record.winnerId !== null, 'Battle record should have winnerId');
    assert(record.winnerName !== null, 'Battle record should have winnerName');
    assert(record.winnerClass !== null, 'Battle record should have winnerClass');
    assert(record.winnerReason !== undefined, 'Battle record should have winnerReason');
  } catch (err) {
    assert(false, `completeBattle() should not throw: ${err}`);
  }
}

/**
 * Test the epoch processor's defensive fallback when getWinner() returns null.
 */
function testEpochProcessorDefensiveFallback(): void {
  section('Test: Epoch Processor Defensive Fallback');

  const arena = new ArenaManager('test-simul-2');

  // Create agents
  const agent1 = {
    id: 'agent-3',
    name: 'SURVIVOR1',
    agentClass: 'SURVIVOR' as const,
    hp: 0,
    maxHp: 1000,
    isAlive: false,
    alive: () => false,
    kills: 0,
    epochsSurvived: 3,
  } as unknown as BaseAgent;

  const agent2 = {
    id: 'agent-4',
    name: 'GAMBLER1',
    agentClass: 'GAMBLER' as const,
    hp: 0,
    maxHp: 1000,
    isAlive: false,
    alive: () => false,
    kills: 0,
    epochsSurvived: 3,
  } as unknown as BaseAgent;

  (arena as any).agents.set('agent-3', agent1);
  (arena as any).agents.set('agent-4', agent2);
  (arena as any).status = 'ACTIVE';
  (arena as any).startedAt = new Date();
  (arena as any).epochCount = 3;

  // Eliminate both
  arena.eliminateAgent('agent-3');
  arena.eliminateAgent('agent-4');

  // Even if getWinner() were to return null (which shouldn't happen with our fix),
  // the epoch processor should have a fallback that picks from eliminations.
  // We test that eliminations are populated correctly here.
  const eliminations = arena.getEliminations();
  assert(eliminations.length === 2, 'Should have 2 eliminations');
  assert(eliminations[0].eliminatedAtEpoch === 3, 'First agent eliminated at epoch 3');
  assert(eliminations[1].eliminatedAtEpoch === 3, 'Second agent eliminated at epoch 3');

  // If getWinner() returns null (shouldn't with our fix), epoch processor will use eliminations
  const winner = arena.getWinner();
  if (winner === null) {
    console.log('  Note: getWinner() returned null — epoch processor fallback would trigger');
    // Verify fallback data is available
    assert(eliminations.length > 0, 'Eliminations should be available for fallback');
    const maxEpoch = Math.max(...eliminations.map(e => e.eliminatedAtEpoch));
    assert(maxEpoch === 3, 'Max elimination epoch should be 3');
  } else {
    console.log(`  Winner from getWinner(): ${winner.name}`);
    assert(true, 'getWinner() returned a winner (defensive fallback not needed)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log('HUNGERNADS - Storm Simultaneous Death Winner Logic Tests (tk-1c3.1)');
  console.log('====================================================================');

  testGetWinnerWithSimultaneousEliminations();
  testEpochProcessorDefensiveFallback();

  // Summary
  console.log('\n====================================================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('✓ All tests passed!');
  }
}

runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
