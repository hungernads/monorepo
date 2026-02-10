#!/usr/bin/env tsx
/**
 * HUNGERNADS - End-to-End Battle Flow Tests
 *
 * Validates the full battle lifecycle:
 *   agents spawn -> epochs process -> predictions resolve -> combat works
 *   -> deaths detected -> winner found -> lessons extracted
 *
 * Run: npx tsx tests/battle-flow.test.ts
 */

import { ArenaManager } from '../src/arena/arena';
import { processEpoch, type EpochResult } from '../src/arena/epoch';
import { PriceFeed } from '../src/arena/price-feed';
import { resolvePredictions, type PredictionInput } from '../src/arena/prediction';
import { resolveCombat, applyBleed, type CombatAgentState } from '../src/arena/combat';
import { checkDeaths } from '../src/arena/death';
import {
  extractAllLessons,
  type BattleHistory,
  type AgentInfo,
  type LLMCall,
} from '../src/learning/lessons';
import type { MarketData, EpochActions, ArenaAgentState } from '../src/agents/schemas';
import type { DeathCause } from '../src/arena/death';

// ─── Test Utilities ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    failures.push(message);
    console.log(`  FAIL: ${message}`);
  } else {
    passed++;
    console.log(`  PASS: ${message}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message} (actual: ${actual}, expected: ${expected}, tolerance: ${tolerance})`);
}

function section(name: string): void {
  console.log(`\n--- ${name} ---`);
}

// ─── Simulated Price Feed ────────────────────────────────────────────────────

class SimulatedPriceFeed extends PriceFeed {
  private prices: Record<string, number> = {
    ETH: 2500,
    BTC: 52000,
    SOL: 110,
    MON: 0.80,
  };

  private callCount = 0;

  override async fetchPrices(): Promise<MarketData> {
    this.callCount++;
    const changes: Record<string, number> = { ETH: 0, BTC: 0, SOL: 0, MON: 0 };

    // Simulate controlled price movements for deterministic testing
    for (const asset of ['ETH', 'BTC', 'SOL', 'MON']) {
      // Alternate up/down based on call count for predictability
      const change = this.callCount % 2 === 0 ? 0.03 : -0.02;
      changes[asset] = change * 100;
      this.prices[asset] = this.prices[asset] * (1 + change);
    }

    return {
      prices: { ...this.prices } as Record<'ETH' | 'BTC' | 'SOL' | 'MON', number>,
      changes: changes as Record<'ETH' | 'BTC' | 'SOL' | 'MON', number>,
      timestamp: Date.now(),
    };
  }
}

// ─── Mock final words ────────────────────────────────────────────────────────

