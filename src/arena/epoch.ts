/**
 * HUNGERNADS - Epoch Processor (Orchestrator)
 *
 * THE core game loop. Processes a single epoch by wiring together all engine
 * components in the correct order:
 *
 *   1. Fetch market data (PriceFeed)
 *   2. Collect agent decisions in parallel (BaseAgent.decide)
 *   3. Resolve predictions (prediction.ts)
 *   4. Resolve combat (combat.ts)
 *   5. Apply 2% bleed (combat.ts applyBleed)
 *   6. Check deaths (death.ts)
 *   7. Check win condition (ArenaManager)
 *   8. Generate epoch summary
 *   9. Return EpochResult for broadcasting
 *
 * All HP changes are applied in order: prediction -> combat -> bleed -> death.
 */

import type { BaseAgent } from '../agents/base-agent';
import { getDefaultActions } from '../agents/base-agent';
import type {
  EpochActions,
  MarketData,
  ArenaState,
} from '../agents/schemas';
import { ArenaManager } from './arena';
import { PriceFeed } from './price-feed';
import {
  resolvePredictions,
  type PredictionInput,
  type PredictionResult,
} from './prediction';
import {
  resolveCombat,
  applyBleed,
  type CombatResult,
  type CombatAgentState,
  type BleedResult,
  type DefendCostResult,
} from './combat';
import {
  checkDeaths,
  type DeathEvent,
  type GenerateFinalWords,
} from './death';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EpochResult {
  epochNumber: number;
  marketData: MarketData;
  actions: Map<string, EpochActions>;
  predictionResults: PredictionResult[];
  combatResults: CombatResult[];
  defendCosts: DefendCostResult[];
  bleedResults: BleedResult[];
  deaths: DeathEvent[];
  agentStates: {
    id: string;
    name: string;
    class: string;
    hp: number;
    isAlive: boolean;
  }[];
  battleComplete: boolean;
  winner?: { id: string; name: string; class: string };
}

// ─── Default final words generator (no LLM needed) ─────────────────────────

const DEFAULT_FINAL_WORDS: GenerateFinalWords = async (agent, cause) => {
  const lines: Record<string, string[]> = {
    prediction: [
      'The market... it betrayed me...',
      'I should have gone the other way...',
      'My charts... were wrong...',
    ],
    combat: [
      'You fight without honor...',
      'I will be avenged...',
      'Tell them... I died fighting...',
    ],
    bleed: [
      'Time... is the cruelest enemy...',
      'The arena drains us all...',
      'Slowly... but surely...',
    ],
    multi: [
      'Everything hit at once...',
      'Death by a thousand cuts...',
      'They all came for me...',
    ],
  };

  const pool = lines[cause] ?? lines.multi;
  return pool[Math.floor(Math.random() * pool.length)];
};

// ─── Core Function ──────────────────────────────────────────────────────────

/**
 * Process a single epoch end-to-end.
 *
 * Takes an ArenaManager (for agent state and lifecycle), a PriceFeed (for
 * market data), and optionally previous market data (for prediction resolution).
 *
 * Returns an EpochResult with the full breakdown for broadcasting.
 *
 * @param arena - The ArenaManager with active battle state
 * @param priceFeed - PriceFeed instance for fetching current prices
 * @param previousMarketData - Market data from the previous epoch (needed for
 *   prediction resolution). If omitted (first epoch), predictions resolve as
 *   flat (no gain/loss).
 * @param generateFinalWords - Optional LLM callback for dramatic death speeches.
 *   Falls back to canned lines if not provided.
 */
