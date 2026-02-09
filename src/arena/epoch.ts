/**
 * HUNGERNADS - Epoch Processor (Orchestrator)
 *
 * THE core game loop. Processes a single epoch by wiring together all engine
 * components in the correct order:
 *
 *   1. Fetch market data (PriceFeed)
 *   2. Collect agent decisions in parallel (BaseAgent.decide)
 *   2.5. Apply sponsor HP boosts (from tiered sponsorships)
 *   3. Resolve predictions (prediction.ts)
 *   4. Resolve combat (combat.ts) — with sponsor freeDefend + attackBoost
 *   5. Apply 2% bleed (combat.ts applyBleed)
 *   6. Check deaths (death.ts)
 *   7. Check win condition (ArenaManager)
 *   8. Generate epoch summary
 *   9. Return EpochResult for broadcasting
 *
 * All HP changes are applied in order: sponsor -> prediction -> combat -> bleed -> death.
 */

import type { BaseAgent } from '../agents/base-agent';
import { getDefaultActions } from '../agents/base-agent';
import type {
  EpochActions,
  HexCoord,
  MarketData,
  ArenaState,
  SkillActivation,
  AllianceEvent,
} from '../agents/schemas';
import { ALLIANCE_DURATION } from '../agents/schemas';
import {
  validateAndCorrect,
  buildSecretaryContext,
  type SecretaryResult,
} from '../agents/secretary';
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
import {
  validateMove,
  executeMove,
  type MoveResult,
} from './grid';
import type { SponsorEffect } from '../betting/sponsorship';
// ── Hex Grid & Item System ──
import {
  moveAgent as hexMoveAgent,
  getTile,
  isAdjacent as hexIsAdjacent,
  hexKey,
  getNeighborInDirection,
  isInGrid,
  hexEquals,
} from './hex-grid';
import type { HexGridState, HexCoord as HexGridCoord } from './hex-grid';
import {
  spawnItems,
  checkTraps,
  pickupItem,
  getPickupableItems,
  addItemsToGrid,
  removeItemFromTile,
} from './items';
import type {
  ItemPickupResult,
  TrapTriggerResult,
  BuffTickResult,
  ItemBuff,
} from './items';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of applying a sponsor HP boost to an agent. */
export interface SponsorBoostResult {
  agentId: string;
  tier: string;
  hpBoost: number;
  /** Actual HP gained (may be less than hpBoost if near max HP). */
  actualBoost: number;
  hpBefore: number;
  hpAfter: number;
  /** Whether this sponsor grants free defend. */
  freeDefend: boolean;
  /** Whether this sponsor grants an attack boost. */
  attackBoost: number;
  sponsorshipId: string;
  message: string;
}