async function mockFinalWords(
  _agent: ArenaAgentState,
  _cause: DeathCause,
  _killerId?: string,
): Promise<string> {
  return 'The arena claims another...';
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Arena Manager
// ═══════════════════════════════════════════════════════════════════════════════

function testArenaManagerSpawn(): void {
  section('ArenaManager: Agent Spawning');

  const arena = new ArenaManager('test-battle-1');

  // Spawn default agents (5, one per class)
  arena.spawnAgents();
  const agents = arena.getAllAgents();

  assert(agents.length === 5, 'Should spawn 5 agents by default');

  const classes = agents.map(a => a.agentClass);
  assert(classes.includes('WARRIOR'), 'Should include WARRIOR');
  assert(classes.includes('TRADER'), 'Should include TRADER');
  assert(classes.includes('SURVIVOR'), 'Should include SURVIVOR');
  assert(classes.includes('PARASITE'), 'Should include PARASITE');
  assert(classes.includes('GAMBLER'), 'Should include GAMBLER');

  for (const agent of agents) {
    assert(agent.hp === 1000, `Agent ${agent.name} should start with 1000 HP`);
    assert(agent.maxHp === 1000, `Agent ${agent.name} should have maxHp 1000`);
    assert(agent.isAlive === true, `Agent ${agent.name} should be alive`);
    assert(agent.kills === 0, `Agent ${agent.name} should have 0 kills`);
    assert(agent.epochsSurvived === 0, `Agent ${agent.name} should have 0 epochs survived`);
  }

  // Cannot spawn twice
  let spawnError = false;
  try {
    arena.spawnAgents();
  } catch {
    spawnError = true;
  }
  assert(spawnError, 'Should throw if agents already spawned');
}

function testArenaManagerLifecycle(): void {
  section('ArenaManager: Battle Lifecycle');

  const arena = new ArenaManager('test-battle-2');
  arena.spawnAgents();

  assert(arena.status === 'PENDING', 'Initial status should be PENDING');

  // Test PENDING -> BETTING_OPEN -> ACTIVE flow
  arena.openBetting();
  assert(arena.status === 'BETTING_OPEN', 'After openBetting should be BETTING_OPEN');

  arena.startBattle();
  assert(arena.status === 'ACTIVE', 'After startBattle should be ACTIVE');
  assert(arena.startedAt !== null, 'startedAt should be set');

  // Test immediate start (skip betting)
  const arena2 = new ArenaManager('test-battle-3');
  arena2.spawnAgents();
  arena2.startBattleImmediate();
  assert(arena2.status === 'ACTIVE', 'startBattleImmediate should set ACTIVE');

  // Cannot start if not PENDING
  let startError = false;
  try {
    arena2.startBattleImmediate();
  } catch {
    startError = true;
  }
  assert(startError, 'Should throw if starting from non-PENDING state');
}

function testArenaManagerEpochIncrement(): void {
  section('ArenaManager: Epoch Increment');

  const arena = new ArenaManager('test-battle-4');
  arena.spawnAgents();
  arena.startBattleImmediate();

  assert(arena.epochCount === 0, 'Epoch count should start at 0');
  arena.incrementEpoch();
  assert(arena.epochCount === 1, 'Epoch count should be 1 after increment');
  arena.incrementEpoch();
  assert(arena.epochCount === 2, 'Epoch count should be 2 after second increment');
}

function testArenaManagerElimination(): void {
  section('ArenaManager: Agent Elimination');

  const arena = new ArenaManager('test-battle-5');
  arena.spawnAgents();
  arena.startBattleImmediate();
  arena.incrementEpoch();

  const agents = arena.getAllAgents();
  const victim = agents[0];

  // Kill an agent
  victim.hp = 0;
  victim.isAlive = false;
  arena.eliminateAgent(victim.id);

  const active = arena.getActiveAgents();
  assert(active.length === 4, 'Should have 4 active agents after elimination');
  assert(!active.some(a => a.id === victim.id), 'Eliminated agent should not be in active list');

  const eliminations = arena.getEliminations();
  assert(eliminations.length === 1, 'Should have 1 elimination record');
  assert(eliminations[0].agentId === victim.id, 'Elimination record should reference correct agent');
}

function testArenaManagerWinCondition(): void {
  section('ArenaManager: Win Condition');

  const arena = new ArenaManager('test-battle-6');
  arena.spawnAgents();
  arena.startBattleImmediate();
  arena.incrementEpoch();

  const agents = arena.getAllAgents();

  // Kill all but one
  for (let i = 1; i < agents.length; i++) {
    agents[i].hp = 0;
    agents[i].isAlive = false;
    arena.eliminateAgent(agents[i].id);
  }

  assert(arena.isComplete() === true, 'Battle should be complete with 1 agent alive');

  const winner = arena.getWinner();
  assert(winner !== null, 'Should have a winner');
  assert(winner!.id === agents[0].id, 'Winner should be the surviving agent');

  const record = arena.completeBattle();
  assert(record.status === 'COMPLETED', 'Battle record status should be COMPLETED');
  assert(record.winnerId === agents[0].id, 'Battle record winnerId should match');
  assert(record.epochCount === 1, 'Battle record should have correct epoch count');
  assert(record.roster.length === 5, 'Roster should contain all 5 agents');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Combat
// ═══════════════════════════════════════════════════════════════════════════════

function testCombatBasicAttack(): void {
  section('Combat: Basic Attack');

  const actions = new Map<string, EpochActions>();
  actions.set('attacker-1', {
    prediction: { asset: 'ETH', direction: 'UP', stake: 50 },
    attack: { target: 'defender-1', stake: 100 },
    reasoning: 'Attack!',
  });
  actions.set('defender-1', {
    prediction: { asset: 'BTC', direction: 'DOWN', stake: 30 },
    reasoning: 'Just predicting',
  });

  const agents = new Map<string, CombatAgentState>();
  agents.set('attacker-1', { hp: 500, isAlive: true });
  agents.set('defender-1', { hp: 400, isAlive: true });

  const { combatResults, defendCosts } = resolveCombat(actions, agents);

  assert(combatResults.length === 1, 'Should have 1 combat result');
  assert(defendCosts.length === 0, 'No defenders, no defend costs');

  const cr = combatResults[0];
  assert(cr.attackerId === 'attacker-1', 'Attacker should be attacker-1');
  assert(cr.targetId === 'defender-1', 'Target should be defender-1');
  assert(cr.defended === false, 'Target did not defend');
  assert(cr.hpTransfer === 100, 'Should steal 100 HP');
}

function testCombatDefendedAttack(): void {
  section('Combat: Defended Attack');

  const actions = new Map<string, EpochActions>();
  actions.set('attacker-1', {
    prediction: { asset: 'ETH', direction: 'UP', stake: 50 },
    attack: { target: 'defender-1', stake: 100 },
    reasoning: 'Attack!',
  });
  actions.set('defender-1', {
    prediction: { asset: 'BTC', direction: 'DOWN', stake: 30 },
    defend: true,
    reasoning: 'Defending!',
  });

  const agents = new Map<string, CombatAgentState>();
  agents.set('attacker-1', { hp: 500, isAlive: true });
  agents.set('defender-1', { hp: 400, isAlive: true });

  const { combatResults, defendCosts } = resolveCombat(actions, agents);

  assert(combatResults.length === 1, 'Should have 1 combat result');
  assert(defendCosts.length === 1, 'Should have 1 defend cost');

  const cr = combatResults[0];
  assert(cr.defended === true, 'Attack should be blocked');
  assert(cr.hpTransfer === -100, 'Attacker should lose 100 HP (negative transfer)');

  const dc = defendCosts[0];
  assert(dc.agentId === 'defender-1', 'Defend cost should be for defender');
  assert(dc.cost === Math.floor(400 * 0.05), 'Defend cost should be 5% of HP (20)');
}

function testCombatStakeClamping(): void {
  section('Combat: Stake Clamping');

  const actions = new Map<string, EpochActions>();
  actions.set('attacker-1', {
    prediction: { asset: 'ETH', direction: 'UP', stake: 50 },
    attack: { target: 'defender-1', stake: 999 }, // More than attacker HP
    reasoning: 'All in!',
  });
  actions.set('defender-1', {
    prediction: { asset: 'BTC', direction: 'DOWN', stake: 30 },
    reasoning: 'Chill',
  });

  const agents = new Map<string, CombatAgentState>();
  agents.set('attacker-1', { hp: 200, isAlive: true });
  agents.set('defender-1', { hp: 150, isAlive: true });

  const { combatResults } = resolveCombat(actions, agents);

  const cr = combatResults[0];
  assert(cr.attackStake === 200, 'Stake should be clamped to attacker HP (200)');
  assert(cr.hpTransfer === 150, 'Transfer should be clamped to target HP (150)');
}

function testBleed(): void {
  section('Combat: Bleed');

  const agents = new Map<string, CombatAgentState>();
  agents.set('agent-1', { hp: 1000, isAlive: true });
  agents.set('agent-2', { hp: 500, isAlive: true });
  agents.set('agent-3', { hp: 0, isAlive: false });

  const results = applyBleed(agents);

  assert(results.length === 2, 'Should only bleed alive agents');

  const r1 = results.find(r => r.agentId === 'agent-1')!;
  assert(r1.bleedAmount === 20, 'Bleed should be 2% of 1000 = 20');
  assert(r1.hpBefore === 1000, 'HP before should be 1000');
  assert(r1.hpAfter === 980, 'HP after should be 980');

  const r2 = results.find(r => r.agentId === 'agent-2')!;
  assert(r2.bleedAmount === 10, 'Bleed should be 2% of 500 = 10');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Predictions
// ═══════════════════════════════════════════════════════════════════════════════

function testPredictionCorrect(): void {
  section('Predictions: Correct Prediction');

  const predictions = new Map<string, PredictionInput>();
  predictions.set('agent-1', { asset: 'ETH', direction: 'UP', stake: 50 });

  const current: MarketData = {
    prices: { ETH: 2600, BTC: 52000, SOL: 110, MON: 0.8 },
    changes: { ETH: 4.0, BTC: 0, SOL: 0, MON: 0 },
    timestamp: Date.now(),
  };

  const previous: MarketData = {
    prices: { ETH: 2500, BTC: 52000, SOL: 110, MON: 0.8 },
    changes: { ETH: 0, BTC: 0, SOL: 0, MON: 0 },
    timestamp: Date.now() - 60000,
  };

  const results = resolvePredictions(predictions, current, previous);

  assert(results.length === 1, 'Should have 1 prediction result');
  assert(results[0].correct === true, 'Prediction should be correct (ETH went up)');
  assert(results[0].hpChange === 50, 'Correct prediction should give +stake HP');
  assert(results[0].asset === 'ETH', 'Asset should be ETH');
  assert(results[0].direction === 'UP', 'Direction should be UP');
}

function testPredictionWrong(): void {
  section('Predictions: Wrong Prediction');

  const predictions = new Map<string, PredictionInput>();
  predictions.set('agent-1', { asset: 'ETH', direction: 'UP', stake: 50 });

  const current: MarketData = {
    prices: { ETH: 2400, BTC: 52000, SOL: 110, MON: 0.8 },
    changes: { ETH: -4.0, BTC: 0, SOL: 0, MON: 0 },
    timestamp: Date.now(),
  };

  const previous: MarketData = {
    prices: { ETH: 2500, BTC: 52000, SOL: 110, MON: 0.8 },
    changes: { ETH: 0, BTC: 0, SOL: 0, MON: 0 },
    timestamp: Date.now() - 60000,
  };

  const results = resolvePredictions(predictions, current, previous);

  assert(results[0].correct === false, 'Prediction should be wrong (predicted UP, went DOWN)');
  assert(results[0].hpChange === -50, 'Wrong prediction should give -stake HP');
}

function testPredictionFlat(): void {
  section('Predictions: Flat Market');

  const predictions = new Map<string, PredictionInput>();
  predictions.set('agent-1', { asset: 'ETH', direction: 'UP', stake: 50 });

  const current: MarketData = {
    prices: { ETH: 2500.02, BTC: 52000, SOL: 110, MON: 0.8 },
    changes: { ETH: 0.001, BTC: 0, SOL: 0, MON: 0 },
    timestamp: Date.now(),
  };

  const previous: MarketData = {
    prices: { ETH: 2500, BTC: 52000, SOL: 110, MON: 0.8 },
    changes: { ETH: 0, BTC: 0, SOL: 0, MON: 0 },
    timestamp: Date.now() - 60000,
  };

  const results = resolvePredictions(predictions, current, previous);

  // Very small change < FLAT_THRESHOLD (0.01%) should be treated as flat
  assert(results[0].hpChange === 0, 'Flat market should give 0 HP change');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Death Detection
// ═══════════════════════════════════════════════════════════════════════════════

async function testDeathDetection(): Promise<void> {
  section('Death: Detection');

  const agents: ArenaAgentState[] = [
    { id: 'a1', name: 'Warrior', class: 'WARRIOR', hp: 0, maxHp: 1000, isAlive: true, kills: 0, epochsSurvived: 5 },
    { id: 'a2', name: 'Trader', class: 'TRADER', hp: 500, maxHp: 1000, isAlive: true, kills: 0, epochsSurvived: 5 },
  ];

  const combatResults = [
    { attackerId: 'a2', targetId: 'a1', attackStake: 200, defended: false, hpTransfer: 200 },
  ];

  const predictionResults = [
    { agentId: 'a1', correct: false, hpChange: -100 },
    { agentId: 'a2', correct: true, hpChange: 50 },
  ];

  const deaths = await checkDeaths(agents, combatResults, predictionResults, 5, mockFinalWords);

  assert(deaths.length === 1, 'Should detect 1 death');
  assert(deaths[0].agentId === 'a1', 'Dead agent should be a1');
  assert(deaths[0].agentName === 'Warrior', 'Dead agent name should be Warrior');
  assert(deaths[0].epoch === 5, 'Death epoch should be 5');
  assert(deaths[0].finalWords !== '', 'Should have final words');
}

async function testDeathNotDetectedForAlive(): Promise<void> {
  section('Death: No False Positives');

  const agents: ArenaAgentState[] = [
    { id: 'a1', name: 'Warrior', class: 'WARRIOR', hp: 100, maxHp: 1000, isAlive: true, kills: 0, epochsSurvived: 5 },
  ];

  const deaths = await checkDeaths(agents, [], [], 5, mockFinalWords);
  assert(deaths.length === 0, 'Should not detect death for alive agent');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Full Battle Flow (Integration)
// ═══════════════════════════════════════════════════════════════════════════════

async function testFullBattleFlow(): Promise<void> {
  section('Integration: Full Battle Flow');

  const maxEpochs = 10;
  const arena = new ArenaManager(crypto.randomUUID(), { maxEpochs, epochIntervalMs: 0 });

  // Step 1: Spawn
  arena.spawnAgents();
  assert(arena.getAllAgents().length === 5, 'Should have 5 agents after spawn');

  // Step 2: Start
  arena.startBattleImmediate();
  assert(arena.status === 'ACTIVE', 'Battle should be ACTIVE');

  // Step 3: Run epochs until completion or max
  const priceFeed = new SimulatedPriceFeed();
  const epochHistory: EpochResult[] = [];
  let previousMarketData: MarketData | undefined;

  // Suppress console noise from agent decisions
  const savedError = console.error;
  const savedWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};

  while (!arena.isComplete() && arena.epochCount < maxEpochs) {
    const result = await processEpoch(
      arena,
      priceFeed,
      previousMarketData,
      mockFinalWords,
    );
    epochHistory.push(result);
    previousMarketData = result.marketData;

    // Workaround for isAlive timing issue: make sure dead agents are eliminated
    for (const agentState of result.agentStates) {
      if (!agentState.isAlive) {
        const agent = arena.getAgent(agentState.id);
        if (agent && !agent.alive()) {
          try { arena.eliminateAgent(agentState.id); } catch { /* already recorded */ }
        }
      }
    }
  }

  console.error = savedError;
  console.warn = savedWarn;

  // Step 4: Validate results
  assert(epochHistory.length > 0, 'Should have run at least 1 epoch');
  assert(arena.epochCount > 0, 'Epoch count should be > 0');

  // Check epoch result structure
  const firstEpoch = epochHistory[0];
  assert(firstEpoch.epochNumber === 1, 'First epoch should be epoch 1');
  assert(firstEpoch.marketData !== undefined, 'Epoch should have market data');
  assert(firstEpoch.actions instanceof Map, 'Epoch should have actions map');
  assert(firstEpoch.predictionResults.length > 0, 'Should have prediction results');
  assert(firstEpoch.bleedResults.length > 0, 'Should have bleed results');
  assert(firstEpoch.agentStates.length === 5, 'Should have 5 agent states');

  // Check battle eventually ends (within maxEpochs)
  const aliveCount = arena.getActiveAgents().length;
  const battleEnded = aliveCount <= 1 || arena.epochCount >= maxEpochs;
  assert(battleEnded, 'Battle should end (1 alive or max epochs reached)');

  // Check agent states are consistent
  for (const agent of arena.getAllAgents()) {
    if (agent.alive()) {
      assert(agent.hp > 0, `Alive agent ${agent.name} should have HP > 0`);
    } else {
      assert(agent.hp <= 0, `Dead agent ${agent.name} should have HP <= 0`);
    }
  }

  // Step 5: Complete battle and get record
  let battleRecord;
  if (arena.status === 'ACTIVE') {
    battleRecord = arena.completeBattle();
    assert(battleRecord.status === 'COMPLETED', 'Battle record should be COMPLETED');
    assert(battleRecord.roster.length === 5, 'Roster should contain 5 agents');
  }

  console.log(`  (Battle ran ${arena.epochCount} epochs, ${aliveCount} alive at end)`);
}

async function testLessonExtraction(): Promise<void> {
  section('Integration: Lesson Extraction');

  // Run a small battle first
  const arena = new ArenaManager(crypto.randomUUID(), { maxEpochs: 10, epochIntervalMs: 0 });
  arena.spawnAgents();
  arena.startBattleImmediate();

  const priceFeed = new SimulatedPriceFeed();
  const epochHistory: EpochResult[] = [];
  let previousMarketData: MarketData | undefined;

  const savedError = console.error;
  const savedWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};

  // Run 5 epochs
  for (let i = 0; i < 5 && !arena.isComplete(); i++) {
    const result = await processEpoch(arena, priceFeed, previousMarketData, mockFinalWords);
    epochHistory.push(result);
    previousMarketData = result.marketData;

    for (const agentState of result.agentStates) {
      if (!agentState.isAlive) {
        try { arena.eliminateAgent(agentState.id); } catch { /* ok */ }
      }
    }
  }

  console.error = savedError;
  console.warn = savedWarn;

  // Extract lessons
  const agents = arena.getAllAgents();
  const agentInfos: AgentInfo[] = agents.map(a => ({
    id: a.id,
    name: a.name,
    class: a.agentClass,
  }));

  const battleHistory: BattleHistory = {
    battleId: arena.battleId,
    epochs: epochHistory,
  };

  const mockLLMCall: LLMCall = async () => {
    throw new Error('Mock mode');
  };

  const savedErr2 = console.error;
  console.error = () => {};
  const allLessons = await extractAllLessons(agentInfos, battleHistory, mockLLMCall);
  console.error = savedErr2;

  assert(allLessons instanceof Map, 'Lessons should be a Map');
  assert(allLessons.size > 0, 'Should have lessons for at least some agents');

  for (const [agentId, lessons] of allLessons) {
    assert(Array.isArray(lessons), `Lessons for ${agentId} should be an array`);
    for (const lesson of lessons) {
      assert(typeof lesson.context === 'string', 'Lesson should have context');
      assert(typeof lesson.learning === 'string', 'Lesson should have learning');
      assert(typeof lesson.battleId === 'string', 'Lesson should have battleId');
    }
  }

  console.log(`  (Extracted lessons for ${allLessons.size} agents)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Agent HP Management
// ═══════════════════════════════════════════════════════════════════════════════

function testAgentTakeDamage(): void {
  section('Agent: HP Management');

  const arena = new ArenaManager('test-hp');
  arena.spawnAgents();
  const agent = arena.getAllAgents()[0];

  assert(agent.hp === 1000, 'Agent starts with 1000 HP');

  const dmg = agent.takeDamage(200);
  assert(dmg === 200, 'takeDamage should return actual damage dealt');
  assert(agent.hp === 800, 'HP should be 800 after 200 damage');
  assert(agent.alive(), 'Agent should still be alive');

  // Damage exceeding HP
  const dmg2 = agent.takeDamage(900);
  assert(dmg2 === 800, 'takeDamage should cap at remaining HP');
  assert(agent.hp === 0, 'HP should be 0');
  assert(!agent.alive(), 'Agent should be dead');

  // Healing a dead agent should not work
  const healed = agent.heal(100);
  assert(healed === 0, 'Cannot heal a dead agent');
}

function testAgentHeal(): void {
  section('Agent: Healing');

  const arena = new ArenaManager('test-heal');
  arena.spawnAgents();
  const agent = arena.getAllAgents()[0];

  agent.takeDamage(500);
  assert(agent.hp === 500, 'HP should be 500');

  const healed = agent.heal(200);
  assert(healed === 200, 'Should heal 200');
  assert(agent.hp === 700, 'HP should be 700');

  // Cannot heal past maxHp
  const overHeal = agent.heal(500);
  assert(overHeal === 300, 'Over-heal should be capped to maxHp headroom');
  assert(agent.hp === 1000, 'HP should be capped at 1000');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

async function runAllTests(): Promise<void> {
  console.log('HUNGERNADS - Battle Flow Tests');
  console.log('==============================');

  // Arena Manager
  testArenaManagerSpawn();
  testArenaManagerLifecycle();
  testArenaManagerEpochIncrement();
  testArenaManagerElimination();
  testArenaManagerWinCondition();

  // Agent HP
  testAgentTakeDamage();
  testAgentHeal();

  // Combat
  testCombatBasicAttack();
  testCombatDefendedAttack();
  testCombatStakeClamping();
  testBleed();

  // Predictions
  testPredictionCorrect();
  testPredictionWrong();
  testPredictionFlat();

  // Death Detection
  await testDeathDetection();
  await testDeathNotDetectedForAlive();

  // Integration
  await testFullBattleFlow();
  await testLessonExtraction();

  // Summary
  console.log('\n==============================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed!');
  }
}

runAllTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