export async function processEpoch(
  arena: ArenaManager,
  priceFeed: PriceFeed,
  previousMarketData?: MarketData,
  generateFinalWords?: GenerateFinalWords,
): Promise<EpochResult> {
  const finalWordsCallback = generateFinalWords ?? DEFAULT_FINAL_WORDS;

  // ── Step 0: Increment epoch ───────────────────────────────────────────
  arena.incrementEpoch();
  const epochNumber = arena.epochCount;

  // ── Step 1: Fetch market data ─────────────────────────────────────────
  const marketData = await priceFeed.fetchPrices();

  // Build previous market data fallback for the first epoch:
  // If no previous data, use current data so all changes = 0 (flat, no gain/loss).
  const prevMarket: MarketData = previousMarketData ?? {
    prices: { ...marketData.prices },
    changes: { ETH: 0, BTC: 0, SOL: 0, MON: 0 },
    timestamp: marketData.timestamp,
  };

  // ── Step 2: Collect agent decisions in parallel ───────────────────────
  const activeAgents = arena.getActiveAgents();

  const arenaState: ArenaState = {
    battleId: arena.battleId,
    epoch: epochNumber,
    agents: arena.getAllAgents().map(a => a.getState()),
    marketData,
  };

  const actions = await collectDecisions(activeAgents, arenaState);

  // ── Step 3: Resolve predictions ───────────────────────────────────────
  const predictionInputs = buildPredictionInputs(actions, arena);
  const predictionResults = resolvePredictions(
    predictionInputs,
    marketData,
    prevMarket,
  );

  // Apply prediction HP changes to agents
  for (const result of predictionResults) {
    const agent = arena.getAgent(result.agentId);
    if (!agent || !agent.alive()) continue;

    if (result.hpChange > 0) {
      agent.heal(result.hpChange);
    } else if (result.hpChange < 0) {
      agent.takeDamage(Math.abs(result.hpChange));
    }
  }

  // ── Step 4: Resolve combat ────────────────────────────────────────────
  // Resolve attack targets: actions use agent names, combat needs agent IDs
  const resolvedActions = resolveAttackTargets(actions, arena);

  // Build combat agent state map from current (post-prediction) HP
  const combatAgentStates = buildCombatAgentStates(arena);

  const { combatResults, defendCosts } = resolveCombat(
    resolvedActions,
    combatAgentStates,
  );

  // Apply defend costs
  for (const dc of defendCosts) {
    const agent = arena.getAgent(dc.agentId);
    if (agent && agent.alive()) {
      agent.takeDamage(dc.cost);
    }
  }

  // Apply combat HP transfers
  for (const cr of combatResults) {
    const attacker = arena.getAgent(cr.attackerId);
    const target = arena.getAgent(cr.targetId);

    if (cr.defended) {
      // Attacker loses HP, defender gains HP
      if (attacker && attacker.alive()) {
        attacker.takeDamage(Math.abs(cr.hpTransfer));
      }
      if (target && target.alive()) {
        target.heal(Math.abs(cr.hpTransfer));
      }
    } else {
      // Attacker steals HP from target
      if (target && target.alive()) {
        target.takeDamage(cr.hpTransfer);
      }
      if (attacker && attacker.alive()) {
        attacker.heal(cr.hpTransfer);
      }
    }
  }

  // ── Step 5: Apply bleed ───────────────────────────────────────────────
  const bleedAgentStates = buildCombatAgentStates(arena);
  const bleedResults = applyBleed(bleedAgentStates);

  for (const br of bleedResults) {
    const agent = arena.getAgent(br.agentId);
    if (agent && agent.alive()) {
      agent.takeDamage(br.bleedAmount);
    }
  }

  // ── Step 6: Check deaths ──────────────────────────────────────────────
  // Build the agent states array that death.ts expects (AgentState = ArenaAgentState)
  const agentStatesForDeath = arena.getAllAgents().map(a => a.getState());

  // death.ts PredictionResult is a subset of prediction.ts PredictionResult — compatible
  const deaths = await checkDeaths(
    agentStatesForDeath,
    combatResults,
    predictionResults,
    epochNumber,
    finalWordsCallback,
  );

  // Eliminate dead agents on the arena and track kills
  for (const death of deaths) {
    arena.eliminateAgent(death.agentId);

    // Credit kill to the killer if there was one
    if (death.killerId) {
      const killer = arena.getAgent(death.killerId);
      if (killer) {
        killer.kills += 1;
      }
    }
  }

  // ── Step 7: Increment epochsSurvived for living agents ────────────────
  for (const agent of arena.getActiveAgents()) {
    agent.epochsSurvived += 1;
  }

  // ── Step 8: Check win condition ───────────────────────────────────────
  const battleComplete = arena.isComplete();
  let winner: { id: string; name: string; class: string } | undefined;

  if (battleComplete) {
    const winnerAgent = arena.getWinner();
    if (winnerAgent) {
      winner = {
        id: winnerAgent.id,
        name: winnerAgent.name,
        class: winnerAgent.agentClass,
      };
    }
  }

  // ── Step 9: Build final agent states snapshot ─────────────────────────
  const agentStates = arena.getAllAgents().map(a => ({
    id: a.id,
    name: a.name,
    class: a.agentClass,
    hp: a.hp,
    isAlive: a.alive(),
  }));

  return {
    epochNumber,
    marketData,
    actions,
    predictionResults,
    combatResults,
    defendCosts,
    bleedResults,
    deaths,
    agentStates,
    battleComplete,
    winner,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Collect decisions from all active agents in parallel.
 * If an agent's decide() throws, fall back to safe default actions.
 */
async function collectDecisions(
  agents: BaseAgent[],
  arenaState: ArenaState,
): Promise<Map<string, EpochActions>> {
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      try {
        const actions = await agent.decide(arenaState);
        return { agentId: agent.id, actions };
      } catch (err) {
        console.error(
          `[Epoch] Agent ${agent.name} (${agent.id}) decide() failed:`,
          err,
        );
        return { agentId: agent.id, actions: getDefaultActions(agent) };
      }
    }),
  );

  const actionsMap = new Map<string, EpochActions>();
  for (const result of results) {
    if (result.status === 'fulfilled') {
      actionsMap.set(result.value.agentId, result.value.actions);
    }
    // 'rejected' should never happen since we catch inside the async fn,
    // but handle defensively
  }

  return actionsMap;
}