export interface EpochResult {
  epochNumber: number;
  marketData: MarketData;
  actions: Map<string, EpochActions>;
  moveResults: MoveResult[];
  /** Item pickups this epoch (after movement). */
  itemPickups: ItemPickupResult[];
  /** Trap triggers this epoch (after movement). */
  trapTriggers: TrapTriggerResult[];
  /** Items spawned this epoch (after combat). */
  itemsSpawned: number;
  /** Detailed item spawn data for WebSocket broadcasting. */
  spawnedItems: { id: string; type: import('../arena/types/hex').ItemType; coord: { q: number; r: number }; epochNumber: number; isCornucopia: boolean }[];
  /** Buff tick results (expired/active buffs at end of epoch). */
  buffTicks: BuffTickResult[];
  /** Sponsor HP boosts applied this epoch (before predictions). */
  sponsorBoosts: SponsorBoostResult[];
  /** Skill activations this epoch (BERSERK, INSIDER_INFO, FORTIFY, SIPHON, ALL_IN). */
  skillActivations: SkillActivation[];
  /** Alliance events this epoch (proposals, formations, betrayals, breaks, expirations). */
  allianceEvents: AllianceEvent[];
  predictionResults: PredictionResult[];
  combatResults: CombatResult[];
  defendCosts: DefendCostResult[];
  bleedResults: BleedResult[];
  deaths: DeathEvent[];
  /** Secretary agent validation reports per agent (corrections, fuzzy matches, etc). */
  secretaryReports: Map<string, SecretaryResult>;
  agentStates: {
    id: string;
    name: string;
    class: string;
    hp: number;
    isAlive: boolean;
    thoughts: string[];
    position?: HexCoord;
    allyId?: string | null;
    allyName?: string | null;
    allianceEpochsRemaining?: number;
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
 * @param sponsorEffects - Optional sponsor effects for this epoch (from SponsorshipManager).
 *   If provided, HP boosts are applied before predictions, and combat modifiers
 *   (freeDefend, attackBoost) are passed to the combat resolver.
 */
export async function processEpoch(
  arena: ArenaManager,
  priceFeed: PriceFeed,
  previousMarketData?: MarketData,
  generateFinalWords?: GenerateFinalWords,
  sponsorEffects?: Map<string, SponsorEffect>,
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

  const { actionsMap: actions, secretaryReports } = await collectDecisions(activeAgents, arenaState);

  // ── Step 2b: Record reasoning as agent thoughts (for spectator feed) ──
  for (const agent of activeAgents) {
    const agentActions = actions.get(agent.id);
    if (agentActions?.reasoning) {
      agent.addThought(agentActions.reasoning);
    }
  }

  // ── Step 2c: Process movement actions (with hex grid sync) ──────────
  const moveResults = processMovements(actions, arena);

  // ── Step 2d: Item pickup phase (after movement, before combat) ──────
  const { itemPickups, trapTriggers } = processItemPickups(arena);

  // ── Step 2.5: Apply sponsor HP boosts ─────────────────────────────────
  const sponsorBoosts = applySponsorBoosts(arena, sponsorEffects);

  // ── Step 2.6: Activate skills ────────────────────────────────────────
  const skillActivations = activateSkills(actions, arena);

  // ── Step 2.7: Process alliance proposals and breaks ─────────────────
  const allianceEvents = processAlliances(actions, arena);

  // ── Step 3: Resolve predictions ───────────────────────────────────────
  const predictionInputs = buildPredictionInputs(actions, arena);
  const predictionResults = resolvePredictions(
    predictionInputs,
    marketData,
    prevMarket,
  );

  // Apply prediction HP changes to agents (with skill modifiers)
  for (const result of predictionResults) {
    const agent = arena.getAgent(result.agentId);
    if (!agent || !agent.alive()) continue;

    let hpChange = result.hpChange;

    // INSIDER_INFO: Trader's prediction always succeeds (force positive)
    if (agent.skillActiveThisEpoch && agent.getSkillDefinition().name === 'INSIDER_INFO') {
      hpChange = Math.abs(result.hpChange); // Force positive (gain even if wrong)
      // Mutate the result for broadcasting accuracy
      (result as { hpChange: number }).hpChange = hpChange;
    }

    // ALL_IN: Gambler's stake is doubled (both gain and loss)
    if (agent.skillActiveThisEpoch && agent.getSkillDefinition().name === 'ALL_IN') {
      hpChange = hpChange * 2;
      (result as { hpChange: number }).hpChange = hpChange;
    }

    // FORTIFY: Survivor takes no prediction losses (but still gains)
    if (agent.skillActiveThisEpoch && agent.getSkillDefinition().name === 'FORTIFY' && hpChange < 0) {
      hpChange = 0;
      (result as { hpChange: number }).hpChange = 0;
    }

    if (hpChange > 0) {
      agent.heal(hpChange);
    } else if (hpChange < 0) {
      agent.takeDamage(Math.abs(hpChange));
    }
  }

  // ── Step 4: Resolve combat ────────────────────────────────────────────
  // Resolve attack targets: actions use agent names, combat needs agent IDs
  const resolvedActions = resolveAttackTargets(actions, arena);

  // Build combat agent state map from current (post-prediction) HP
  // Includes active skills for BERSERK/FORTIFY modifiers in combat resolution
  const combatAgentStates = buildCombatAgentStates(arena);

  // Pass sponsor effects to combat resolver for freeDefend + attackBoost
  const { combatResults, defendCosts } = resolveCombat(
    resolvedActions,
    combatAgentStates,
    sponsorEffects,
  );

  // Apply defend costs (FORTIFY agents skip defend cost)
  for (const dc of defendCosts) {
    const agent = arena.getAgent(dc.agentId);
    if (agent && agent.alive()) {
      if (agent.skillActiveThisEpoch && agent.getSkillDefinition().name === 'FORTIFY') {
        // FORTIFY: immune to defend cost too
        continue;
      }
      agent.takeDamage(dc.cost);
    }
  }

  // Apply combat HP changes (triangle system)
  for (const cr of combatResults) {
    const attacker = arena.getAgent(cr.attackerId);
    const target = arena.getAgent(cr.targetId);

    // Apply attacker HP change
    if (attacker && attacker.alive()) {
      if (cr.hpChangeAttacker > 0) {
        attacker.heal(cr.hpChangeAttacker);
      } else if (cr.hpChangeAttacker < 0) {
        attacker.takeDamage(Math.abs(cr.hpChangeAttacker));
      }
    }

    // Apply target HP change
    if (target && target.alive()) {
      if (cr.hpChangeTarget > 0) {
        target.heal(cr.hpChangeTarget);
      } else if (cr.hpChangeTarget < 0) {
        target.takeDamage(Math.abs(cr.hpChangeTarget));
      }
    }

    // Handle betrayal: break alliance on both sides and emit event
    if (cr.betrayal && attacker && target) {
      attacker.breakCurrentAlliance();
      target.breakCurrentAlliance();
      allianceEvents.push({
        type: 'BETRAYED',
        agentId: cr.attackerId,
        agentName: attacker.name,
        partnerId: cr.targetId,
        partnerName: target.name,
        description: `BETRAYAL! ${attacker.name} stabbed their ally ${target.name} in the back for ${Math.abs(cr.hpChangeTarget)} damage (2x betrayal bonus)!`,
      });
      console.log(
        `[Alliance] BETRAYAL: ${attacker.name} attacked ally ${target.name}! Alliance broken, 2x damage applied.`,
      );
    }
  }

  // ── Step 4.5: Process SIPHON skill ─────────────────────────────────────
  processSiphonSkills(skillActivations, arena);

  // ── Step 4.6: Item spawn phase (after combat) ─────────────────────────
  const newItems = spawnItems(arena.grid, epochNumber);
  if (newItems.length > 0) {
    arena.updateGrid(addItemsToGrid(newItems, arena.grid));
    console.log(`[Items] Spawned ${newItems.length} items on epoch ${epochNumber}`);
  }
  const itemsSpawned = newItems.length;
  const spawnedItems = newItems.map(item => ({
    id: item.id,
    type: item.type,
    coord: { q: item.coord.q, r: item.coord.r },
    epochNumber: item.spawnedAtEpoch,
    isCornucopia: item.isCornucopia,
  }));

  // ── Step 4.7: Tick item buffs (decrement durations, remove expired) ───
  const buffTicks = arena.tickBuffs();

  // ── Step 5: Apply bleed ───────────────────────────────────────────────
  const bleedAgentStates = buildCombatAgentStates(arena);
  const bleedResults = applyBleed(bleedAgentStates);

  for (const br of bleedResults) {
    const agent = arena.getAgent(br.agentId);
    if (agent && agent.alive()) {
      // FORTIFY: immune to bleed
      if (agent.skillActiveThisEpoch && agent.getSkillDefinition().name === 'FORTIFY') {
        continue;
      }
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
    const deadAgent = arena.getAgent(death.agentId);

    // If the dead agent had an alliance, break it cleanly
    if (deadAgent && deadAgent.hasAlliance()) {
      const formerAllyId = deadAgent.allyId!;
      const formerAllyName = deadAgent.allyName!;
      deadAgent.breakCurrentAlliance();
      const partner = arena.getAgent(formerAllyId);
      if (partner) {
        partner.breakCurrentAlliance();
      }
      allianceEvents.push({
        type: 'BROKEN',
        agentId: death.agentId,
        agentName: deadAgent.name,
        partnerId: formerAllyId,
        partnerName: formerAllyName,
        description: `${deadAgent.name}'s death breaks the alliance with ${formerAllyName}. The pact dies with them.`,
      });
    }

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

  // ── Step 8.5: Tick skill cooldowns and reset active flags ────────────
  for (const agent of arena.getAllAgents()) {
    agent.tickSkillCooldown();
    agent.resetSkillActive();
  }

  // ── Step 8.6: Tick alliance durations ──────────────────────────────
  // Capture alliance info before ticking so we can emit proper expiration events
  const allianceSnapshot = new Map<string, { allyId: string; allyName: string; remaining: number }>();
  for (const agent of arena.getAllAgents()) {
    if (agent.alive() && agent.hasAlliance() && agent.allyId && agent.allyName) {
      allianceSnapshot.set(agent.id, {
        allyId: agent.allyId,
        allyName: agent.allyName,
        remaining: agent.allianceEpochsRemaining,
      });
    }
  }

  // Track which pairs we've already emitted expiration events for
  const expiredPairs = new Set<string>();
  for (const agent of arena.getAllAgents()) {
    if (!agent.alive()) continue;
    const expired = agent.tickAlliance();
    if (expired) {
      const snapshot = allianceSnapshot.get(agent.id);
      if (snapshot) {
        // Only emit once per pair (A-B, not B-A)
        const pairKey = [agent.id, snapshot.allyId].sort().join(':');
        if (!expiredPairs.has(pairKey)) {
          expiredPairs.add(pairKey);
          allianceEvents.push({
            type: 'EXPIRED',
            agentId: agent.id,
            agentName: agent.name,
            partnerId: snapshot.allyId,
            partnerName: snapshot.allyName,
            description: `Alliance expired: The non-aggression pact between ${agent.name} and ${snapshot.allyName} has ended. All bets are off.`,
            epochsRemaining: 0,
          });
          console.log(
            `[Alliance] EXPIRED: Pact between ${agent.name} and ${snapshot.allyName} has ended.`,
          );
        }
      }
    }
  }

  // ── Step 9: Build final agent states snapshot ─────────────────────────
  const agentStates = arena.getAllAgents().map(a => ({
    id: a.id,
    name: a.name,
    class: a.agentClass,
    hp: a.hp,
    isAlive: a.alive(),
    thoughts: [...a.thoughts],
    position: a.position ?? undefined,
    allyId: a.allyId,
    allyName: a.allyName,
    allianceEpochsRemaining: a.allianceEpochsRemaining,
  }));

  return {
    epochNumber,
    marketData,
    actions,
    moveResults,
    itemPickups,
    trapTriggers,
    itemsSpawned,
    spawnedItems,
    buffTicks,
    sponsorBoosts,
    skillActivations,
    allianceEvents,
    predictionResults,
    combatResults,
    defendCosts,
    bleedResults,
    deaths,
    secretaryReports,
    agentStates,
    battleComplete,
    winner,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Apply sponsor HP boosts to agents before predictions and combat.
 *
 * Iterates through sponsor effects for this epoch and heals each agent
 * by the tier's hpBoost amount (capped at maxHp). Returns an array of
 * SponsorBoostResult for broadcasting to spectators.
 *
 * Only HP boosts are applied here. Combat modifiers (freeDefend, attackBoost)
 * are handled by the combat resolver via the sponsorEffects map.
 */
function applySponsorBoosts(
  arena: ArenaManager,
  sponsorEffects?: Map<string, SponsorEffect>,
): SponsorBoostResult[] {
  const results: SponsorBoostResult[] = [];
  if (!sponsorEffects || sponsorEffects.size === 0) return results;

  for (const [agentId, effect] of sponsorEffects) {
    const agent = arena.getAgent(agentId);
    if (!agent || !agent.alive()) continue;
    if (effect.hpBoost <= 0) continue;

    const hpBefore = agent.hp;
    agent.heal(effect.hpBoost); // heal() is capped at maxHp internally
    const hpAfter = agent.hp;
    const actualBoost = hpAfter - hpBefore;

    results.push({
      agentId,
      tier: effect.tier,
      hpBoost: effect.hpBoost,
      actualBoost,
      hpBefore,
      hpAfter,
      freeDefend: effect.freeDefend,
      attackBoost: effect.attackBoost,
      sponsorshipId: effect.sponsorshipId,
      message: effect.message,
    });
  }

  return results;
}

/**
 * Collect decisions from all active agents in parallel, then run
 * secretary validation on each agent's actions.
 *
 * Flow per agent:
 *   1. agent.decide(arenaState)     — LLM + class enforcement
 *   2. validateAndCorrect(actions)  — Secretary validation + correction
 *   3. Return validated actions
 *
 * If an agent's decide() throws, fall back to safe default actions.
 * The secretary never blocks execution — it corrects and logs.
 */
async function collectDecisions(
  agents: BaseAgent[],
  arenaState: ArenaState,
): Promise<{ actionsMap: Map<string, EpochActions>; secretaryReports: Map<string, SecretaryResult> }> {
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      let rawActions: EpochActions;
      try {
        rawActions = await agent.decide(arenaState);
      } catch (err) {
        console.error(
          `[Epoch] Agent ${agent.name} (${agent.id}) decide() failed:`,
          err,
        );
        rawActions = getDefaultActions(agent);
      }

      // Run secretary validation
      const secretaryCtx = buildSecretaryContext(agent);
      const report = await validateAndCorrect(
        rawActions,
        secretaryCtx,
        arenaState,
        agent.llmKeys,
        false, // LLM correction disabled by default (can be enabled per-battle)
      );

      // Log corrections for debugging
      if (report.correctionCount > 0) {
        console.log(
          `[Secretary] ${agent.name}: ${report.correctionCount} correction(s) applied`,
          report.issues
            .filter(i => i.action !== 'KEPT')
            .map(i => `${i.field}: ${i.message}`)
            .join('; '),
        );
      }

      return { agentId: agent.id, actions: report.actions, report };
    }),
  );

  const actionsMap = new Map<string, EpochActions>();
  const secretaryReports = new Map<string, SecretaryResult>();
  for (const result of results) {
    if (result.status === 'fulfilled') {
      actionsMap.set(result.value.agentId, result.value.actions);
      secretaryReports.set(result.value.agentId, result.value.report);
    }
    // 'rejected' should never happen since we catch inside the async fn,
    // but handle defensively
  }

  return { actionsMap, secretaryReports };
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
 * Resolve combat targets from agent names to agent IDs.
 *
 * Handles both new combatTarget field and legacy attack.target field.
 * LLM outputs typically use agent NAMES; combat resolution needs IDs.
 *
 * If a target name cannot be resolved, the combat action is dropped.
 */
function resolveAttackTargets(
  actions: Map<string, EpochActions>,
  arena: ArenaManager,
): Map<string, EpochActions> {
  const resolved = new Map<string, EpochActions>();

  for (const [agentId, action] of actions) {
    // Determine if this action has a target to resolve
    const targetName = action.combatTarget ?? action.attack?.target;

    if (!targetName) {
      // No combat target — pass through as-is
      resolved.set(agentId, action);
      continue;
    }

    // Try to resolve by name first, then by ID as fallback
    const targetAgent =
      arena.getAgentByName(targetName) ?? arena.getAgent(targetName);

    if (!targetAgent || !targetAgent.alive() || targetAgent.id === agentId) {
      // Invalid target: drop combat action, keep everything else
      resolved.set(agentId, {
        ...action,
        combatStance: 'NONE',
        combatTarget: undefined,
        combatStake: undefined,
        attack: undefined,
      });
      continue;
    }

    // Replace name with ID for combat resolution
    resolved.set(agentId, {
      ...action,
      combatTarget: targetAgent.id,
      // Also update legacy field for backward compat
      attack: action.attack
        ? { target: targetAgent.id, stake: action.attack.stake }
        : undefined,
    });
  }

  return resolved;
}

/**
 * Process movement actions for all agents.
 *
 * Movement happens BEFORE predictions and combat, so agents can reposition
 * before fighting. Moves are validated for adjacency and occupancy.
 *
 * Dead agents and agents without a move action are skipped.
 * Collision handling: if two agents try to move to the same hex, both stay put.
 *
 * Also syncs movement with the 19-tile hex grid (arena.grid).
 */
function processMovements(
  actions: Map<string, EpochActions>,
  arena: ArenaManager,
): MoveResult[] {
  const results: MoveResult[] = [];
  const positions = arena.getAgentPositions();

  // If no positions assigned (backward compat), skip movement entirely
  if (positions.size === 0) return results;

  // Phase 1: Collect all intended moves and detect collisions
  const intendedMoves = new Map<string, { agentId: string; from: HexCoord; to: HexCoord }>();
  const targetCounts = new Map<string, string[]>(); // hexKey -> agentIds wanting to move there

  for (const [agentId, action] of actions) {
    if (!action.move) continue;

    const agent = arena.getAgent(agentId);
    if (!agent || !agent.alive()) continue;

    const from = positions.get(agentId);
    if (!from) continue;

    const to = action.move;
    const toKey = `${to.q},${to.r}`;

    intendedMoves.set(agentId, { agentId, from, to });
    const existing = targetCounts.get(toKey) ?? [];
    existing.push(agentId);
    targetCounts.set(toKey, existing);
  }

  // Phase 2: Mark collisions (2+ agents targeting the same hex -> all fail)
  const collisionAgents = new Set<string>();
  for (const [_toKey, agentIds] of targetCounts) {
    if (agentIds.length > 1) {
      for (const id of agentIds) {
        collisionAgents.add(id);
      }
    }
  }

  // Phase 3: Execute non-colliding moves
  for (const [agentId, move] of intendedMoves) {
    if (collisionAgents.has(agentId)) {
      // Collision: both agents stay put
      results.push({
        agentId,
        from: move.from,
        to: move.to,
        success: false,
        reason: 'Collision: another agent targeted the same hex',
      });
      continue;
    }

    const result = executeMove(agentId, move.to, positions);
    results.push(result);

    // Sync with hex grid and agent position
    if (result.success) {
      const agent = arena.getAgent(agentId);
      if (agent) {
        agent.position = { q: move.to.q, r: move.to.r };
        // Update the 19-tile hex grid
        arena.updateGrid(
          hexMoveAgent(agentId, move.from, move.to, arena.grid),
        );
      }
    }
  }

  return results;
}

/**
 * Process item pickups and trap triggers after movement.
 *
 * For each alive agent on a tile with items:
 * 1. Check for traps first (TRAP items trigger on entry)
 * 2. Pick up non-trap items (RATION, WEAPON, SHIELD, ORACLE)
 * 3. Apply HP changes and buffs
 */
function processItemPickups(
  arena: ArenaManager,
): { itemPickups: ItemPickupResult[]; trapTriggers: TrapTriggerResult[] } {
  const itemPickups: ItemPickupResult[] = [];
  const trapTriggers: TrapTriggerResult[] = [];

  for (const agent of arena.getActiveAgents()) {
    if (!agent.position) continue;

    // Check for traps first
    const trapResult = checkTraps(agent.id, agent.position, arena.grid);
    if (trapResult) {
      trapTriggers.push(trapResult);
      agent.takeDamage(trapResult.damage);
      // Remove consumed trap from grid
      arena.updateGrid(
        removeItemFromTile(trapResult.item.id, trapResult.item.coord, arena.grid),
      );
      console.log(`[Items] ${agent.name} triggered a TRAP at (${agent.position.q},${agent.position.r}) for ${trapResult.damage} damage!`);
    }

    // Pick up non-trap items on this tile
    const pickupable = getPickupableItems(agent.position, arena.grid);
    for (const item of pickupable) {
      if (!agent.alive()) break; // Agent may have died from trap

      const pickup = pickupItem(agent.id, item, agent.hp, agent.maxHp);
      itemPickups.push(pickup);

      // Apply HP change
      if (pickup.hpChange > 0) {
        agent.heal(pickup.hpChange);
      } else if (pickup.hpChange < 0) {
        agent.takeDamage(Math.abs(pickup.hpChange));
      }

      // Apply buff if present
      if (pickup.buff) {
        arena.addAgentBuff(agent.id, pickup.buff);
      }

      // Remove consumed item from grid
      arena.updateGrid(
        removeItemFromTile(item.id, item.coord, arena.grid),
      );

      console.log(`[Items] ${agent.name} picked up ${item.type} at (${item.coord.q},${item.coord.r}): ${pickup.effect}`);
    }
  }

  return { itemPickups, trapTriggers };
}

/**
 * Build the CombatAgentState map from current arena state.
 * combat.ts needs a Map<string, { hp, isAlive, agentClass, activeSkill }>.
 */
function buildCombatAgentStates(
  arena: ArenaManager,
): Map<string, CombatAgentState> {
  const states = new Map<string, CombatAgentState>();
  for (const agent of arena.getAllAgents()) {
    states.set(agent.id, {
      hp: agent.hp,
      isAlive: agent.alive(),
      agentClass: agent.agentClass,
      activeSkill: agent.skillActiveThisEpoch ? agent.getSkillDefinition().name : undefined,
      allyId: agent.allyId,
      position: agent.position,
    });
  }
  return states;
}

// ─── Alliance System Helpers ──────────────────────────────────────────────

/**
 * Process alliance proposals and explicit breaks from agent decisions.
 *
 * Alliance logic:
 * - An agent can propose an alliance with another agent by name.
 * - If both agents are free (no existing alliance) and the target is alive,
 *   the alliance forms immediately (auto-accept for hackathon drama).
 * - An agent can explicitly break their current alliance (no betrayal penalty).
 * - Max 1 alliance per agent. Duration: ALLIANCE_DURATION epochs.
 *
 * Returns an array of AllianceEvent for broadcasting to spectators.
 */
function processAlliances(
  actions: Map<string, EpochActions>,
  arena: ArenaManager,
): AllianceEvent[] {
  const events: AllianceEvent[] = [];

  // Step 1: Process explicit breaks first
  for (const [agentId, action] of actions) {
    if (!action.breakAlliance) continue;

    const agent = arena.getAgent(agentId);
    if (!agent || !agent.alive() || !agent.hasAlliance()) continue;

    const formerAllyId = agent.allyId!;
    const formerAllyName = agent.allyName!;

    // Break both sides
    agent.breakCurrentAlliance();
    const partner = arena.getAgent(formerAllyId);
    if (partner) {
      partner.breakCurrentAlliance();
    }

    events.push({
      type: 'BROKEN',
      agentId: agent.id,
      agentName: agent.name,
      partnerId: formerAllyId,
      partnerName: formerAllyName,
      description: `${agent.name} broke their non-aggression pact with ${formerAllyName}. Trust is dead.`,
    });

    console.log(
      `[Alliance] BROKEN: ${agent.name} broke alliance with ${formerAllyName}.`,
    );
  }

  // Step 2: Process proposals
  for (const [agentId, action] of actions) {
    if (!action.proposeAlliance) continue;

    const agent = arena.getAgent(agentId);
    if (!agent || !agent.alive()) continue;

    // Can't propose if already allied
    if (agent.hasAlliance()) {
      console.log(
        `[Alliance] ${agent.name} tried to propose alliance but already has one with ${agent.allyName}.`,
      );
      continue;
    }

    // Resolve target by name
    const targetName = action.proposeAlliance;
    const target = arena.getAgentByName(targetName) ?? arena.getAgent(targetName);

    if (!target || !target.alive() || target.id === agentId) {
      console.log(
        `[Alliance] ${agent.name} proposed alliance to "${targetName}" but target not found or invalid.`,
      );
      continue;
    }

    // Can't ally with someone who already has an alliance
    if (target.hasAlliance()) {
      events.push({
        type: 'PROPOSED',
        agentId: agent.id,
        agentName: agent.name,
        partnerId: target.id,
        partnerName: target.name,
        description: `${agent.name} proposed a non-aggression pact with ${target.name}, but ${target.name} is already allied with ${target.allyName}.`,
      });
      console.log(
        `[Alliance] REJECTED: ${agent.name} -> ${target.name} (target already allied with ${target.allyName}).`,
      );
      continue;
    }

    // Form the alliance on both sides
    const agentFormed = agent.formAlliance(target.id, target.name, ALLIANCE_DURATION);
    const targetFormed = target.formAlliance(agent.id, agent.name, ALLIANCE_DURATION);

    if (agentFormed && targetFormed) {
      events.push({
        type: 'FORMED',
        agentId: agent.id,
        agentName: agent.name,
        partnerId: target.id,
        partnerName: target.name,
        description: `ALLIANCE FORMED! ${agent.name} and ${target.name} have entered a non-aggression pact for ${ALLIANCE_DURATION} epochs. Will it hold?`,
        epochsRemaining: ALLIANCE_DURATION,
      });
      console.log(
        `[Alliance] FORMED: ${agent.name} <-> ${target.name} for ${ALLIANCE_DURATION} epochs.`,
      );
    } else {
      // Rollback if one side failed (shouldn't happen, but defensive)
      agent.breakCurrentAlliance();
      target.breakCurrentAlliance();
      console.warn(
        `[Alliance] Formation failed for ${agent.name} <-> ${target.name}. Rolled back.`,
      );
    }
  }

  return events;
}

// ─── Skill System Helpers ─────────────────────────────────────────────────

/**
 * Validate and activate skills from agent decisions.
 *
 * For each agent that requested useSkill=true, checks cooldown availability
 * and activates the skill. Returns an array of SkillActivation events for
 * broadcasting to spectators.
 *
 * Targeted skills (SIPHON) have their target resolved from name to ID.
 */
function activateSkills(
  actions: Map<string, EpochActions>,
  arena: ArenaManager,
): SkillActivation[] {
  const activations: SkillActivation[] = [];

  for (const [agentId, action] of actions) {
    if (!action.useSkill) continue;

    const agent = arena.getAgent(agentId);
    if (!agent || !agent.alive()) continue;

    // Attempt activation (checks cooldown internally)
    const activated = agent.activateSkill();
    if (!activated) {
      console.warn(
        `[Skill] ${agent.name} tried to use ${agent.getSkillDefinition().name} but it's on cooldown (${agent.skillCooldownRemaining} epochs)`,
      );
      continue;
    }

    const skill = agent.getSkillDefinition();

    // Resolve target for SIPHON
    let targetId: string | undefined;
    let targetName: string | undefined;
    if (skill.name === 'SIPHON' && action.skillTarget) {
      const targetAgent =
        arena.getAgentByName(action.skillTarget) ?? arena.getAgent(action.skillTarget);
      if (targetAgent && targetAgent.alive() && targetAgent.id !== agentId) {
        targetId = targetAgent.id;
        targetName = targetAgent.name;
      } else {
        // Invalid target — pick the highest HP agent as fallback
        const fallback = arena.getActiveAgents()
          .filter(a => a.id !== agentId)
          .sort((a, b) => b.hp - a.hp)[0];
        if (fallback) {
          targetId = fallback.id;
          targetName = fallback.name;
        }
      }
    }

    // Build activation event
    const effectDescription = buildSkillEffectDescription(skill.name, agent.name, targetName);
    activations.push({
      agentId: agent.id,
      agentName: agent.name,
      skillName: skill.name,
      targetId,
      targetName,
      effectDescription,
    });

    // Log for debugging
    console.log(`[Skill] ${agent.name} activated ${skill.name}!${targetName ? ` Target: ${targetName}` : ''}`);
  }

  return activations;
}

/**
 * Build a human-readable description of a skill effect for spectator feeds.
 */
function buildSkillEffectDescription(
  skillName: string,
  agentName: string,
  targetName?: string,
): string {
  switch (skillName) {
    case 'BERSERK':
      return `${agentName} goes BERSERK! Double ATTACK damage but takes 50% more damage this epoch!`;
    case 'INSIDER_INFO':
      return `${agentName} uses INSIDER INFO! Prediction automatically succeeds this epoch!`;
    case 'FORTIFY':
      return `${agentName} FORTIFIES! Immune to ALL damage this epoch!`;
    case 'SIPHON':
      return `${agentName} uses SIPHON on ${targetName ?? 'unknown'}! Stealing 10% of their HP!`;
    case 'ALL_IN':
      return `${agentName} goes ALL IN! Prediction stake DOUBLED - double or nothing!`;
    default:
      return `${agentName} activated ${skillName}!`;
  }
}

/**
 * Process SIPHON skill activations.
 *
 * SIPHON steals 10% of the target's current HP and adds it to the Parasite.
 * Processed after combat resolution so it stacks with other damage.
 */
function processSiphonSkills(
  skillActivations: SkillActivation[],
  arena: ArenaManager,
): void {
  for (const activation of skillActivations) {
    if (activation.skillName !== 'SIPHON') continue;
    if (!activation.targetId) continue;

    const agent = arena.getAgent(activation.agentId);
    const target = arena.getAgent(activation.targetId);
    if (!agent || !agent.alive() || !target || !target.alive()) continue;

    // Steal 10% of target's current HP
    const siphonAmount = Math.max(1, Math.floor(target.hp * 0.10));
    const actualDamage = target.takeDamage(siphonAmount);
    agent.heal(actualDamage);

    console.log(
      `[Skill] SIPHON: ${agent.name} stole ${actualDamage} HP from ${target.name} (${target.hp} HP remaining)`,
    );
  }
}