/**
 * Convert agent EpochActions predictions into PredictionInput map.
 *
 * The key conversion: EpochActions.prediction.stake is a PERCENTAGE (5-50),
 * but PredictionInput.stake is ABSOLUTE HP. So we compute:
 *   absoluteStake = floor(agent.hp * (stake / 100))
 */
function buildPredictionInputs(
  actions: Map<string, EpochActions>,
  arena: ArenaManager,
): Map<string, PredictionInput> {
  const inputs = new Map<string, PredictionInput>();

  for (const [agentId, action] of actions) {
    const agent = arena.getAgent(agentId);
    if (!agent || !agent.alive()) continue;

    const { asset, direction, stake: stakePercent } = action.prediction;

    // Clamp stake to valid range (5-50%) and convert to absolute HP
    const clampedPercent = Math.max(5, Math.min(50, stakePercent));
    const absoluteStake = Math.floor(agent.hp * (clampedPercent / 100));

    if (absoluteStake <= 0) continue; // Agent has too little HP to stake

    inputs.set(agentId, {
      asset,
      direction,
      stake: absoluteStake,
    });
  }

  return inputs;
}

/**
 * Resolve attack targets from agent names to agent IDs.
 *
 * EpochActions.attack.target is typically an agent NAME (from LLM output).
 * Combat resolution needs agent IDs. This function creates a new actions map
 * with resolved target IDs.
 *
 * If a target name cannot be resolved, the attack is dropped.
 */
function resolveAttackTargets(
  actions: Map<string, EpochActions>,
  arena: ArenaManager,
): Map<string, EpochActions> {
  const resolved = new Map<string, EpochActions>();

  for (const [agentId, action] of actions) {
    if (!action.attack) {
      // No attack — pass through as-is
      resolved.set(agentId, action);
      continue;
    }

    const targetName = action.attack.target;

    // Try to resolve by name first, then by ID as fallback
    const targetAgent =
      arena.getAgentByName(targetName) ?? arena.getAgent(targetName);

    if (!targetAgent || !targetAgent.alive() || targetAgent.id === agentId) {
      // Invalid target: drop the attack, keep everything else
      resolved.set(agentId, {
        ...action,
        attack: undefined,
      });
      continue;
    }

    // Replace name with ID for combat resolution
    resolved.set(agentId, {
      ...action,
      attack: {
        target: targetAgent.id,
        stake: action.attack.stake,
      },
    });
  }

  return resolved;
}

/**
 * Build the CombatAgentState map from current arena state.
 * combat.ts needs a Map<string, { hp: number, isAlive: boolean }>.
 */
function buildCombatAgentStates(
  arena: ArenaManager,
): Map<string, CombatAgentState> {
  const states = new Map<string, CombatAgentState>();
  for (const agent of arena.getAllAgents()) {
    states.set(agent.id, {
      hp: agent.hp,
      isAlive: agent.alive(),
    });
  }
  return states;
}
