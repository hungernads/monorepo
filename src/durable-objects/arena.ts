/**
 * HUNGERNADS - Arena Durable Object
 *
 * Manages a single battle instance. Coordinates epochs, resolves
 * combat, tracks HP, and broadcasts state to spectators via WebSocket.
 *
 * Uses the Cloudflare Durable Objects Hibernation API for WebSockets
 * to minimize costs during idle periods between epochs.
 *
 * Epoch processing is wired to the real arena engine:
 *   - ArenaManager + BaseAgent instances are reconstructed from storage
 *   - processEpoch() from arena/epoch.ts runs the full game loop
 *   - Results are synced back to durable storage and broadcast to spectators
 */

import type { Env } from '../index';
import type { AgentClass, AgentState, EpochActions, MarketData } from '../agents';
import { getLLM, type LLMKeys } from '../llm';
import {
  type BattleEvent,
  broadcastEvent,
  broadcastEvents,
  epochToEvents,
  curveEventToBattleEvent,
  gridStateToEvent,
} from '../api/websocket';
import { createNadFunClient, NadFunClient, type CurveStream } from '../chain/nadfun';
import { type Address, createWalletClient, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ArenaManager, computePhaseConfig, type PhaseConfig } from '../arena/arena';
import { processEpoch as runEpoch, type EpochResult } from '../arena/epoch';
import type { BattlePhase } from '../arena/types/status';
import { PriceFeed } from '../arena/price-feed';
import { createGrid, placeAgent, getStormTileCoords, getOuterRingTiles } from '../arena/hex-grid';
import { getCurrentPhase } from '../arena/phases';
import { WarriorAgent } from '../agents/warrior';
import { TraderAgent } from '../agents/trader';
import { SurvivorAgent } from '../agents/survivor';
import { ParasiteAgent } from '../agents/parasite';
import { GamblerAgent } from '../agents/gambler';
import type { BaseAgent } from '../agents/base-agent';
import { BettingPool, DEFAULT_BETTING_LOCK_AFTER_EPOCH } from '../betting/pool';
import type { BettingPhase } from '../betting/pool';
import { SponsorshipManager } from '../betting/sponsorship';
import { updateBattle } from '../db/schema';
import { createChainClient, monadTestnet, type AgentResult as ChainAgentResult } from '../chain/client';
import { createMoltbookPoster } from '../moltbook';
import { RatingManager, extractBattlePerformances } from '../ranking';
import { AgentMemory } from '../learning/memory';

// Re-export BattleEvent for consumers that import from arena.ts
export type { BattleEvent } from '../api/websocket';

import type { BattleStatus } from '../arena/types/status';
export type { BattleStatus } from '../arena/types/status';

// ─── Types ────────────────────────────────────────────────────────

export interface BattleAgent {
  id: string;
  name: string;
  class: AgentClass;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  kills: number;
  epochsSurvived: number;
  /** Rolling buffer of the agent's recent LLM reasoning snippets. */
  thoughts: string[];
  /** Agent's hex position on the grid (null if not yet placed). */
  position: { q: number; r: number } | null;
  /** Ephemeral private key for on-chain token trades (0x-prefixed hex). */
  privateKey?: string;
  /** Derived wallet address for on-chain trades (cached from privateKey). */
  walletAddress?: string;
}

/** Per-battle configuration passed from POST /battle/create. */
export interface BattleConfig {
  /** Max epochs before timeout. Computed dynamically from agent count via computePhaseConfig(). */
  maxEpochs: number;
  /** Epochs to keep betting open (default DEFAULT_BETTING_LOCK_AFTER_EPOCH). */
  bettingWindowEpochs: number;
  /** Which assets agents can predict on (default all four). */
  assets: string[];
  /** Entry fee in MON (e.g. '0.01'). Defaults to '0' (free). */
  feeAmount: string;
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  maxEpochs: 8, // Default for 5 agents (overridden by computePhaseConfig at battle start)
  bettingWindowEpochs: DEFAULT_BETTING_LOCK_AFTER_EPOCH,
  assets: ['ETH', 'BTC', 'SOL', 'MON'],
  feeAmount: '0',
};

export interface BattleState {
  battleId: string;
  status: BattleStatus;
  epoch: number;
  agents: Record<string, BattleAgent>;
  startedAt: string | null;
  completedAt: string | null;
  winnerId: string | null;
  /** Betting lifecycle phase: OPEN -> LOCKED -> SETTLED. */
  bettingPhase: BettingPhase;
  /** Per-battle configuration. */
  config: BattleConfig;
  /** ISO timestamp when countdown ends (set when 5th agent joins). */
  countdownEndsAt: string | null;
  /** Current battle phase (only present during ACTIVE status). */
  currentPhase?: BattlePhase;
  /** Phase configuration computed from player count (set when battle starts). */
  phaseConfig?: PhaseConfig;
}

/**
 * Legacy event shape used by the DO's internal lifecycle broadcasts
 * (battle_started, state_update). These are separate from the richer
 * BattleEvent union in websocket.ts which covers per-epoch streaming.
 */
export interface InternalEvent {
  type: 'battle_started' | 'epoch_processed' | 'agent_died' | 'battle_completed' | 'state_update';
  battleId: string;
  epoch: number;
  timestamp: string;
  data: Record<string, unknown>;
}

/** An agent entry in the lobby (pre-battle). */
export interface LobbyAgent {
  id: string;
  name: string;
  class: string;
  imageUrl?: string;
  walletAddress?: string;
  position: number;     // 1-based slot index
  joinedAt: string;
}

/** Lobby metadata stored alongside BattleState in DO storage. */
export interface LobbyMeta {
  maxPlayers: number;
  feeAmount: string;
  lobbyAgents: LobbyAgent[];
}

/** Minimum agents to trigger countdown. */
const COUNTDOWN_TRIGGER_THRESHOLD = 5;

/** Countdown duration in ms (1 minute). */
const COUNTDOWN_DURATION_MS = 60_000;

// Epoch interval: configurable via EPOCH_INTERVAL_MS env var (default 5 min)
// For demo: set EPOCH_INTERVAL_MS=15000 (15 seconds) in .dev.vars
const DEFAULT_EPOCH_INTERVAL_MS = 300_000;

// Safety cap: absolute maximum epochs before a battle is force-completed.
// In practice, battles use computePhaseConfig(agentCount).totalEpochs (8–14),
// but this cap guards against runaway battles if phaseConfig is missing.
const MAX_EPOCHS_SAFETY_CAP = 50;

// ─── Agent Factory ────────────────────────────────────────────────

/**
 * Create a BaseAgent subclass instance from a stored BattleAgent record.
 * Restores HP, kills, epochs survived, and alive status.
 */
function createAgentFromState(agent: BattleAgent, llmKeys?: LLMKeys): BaseAgent {
  let instance: BaseAgent;

  switch (agent.class) {
    case 'WARRIOR':
      instance = new WarriorAgent(agent.id, agent.name);
      break;
    case 'TRADER':
      instance = new TraderAgent(agent.id, agent.name);
      break;
    case 'SURVIVOR':
      instance = new SurvivorAgent(agent.id, agent.name);
      break;
    case 'PARASITE':
      instance = new ParasiteAgent(agent.id, agent.name);
      break;
    case 'GAMBLER':
      instance = new GamblerAgent(agent.id, agent.name);
      break;
    default:
      // Fallback to Warrior for unknown classes
      instance = new WarriorAgent(agent.id, agent.name);
      break;
  }

  // Restore state from storage
  instance.hp = agent.hp;
  instance.maxHp = agent.maxHp;
  instance.isAlive = agent.isAlive;
  instance.kills = agent.kills;
  instance.epochsSurvived = agent.epochsSurvived;
  instance.thoughts = agent.thoughts ?? [];
  instance.position = agent.position ?? null;
  instance.llmKeys = llmKeys;

  return instance;
}

/**
 * Reconstruct an ArenaManager with in-memory BaseAgent instances from
 * a stored BattleState. The ArenaManager is needed by the epoch processor.
 *
 * Restores agent positions on the hex grid so that movement, combat
 * adjacency, and item pickups work correctly across epochs.
 */
function reconstructArena(battleState: BattleState, llmKeys?: LLMKeys): ArenaManager {
  // Use phaseConfig.totalEpochs if available (dynamic), fall back to config, then safety cap
  const maxEpochs = battleState.phaseConfig?.totalEpochs
    ?? battleState.config?.maxEpochs
    ?? MAX_EPOCHS_SAFETY_CAP;
  const arena = new ArenaManager(battleState.battleId, {
    maxEpochs,
    epochIntervalMs: DEFAULT_EPOCH_INTERVAL_MS,
  });

  // Manually set internal state to match stored battle
  arena.status = 'ACTIVE';
  arena.epochCount = battleState.epoch;
  arena.startedAt = battleState.startedAt ? new Date(battleState.startedAt) : new Date();

  // Create and register agents, then place them on the hex grid
  for (const agentData of Object.values(battleState.agents)) {
    const agent = createAgentFromState(agentData, llmKeys);
    arena.agents.set(agent.id, agent);

    // Place agent on the hex grid if they have a stored position
    if (agent.position && agent.isAlive) {
      arena.grid = placeAgent(agent.id, agent.position, arena.grid);
    }
  }

  // Restore phase config from stored state, or recompute from agent count
  if (battleState.phaseConfig) {
    arena.phaseConfig = battleState.phaseConfig;
  } else {
    // Backward compat: compute phase config from current agent count
    const agentCount = Object.keys(battleState.agents).length;
    arena.phaseConfig = computePhaseConfig(agentCount);
  }

  return arena;
}

/**
 * Sync epoch results back to the BattleState record for durable storage.
 */
function syncEpochResult(battleState: BattleState, result: EpochResult): void {
  battleState.epoch = result.epochNumber;

  // Update each agent's state from the epoch result
  for (const agentState of result.agentStates) {
    const stored = battleState.agents[agentState.id];
    if (!stored) continue;

    stored.hp = agentState.hp;
    stored.isAlive = agentState.isAlive;
    if (agentState.thoughts) {
      stored.thoughts = agentState.thoughts;
    }
    if (agentState.position) {
      stored.position = { q: agentState.position.q, r: agentState.position.r };
    }
  }

  // Sync kills and epochsSurvived from the arena's in-memory agents
  // (these aren't in agentStates but are tracked by the engine)
  // We'll handle this via the arena instance in processEpoch()

  // Update current phase from epoch result
  if (result.currentPhase) {
    battleState.currentPhase = result.currentPhase;
  }

  if (result.battleComplete) {
    battleState.status = 'COMPLETED';
    battleState.completedAt = new Date().toISOString();
    battleState.winnerId = result.winner?.id ?? null;
  }
}

// ─── Arena Durable Object ─────────────────────────────────────────

export class ArenaDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  /** PriceFeed persists across epochs so it can compute price changes. */
  private priceFeed: PriceFeed;
  /** NadFun client for curve streaming. Null if env vars are missing. */
  private nadFunClient: NadFunClient | null = null;
  /** Active curve stream subscription. Null if not streaming. */
  private curveStream: CurveStream | null = null;
  /** Unsubscribe callback for the curve stream event listener. */
  private curveStreamUnsub: (() => void) | null = null;

  /** Resolved epoch interval in ms. */
  private epochIntervalMs: number;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.priceFeed = new PriceFeed();
    this.epochIntervalMs = env.EPOCH_INTERVAL_MS
      ? parseInt(env.EPOCH_INTERVAL_MS, 10)
      : DEFAULT_EPOCH_INTERVAL_MS;

    // Eagerly create the NadFun client (graceful if env vars are missing)
    this.nadFunClient = createNadFunClient({
      MONAD_RPC_URL: env.MONAD_RPC_URL,
      PRIVATE_KEY: env.PRIVATE_KEY,
      MONAD_WS_URL: env.MONAD_WS_URL,
    });
  }

  // ─── Battle Lifecycle ─────────────────────────────────────────

  /**
   * Initialize a new battle with the given agent IDs.
   * Sets up initial state and schedules the first epoch alarm.
   */
  async startBattle(
    battleId: string,
    agentIds: string[],
    agentClasses?: string[],
    agentNames?: string[],
    battleConfig?: Partial<BattleConfig>,
  ): Promise<BattleState> {
    // Initialize agent states
    const agents: Record<string, BattleAgent> = {};
    for (let i = 0; i < agentIds.length; i++) {
      const agentId = agentIds[i];
      const agentClass = (agentClasses?.[i] ?? 'WARRIOR') as AgentClass;
      const agentName = agentNames?.[i] ?? `${agentClass}-${agentId.slice(0, 6)}`;
      const pk = generatePrivateKey();
      agents[agentId] = {
        id: agentId,
        name: agentName,
        class: agentClass,
        hp: 1000,
        maxHp: 1000,
        isAlive: true,
        kills: 0,
        epochsSurvived: 0,
        thoughts: [],
        position: null,
        privateKey: pk,
        walletAddress: privateKeyToAccount(pk).address,
      };
    }

    // Place agents on outer ring (Lv1) tiles — same as lobby flow
    let grid = createGrid();
    const outerTiles = getOuterRingTiles(grid);
    const shuffled = [...outerTiles];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < agentIds.length; i++) {
      const tile = shuffled[i % shuffled.length];
      const pos = tile.coord;
      grid = placeAgent(agentIds[i], pos, grid);
      agents[agentIds[i]].position = { q: pos.q, r: pos.r };
    }

    // Merge caller config with defaults
    const config: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, ...battleConfig };

    // Compute phase config from agent count and override maxEpochs
    const phaseConfig = computePhaseConfig(agentIds.length);
    config.maxEpochs = phaseConfig.totalEpochs;

    const battleState: BattleState = {
      battleId,
      status: 'ACTIVE',
      epoch: 0,
      agents,
      startedAt: new Date().toISOString(),
      completedAt: null,
      winnerId: null,
      bettingPhase: 'OPEN',
      config,
      countdownEndsAt: null,
      currentPhase: phaseConfig.phases[0]?.name,
      phaseConfig,
    };

    // Build UUID → numeric agent ID mapping for on-chain calls.
    // Contracts use uint256 agent IDs; we assign sequential 1-based indices.
    const chainAgentMap: Record<string, number> = {};
    for (let i = 0; i < agentIds.length; i++) {
      chainAgentMap[agentIds[i]] = i + 1;
    }

    // Build grid snapshot for WS clients (initial positions + items)
    const gridSnapshot = gridStateToEvent(grid);

    // Persist state
    await this.state.storage.put('battleState', battleState);
    await this.state.storage.put('chainAgentMap', chainAgentMap);
    await this.state.storage.put('gridSnapshot', gridSnapshot);

    // Schedule the first epoch
    await this.state.storage.setAlarm(Date.now() + this.epochIntervalMs);

    // Broadcast battle start
    this.broadcastInternal({
      type: 'battle_started',
      battleId,
      epoch: 0,
      timestamp: new Date().toISOString(),
      data: { agents, agentCount: agentIds.length },
    });

    // Broadcast initial grid state so spectators see agent positions
    const sockets = this.state.getWebSockets();
    broadcastEvent(sockets, gridSnapshot);

    // Broadcast initial betting phase (OPEN)
    broadcastEvent(sockets, {
      type: 'betting_phase_change',
      data: {
        phase: 'OPEN',
        epoch: 0,
        reason: 'Battle started — betting is open',
      },
    });

    // Start streaming $HNADS curve events to spectators
    this.startCurveStream();

    // Fund agent wallets from oracle (fire-and-forget)
    this.fundAgentWallets(battleState);

    return battleState;
  }

  /**
   * Process a single epoch using the real arena engine.
   *
   * Reconstructs an in-memory ArenaManager from durable storage,
   * runs the full epoch processor (agent decisions, predictions,
   * combat, bleed, death checks), syncs results back to storage,
   * and broadcasts rich events to spectators.
   */
  async processEpoch(): Promise<void> {
    const battleState = await this.state.storage.get<BattleState>('battleState');
    if (!battleState || battleState.status !== 'ACTIVE') return;

    // Extract LLM keys from Cloudflare env bindings
    const llmKeys: LLMKeys = {
      groqApiKey: this.env.GROQ_API_KEY,
      googleApiKey: this.env.GOOGLE_API_KEY,
      openrouterApiKey: this.env.OPENROUTER_API_KEY,
    };

    // Reconstruct in-memory ArenaManager with BaseAgent instances
    const arena = reconstructArena(battleState, llmKeys);

    // Retrieve previous market data for prediction resolution
    const previousMarketData = await this.state.storage.get<MarketData>('previousMarketData');

    // ── Fetch sponsor effects for this epoch ─────────────────────
    // Sponsorships placed for the upcoming epoch are resolved here
    // and passed to the epoch processor for HP boosts + combat mods.
    let sponsorEffects: Map<string, import('../betting/sponsorship').SponsorEffect> | undefined;
    try {
      const sponsorMgr = new SponsorshipManager(this.env.DB);
      const nextEpoch = battleState.epoch + 1; // epoch is about to be incremented inside processEpoch
      sponsorEffects = await sponsorMgr.getEpochEffects(battleState.battleId, nextEpoch);
      if (sponsorEffects.size > 0) {
        console.log(
          `[ArenaDO] ${sponsorEffects.size} sponsor effect(s) for epoch ${nextEpoch}`,
        );
      }
    } catch (err) {
      console.error('[ArenaDO] Failed to fetch sponsor effects:', err);
      // Non-fatal: proceed without sponsor effects
    }

    // ── Run the full epoch processor ─────────────────────────────
    // This handles ALL phases:
    //   1. Fetch market data
    //   2. Collect agent decisions (with LLM calls)
    //   2.5. Apply sponsor HP boosts
    //   3. Resolve predictions
    //   4. Resolve combat (with sponsor freeDefend + attackBoost)
    //   5. Apply bleed
    //   6. Check deaths
    //   7. Check win condition
    let result: EpochResult;
    try {
      result = await runEpoch(
        arena,
        this.priceFeed,
        previousMarketData ?? undefined,
        undefined, // generateFinalWords — use default
        sponsorEffects,
      );
    } catch (err) {
      console.error(`[ArenaDO] Epoch processing failed:`, err);
      // On failure, don't crash the DO - just skip this epoch and retry
      await this.state.storage.setAlarm(Date.now() + this.epochIntervalMs);
      return;
    }

    // ── Sync results back to BattleState ─────────────────────────
    syncEpochResult(battleState, result);

    // Sync kills, epochsSurvived, and positions from the arena's in-memory agents
    for (const agent of arena.getAllAgents()) {
      const stored = battleState.agents[agent.id];
      if (stored) {
        stored.kills = agent.kills;
        stored.epochsSurvived = agent.epochsSurvived;
        if (agent.position) {
          stored.position = { q: agent.position.q, r: agent.position.r };
        }
      }
    }

    // Store market data for next epoch's prediction resolution
    await this.state.storage.put('previousMarketData', result.marketData);

    // ── Broadcast rich events to spectators ──────────────────────
    this.broadcastEpochResult(result, arena);

    // ── Fire agent token trades (non-blocking) ──────────────────
    // Agents auto-buy $HNADS on prediction wins, auto-sell on combat damage.
    // Uses fire-and-forget pattern: tx failure must NOT break the game loop.
    this.fireAgentTokenTrades(result, battleState);

    // ── Persist grid state for new WebSocket connections ─────────
    // Store the serialized grid snapshot so that spectators connecting
    // between epochs receive the latest tile/item/position state.
    try {
      // Include storm tiles so reconnecting clients see the storm overlay
      const stormTiles = result.stormTiles && result.stormTiles.length > 0
        ? result.stormTiles
        : undefined;
      const gridSnapshot = gridStateToEvent(arena.grid, stormTiles, arena.agents);
      await this.state.storage.put('gridSnapshot', gridSnapshot);
    } catch (err) {
      console.error('[ArenaDO] Failed to persist grid snapshot:', err);
    }

    // ── Betting phase transition: OPEN -> LOCKED ──────────────────
    // After N epochs, lock betting so no new bets can be placed.
    // Per-battle config takes priority, then env var, then global default.
    const lockAfter = battleState.config?.bettingWindowEpochs
      ?? (this.env.BETTING_LOCK_AFTER_EPOCH
        ? parseInt(this.env.BETTING_LOCK_AFTER_EPOCH, 10)
        : DEFAULT_BETTING_LOCK_AFTER_EPOCH);

    if (battleState.bettingPhase === 'OPEN' && battleState.epoch >= lockAfter) {
      battleState.bettingPhase = 'LOCKED';
      console.log(
        `[ArenaDO] Betting locked for battle ${battleState.battleId} at epoch ${battleState.epoch}`,
      );

      // Persist phase change to D1
      try {
        await updateBattle(this.env.DB, battleState.battleId, {
          betting_phase: 'LOCKED',
        });
      } catch (err) {
        console.error(`[ArenaDO] Failed to update D1 betting_phase to LOCKED:`, err);
      }

      // Broadcast phase change to spectators
      const sockets = this.state.getWebSockets();
      broadcastEvent(sockets, {
        type: 'betting_phase_change',
        data: {
          phase: 'LOCKED',
          epoch: battleState.epoch,
          reason: `Betting locked after epoch ${lockAfter}`,
        },
      });
    }

    // ── Max epochs timeout guard ──────────────────────────────────
    // If the battle didn't end naturally but we've hit the epoch limit,
    // force-complete by declaring the highest-HP agent the winner.
    const maxEpochs = battleState.config?.maxEpochs ?? MAX_EPOCHS_SAFETY_CAP;
    if (!result.battleComplete && battleState.epoch >= maxEpochs) {
      console.log(
        `[ArenaDO] Battle ${battleState.battleId} hit max epochs (${maxEpochs}) — forcing timeout win`,
      );

      // Determine winner: agent with highest HP among survivors
      const aliveAgents = Object.values(battleState.agents)
        .filter((a) => a.isAlive)
        .sort((a, b) => b.hp - a.hp);

      const timeoutWinner = aliveAgents[0] ?? null;
      const winnerId = timeoutWinner?.id ?? null;

      // Update battle state for persistence
      battleState.status = 'COMPLETED';
      battleState.completedAt = new Date().toISOString();
      battleState.winnerId = winnerId;

      // Broadcast timeout_win event to spectators
      if (timeoutWinner) {
        const sockets = this.state.getWebSockets();
        broadcastEvent(sockets, {
          type: 'timeout_win',
          data: {
            winnerId: timeoutWinner.id,
            winnerName: timeoutWinner.name,
            winnerClass: timeoutWinner.class,
            winnerHp: timeoutWinner.hp,
            totalEpochs: battleState.epoch,
            survivors: aliveAgents.map((a) => ({
              id: a.id,
              name: a.name,
              class: a.class,
              hp: a.hp,
            })),
          },
        });

        // Also broadcast battle_end for backward compatibility
        broadcastEvent(sockets, {
          type: 'battle_end',
          data: {
            winnerId: timeoutWinner.id,
            winnerName: timeoutWinner.name,
            totalEpochs: battleState.epoch,
          },
        });
      }

      // Fall through to the completion handler below
      result = { ...result, battleComplete: true, winner: timeoutWinner ? {
        id: timeoutWinner.id,
        name: timeoutWinner.name,
        class: timeoutWinner.class,
      } : undefined };
    }

    // ── Handle battle completion or schedule next epoch ───────────
    if (result.battleComplete) {
      const winnerId = result.winner?.id ?? null;

      // ── Transition betting phase to SETTLED ──────────────────────
      battleState.bettingPhase = 'SETTLED';

      // ── Auto-settle bets ────────────────────────────────────────
      // Settle all bets in D1: losers get payout=0, winners get
      // proportional share of the 85% pool. 3% goes to Schadenfreude,
      // 2% accumulates in the streak bonus pool.
      if (winnerId) {
        try {
          const pool = new BettingPool(this.env.DB);
          const settlement = await pool.settleBattle(battleState.battleId, winnerId);
          console.log(
            `[ArenaDO] Bets settled for battle ${battleState.battleId}: ` +
            `${settlement.payouts.length} winner(s), ` +
            `treasury=${settlement.treasury}, burn=${settlement.burn}, ` +
            `schadenfreude=${settlement.schadenfreudeContribution}, ` +
            `streakBonuses=${settlement.streakBonuses.length}, streakPool=${settlement.streakPoolBalance}`,
          );

          // Broadcast settlement results to spectators before closing connections
          if (settlement.payouts.length > 0 || settlement.streakBonuses.length > 0) {
            const poolSummary = await pool.getBattlePool(battleState.battleId);
            const sockets = this.state.getWebSockets();
            broadcastEvent(sockets, {
              type: 'bets_settled',
              data: {
                battleId: battleState.battleId,
                winnerId,
                totalPool: poolSummary.total,
                payouts: settlement.payouts,
                treasury: settlement.treasury,
                burn: settlement.burn,
                schadenfreudeContribution: settlement.schadenfreudeContribution,
                schadenfreude: settlement.schadenfreude,
                streakBonuses: settlement.streakBonuses,
                streakPoolBalance: settlement.streakPoolBalance,
                topBettorBonus: settlement.topBettorBonus,
              },
            });
          }
        } catch (err) {
          console.error(`[ArenaDO] Bet settlement failed for battle ${battleState.battleId}:`, err);
          // Settlement failure is non-fatal — can be retried via POST /battle/:id/settle
        }
      }

      // Broadcast betting phase SETTLED to spectators
      {
        const sockets = this.state.getWebSockets();
        broadcastEvent(sockets, {
          type: 'betting_phase_change',
          data: {
            phase: 'SETTLED',
            epoch: battleState.epoch,
            reason: 'Battle completed — bets settled',
          },
        });
      }

      // ── Record results + settle bets on-chain ──────────────────
      // Writes to HungernadsArena.recordResult() and HungernadsBetting.settleBattle().
      // Non-blocking: chain failures are logged but don't crash the battle.
      // Falls back gracefully when env vars are missing (dev mode).
      const chainClient = createChainClient(this.env);
      if (chainClient && winnerId) {
        const chainAgentMap = await this.state.storage.get<Record<string, number>>('chainAgentMap');
        if (chainAgentMap) {
          const numericWinnerId = chainAgentMap[winnerId] ?? 0;

          // Build per-agent results for the arena contract
          const chainResults: ChainAgentResult[] = Object.values(battleState.agents).map((agent) => ({
            agentId: BigInt(chainAgentMap[agent.id] ?? 0),
            finalHp: BigInt(Math.max(0, Math.round(agent.hp))),
            kills: BigInt(agent.kills),
            survivedEpochs: BigInt(agent.epochsSurvived),
            isWinner: agent.id === winnerId,
          }));

          // Record result on HungernadsArena
          try {
            await chainClient.recordResult(battleState.battleId, numericWinnerId, chainResults);
            console.log(`[ArenaDO] Battle ${battleState.battleId} result recorded on-chain`);
          } catch (err) {
            console.error(`[ArenaDO] On-chain recordResult failed for ${battleState.battleId}:`, err);
          }

          // Settle bets on HungernadsBetting
          try {
            await chainClient.settleBets(battleState.battleId, numericWinnerId);
            console.log(`[ArenaDO] Bets settled on-chain for ${battleState.battleId}`);
          } catch (err) {
            console.error(`[ArenaDO] On-chain settleBets failed for ${battleState.battleId}:`, err);
          }
        } else {
          console.warn(`[ArenaDO] No chainAgentMap found — skipping on-chain result recording`);
        }
      }

      // ── Update D1 battle row ────────────────────────────────────
      try {
        await updateBattle(this.env.DB, battleState.battleId, {
          status: 'COMPLETED',
          ended_at: new Date().toISOString(),
          winner_id: winnerId,
          epoch_count: battleState.epoch,
          betting_phase: 'SETTLED',
        });
      } catch (err) {
        console.error(`[ArenaDO] Failed to update D1 battle row:`, err);
      }

      // ── Post battle results to Moltbook /m/hungernads ─────────
      // Fire-and-forget: Moltbook posting is non-blocking and non-fatal.
      // Posts a summary + agent reaction comments to the submolt.
      const moltbookPoster = createMoltbookPoster(this.env);
      if (moltbookPoster) {
        // Don't await — let it run in the background
        moltbookPoster.postBattleResults(battleState).catch((err) => {
          console.error(`[ArenaDO] Moltbook posting failed for ${battleState.battleId}:`, err);
        });
      }

      // ── Update TrueSkill ratings ──────────────────────────────
      // Fire-and-forget: Extract battle performances from D1 and update
      // the multi-dimensional TrueSkill ratings for all participating agents.
      // Non-blocking and non-fatal — rating updates can be recomputed later.
      try {
        const ratingMgr = new RatingManager(this.env.DB);
        const performances = await extractBattlePerformances(this.env.DB, battleState.battleId);
        if (performances.length >= 2) {
          await ratingMgr.updateBattleRatings(battleState.battleId, performances);
          console.log(
            `[ArenaDO] TrueSkill ratings updated for ${performances.length} agents in battle ${battleState.battleId}`,
          );
        }
      } catch (err) {
        console.error(`[ArenaDO] TrueSkill rating update failed for ${battleState.battleId}:`, err);
      }

      // ── Generate LLM-driven agent lessons ───────────────────────
      // Fire-and-forget: lesson generation is non-blocking and non-fatal.
      // Each agent gets 2-3 specific lessons stored in D1 for the profile page.
      this.generateAgentLessons(battleState).catch((err) => {
        console.error(`[ArenaDO] Lesson generation failed for ${battleState.battleId}:`, err);
      });

      // Stop the curve stream — no more spectators after this
      this.stopCurveStream();

      // Close all WebSocket connections on battle end
      const sockets = this.state.getWebSockets();
      for (const ws of sockets) {
        try {
          ws.close(1000, 'Battle completed');
        } catch {
          // Already closed
        }
      }
    } else {
      // Schedule next epoch
      await this.state.storage.setAlarm(Date.now() + this.epochIntervalMs);
    }

    // Persist updated state
    await this.state.storage.put('battleState', battleState);
  }

  /**
   * Broadcast a full EpochResult as a sequence of rich BattleEvents.
   *
   * Converts the result to ordered events and streams them to all
   * connected spectators:
   *   epoch_start -> agent_moved (x N) -> item_picked_up (x N)
   *   -> trap_triggered (x N) -> agent_action (x N) -> prediction_result (x N)
   *   -> combat_result (x M) -> item_spawned (x N) -> agent_death (x D)
   *   -> epoch_end -> grid_state -> battle_end (if applicable)
   *
   * Also sends a grid_state snapshot after epoch_end so spectators
   * always have the latest tile/item/position state.
   */
  broadcastEpochResult(epochResult: EpochResult, arena?: ArenaManager): void {
    const sockets = this.state.getWebSockets();
    const events = epochToEvents(epochResult);

    // Append a grid_state snapshot after the epoch events so the client
    // has a consistent view of tile positions and items (including storm tiles).
    if (arena) {
      // Include stormTiles from the epoch result (computed during storm damage step)
      const stormTiles = epochResult.stormTiles && epochResult.stormTiles.length > 0
        ? epochResult.stormTiles
        : undefined;
      events.push(gridStateToEvent(arena.grid, stormTiles, arena.agents));
    }

    broadcastEvents(sockets, events);
  }

  /**
   * Fund each agent's ephemeral wallet from the oracle account.
   * Each agent receives 0.05 MON for on-chain token trades.
   * Fire-and-forget: failures are logged but never block the battle.
   */
  private fundAgentWallets(battleState: BattleState): void {
    if (!this.env.MONAD_RPC_URL || !this.env.PRIVATE_KEY) return;

    const FUND_AMOUNT = parseEther('0.05');
    const oracleAccount = privateKeyToAccount(this.env.PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      account: oracleAccount,
      chain: monadTestnet,
      transport: http(this.env.MONAD_RPC_URL),
    });

    for (const agent of Object.values(battleState.agents)) {
      if (!agent.walletAddress) continue;
      walletClient.sendTransaction({
        to: agent.walletAddress as Address,
        value: FUND_AMOUNT,
      }).then((tx) => {
        console.log(`[Wallet] Funded ${agent.name} (${agent.walletAddress}): ${tx}`);
      }).catch((err) => {
        console.error(`[Wallet] Fund failed for ${agent.name} (${agent.walletAddress}):`, err);
      });
    }
  }

  /**
   * Fire-and-forget agent token trades on nad.fun (buy-only, per-agent wallets).
   *
   * On prediction win (positive hpChange): agent auto-buys $HNADS ("victory purchase").
   * On kill (combat death): attacker auto-buys $HNADS ("kill trophy").
   *
   * Amount: 0.001 MON per 10 HP gained/lost (proportional).
   * Non-blocking: tx failure is logged but never breaks the game loop.
   */
  private fireAgentTokenTrades(result: EpochResult, battleState: BattleState): void {
    if (!this.env.MONAD_RPC_URL) return;

    const tokenAddress = (this.env.NADFUN_TOKEN_ADDRESS ?? '0xe19fd60f5117Df0F23659c7bc16e2249b8dE7777') as Address;
    const sockets = this.state.getWebSockets();
    const epochNumber = result.epochNumber;

    /** Create a per-agent NadFunClient (or null if agent has no wallet). */
    const getAgentClient = (agentId: string): NadFunClient | null => {
      const agent = battleState.agents[agentId];
      if (!agent?.privateKey || !this.env.MONAD_RPC_URL) return null;
      return new NadFunClient({
        rpcUrl: this.env.MONAD_RPC_URL,
        privateKey: agent.privateKey as `0x${string}`,
        network: 'testnet',
      });
    };

    /** Fire a buy-and-broadcast for a given agent. */
    const fireBuy = (agentId: string, agentName: string, monAmount: number, reason: string, walletAddr?: string) => {
      const client = getAgentClient(agentId);
      if (!client) return;
      const amountWei = BigInt(Math.round(monAmount * 1e18));

      client.buyToken(tokenAddress, amountWei).then((txHash) => {
        console.log(
          `[TokenTrade] ${agentName} victory-bought $HNADS for ${monAmount.toFixed(4)} MON (wallet: ${walletAddr ?? '?'}): ${txHash}`,
        );
        broadcastEvent(sockets, {
          type: 'agent_token_trade',
          data: {
            agentId,
            agentName,
            action: 'buy',
            amount: monAmount.toFixed(4),
            reason,
            txHash,
            epochNumber,
            agentWallet: walletAddr ?? '',
          },
        });
      }).catch((err) => {
        console.error(`[TokenTrade] Buy failed for ${agentName}:`, err);
        broadcastEvent(sockets, {
          type: 'agent_token_trade',
          data: {
            agentId,
            agentName,
            action: 'buy',
            amount: monAmount.toFixed(4),
            reason,
            txHash: '',
            epochNumber,
            agentWallet: walletAddr ?? '',
          },
        });
      });
    };

    // ── Buy triggers: prediction wins ──────────────────────────────
    for (const pred of result.predictionResults) {
      if (pred.hpChange > 0) {
        const agent = battleState.agents[pred.agentId];
        if (!agent) continue;

        // 0.001 MON per 10 HP gained, minimum 0.0001 MON
        const monAmount = Math.max(0.0001, (pred.hpChange / 10) * 0.001);
        fireBuy(pred.agentId, agent.name, monAmount, `Prediction win (+${Math.round(pred.hpChange)} HP)`, agent.walletAddress);
      }
    }

    // ── Buy triggers: kills (killer buys as kill trophy) ───────────
    for (const death of result.deaths) {
      if (death.killerId) {
        const attacker = battleState.agents[death.killerId];
        if (!attacker) continue;

        // 0.002 MON per kill (flat reward)
        const monAmount = 0.002;
        fireBuy(death.killerId, attacker.name, monAmount, `Kill trophy (REKT ${death.agentName})`, attacker.walletAddress);
      }
    }
  }

  /**
   * Broadcast an odds_update event to all connected spectators.
   * Call after epoch processing once new odds have been computed.
   */
  broadcastOddsUpdate(odds: Record<string, number>): void {
    const sockets = this.state.getWebSockets();
    broadcastEvent(sockets, {
      type: 'odds_update',
      data: { odds },
    });
  }

  /**
   * Generate LLM-driven lessons for all agents in a completed battle.
   *
   * For each agent (alive or dead), sends a battle summary to the LLM
   * and extracts 2-3 short, specific lessons. Lessons are stored in D1
   * via AgentMemory.storeLessons() so they appear on the agent profile page.
   *
   * Non-blocking: failures are logged but never crash the battle flow.
   * Called fire-and-forget from the battle completion handler.
   */
  private async generateAgentLessons(battleState: BattleState): Promise<void> {
    const llmKeys: LLMKeys = {
      groqApiKey: this.env.GROQ_API_KEY,
      googleApiKey: this.env.GOOGLE_API_KEY,
      openrouterApiKey: this.env.OPENROUTER_API_KEY,
    };
    const hasKeys = !!(llmKeys.groqApiKey || llmKeys.googleApiKey || llmKeys.openrouterApiKey);
    if (!hasKeys) {
      console.log(`[ArenaDO] No LLM keys — skipping lesson generation for battle ${battleState.battleId}`);
      return;
    }

    const memory = new AgentMemory(this.env.DB);
    const llm = getLLM(llmKeys);
    const agents = Object.values(battleState.agents);
    const winnerId = battleState.winnerId;

    // Build a compact battle summary shared across all agent prompts
    const agentSummaryLines = agents.map((a) => {
      const status = a.id === winnerId ? 'WINNER' : a.isAlive ? 'ALIVE' : 'DEAD';
      return `- ${a.name} (${a.class}): ${a.hp} HP, ${a.kills} kills, ${a.epochsSurvived} epochs survived [${status}]`;
    });
    const battleSummary = [
      `Battle ${battleState.battleId.slice(0, 8)}`,
      `Total epochs: ${battleState.epoch}`,
      `Phase progression: ${battleState.phaseConfig?.phases.map((p) => p.name).join(' -> ') ?? 'unknown'}`,
      `Agents:`,
      ...agentSummaryLines,
    ].join('\n');

    // Compute placement for each agent (1 = winner, dead agents sorted by epochs survived)
    const sorted = [...agents].sort((a, b) => {
      if (a.id === winnerId) return -1;
      if (b.id === winnerId) return 1;
      if (a.isAlive && !b.isAlive) return -1;
      if (!a.isAlive && b.isAlive) return 1;
      return b.epochsSurvived - a.epochsSurvived;
    });
    const placementMap = new Map<string, number>();
    sorted.forEach((a, idx) => placementMap.set(a.id, idx + 1));

    // Generate lessons for each agent in parallel (bounded to avoid rate limits)
    const lessonPromises = agents.map(async (agent) => {
      const placement = placementMap.get(agent.id) ?? agents.length;
      const isWinner = agent.id === winnerId;

      try {
        const response = await llm.chat([
          {
            role: 'system',
            content: `You are analyzing a gladiator battle in the HUNGERNADS arena. Generate exactly 2-3 short, specific lessons this agent learned from the battle. Each lesson should reference actual battle events and agent names. Respond with ONLY a JSON array of objects with fields: "context" (what happened), "outcome" (the result), "learning" (one sentence lesson), "applied" (how to apply next time).`,
          },
          {
            role: 'user',
            content: `AGENT: ${agent.name} (${agent.class})
PLACEMENT: #${placement} of ${agents.length}
HP: ${agent.hp}/1000
KILLS: ${agent.kills}
EPOCHS SURVIVED: ${agent.epochsSurvived}
STATUS: ${isWinner ? 'WON THE BATTLE' : agent.isAlive ? 'Survived (timeout)' : 'ELIMINATED'}

FULL BATTLE SUMMARY:
${battleSummary}

Generate 2-3 specific, actionable lessons for ${agent.name}.`,
          },
        ], { maxTokens: 400, temperature: 0.7 });

        let jsonStr = response.content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }
        const parsed = JSON.parse(jsonStr) as Array<{
          context?: string;
          outcome?: string;
          learning: string;
          applied?: string;
        }>;

        if (Array.isArray(parsed) && parsed.length > 0) {
          const lessons = parsed.slice(0, 3).map((l) => ({
            battleId: battleState.battleId,
            epoch: battleState.epoch,
            context: l.context || `Placed #${placement} in battle (${battleState.epoch} epochs).`,
            outcome: l.outcome || (isWinner ? 'Won the battle' : 'Eliminated'),
            learning: l.learning || 'No lesson extracted.',
            applied: l.applied || '',
          }));

          await memory.storeLessons(agent.id, battleState.battleId, lessons);
          console.log(
            `[ArenaDO] Generated ${lessons.length} lesson(s) for ${agent.name} in battle ${battleState.battleId.slice(0, 8)}`,
          );
        }
      } catch (err) {
        console.error(
          `[ArenaDO] Lesson generation failed for ${agent.name} in battle ${battleState.battleId.slice(0, 8)}:`,
          err,
        );
        // Fallback: store a basic lesson so the agent always has something
        try {
          const fallbackLesson = {
            battleId: battleState.battleId,
            epoch: battleState.epoch,
            context: `Battle lasted ${battleState.epoch} epochs. Placed #${placement}.`,
            outcome: isWinner
              ? 'Won the battle'
              : agent.isAlive
                ? 'Survived but did not win'
                : 'Eliminated',
            learning: isWinner
              ? `Won after ${battleState.epoch} epochs with ${agent.kills} kill(s) as a ${agent.class}.`
              : `Placed #${placement} as a ${agent.class} — survived ${agent.epochsSurvived} epochs.`,
            applied: '',
          };
          await memory.storeLessons(agent.id, battleState.battleId, [fallbackLesson]);
        } catch (fallbackErr) {
          console.error(
            `[ArenaDO] Even fallback lesson storage failed for ${agent.name}:`,
            fallbackErr,
          );
        }
      }
    });

    await Promise.allSettled(lessonPromises);
    console.log(
      `[ArenaDO] Lesson generation complete for battle ${battleState.battleId.slice(0, 8)} (${agents.length} agents)`,
    );
  }

  /**
   * Initialize a lobby battle without spawning any agents.
   *
   * Creates a BattleState in LOBBY status with an empty agents map.
   * Stores config and lobby metadata (maxPlayers, feeAmount) in DO storage.
   * Does NOT schedule an epoch alarm — the battle won't start until
   * enough agents join and the countdown completes.
   *
   * WebSocket connections are accepted so clients can receive lobby_update
   * events as agents join.
   */
  async initLobby(
    battleId: string,
    battleConfig?: Partial<BattleConfig>,
    maxPlayers?: number,
    feeAmount?: string,
  ): Promise<BattleState> {
    // Merge caller config with defaults
    const config: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, ...battleConfig };

    const battleState: BattleState = {
      battleId,
      status: 'LOBBY',
      epoch: 0,
      agents: {},
      startedAt: null,
      completedAt: null,
      winnerId: null,
      bettingPhase: 'OPEN',
      config,
      countdownEndsAt: null,
    };

    // Persist state
    await this.state.storage.put('battleState', battleState);

    // Store lobby metadata for join/countdown logic
    await this.state.storage.put('lobbyMeta', {
      maxPlayers: maxPlayers ?? 8,
      feeAmount: feeAmount ?? '0',
      lobbyAgents: [],  // Will be populated as agents join via /join
    });

    // Broadcast lobby creation to any connected spectators
    this.broadcastInternal({
      type: 'battle_started',
      battleId,
      epoch: 0,
      timestamp: new Date().toISOString(),
      data: {
        status: 'LOBBY',
        maxPlayers: maxPlayers ?? 8,
        feeAmount: feeAmount ?? '0',
        agentCount: 0,
      },
    });

    return battleState;
  }

  /**
   * Return current battle state for API consumers.
   */
  async getState(): Promise<BattleState | null> {
    return (await this.state.storage.get<BattleState>('battleState')) ?? null;
  }

  // ─── Curve Stream Lifecycle ──────────────────────────────────

  /**
   * Start listening for nad.fun curve events on the $HNADS token and
   * forward them to connected spectators as token_buy / token_sell /
   * curve_update WebSocket events.
   *
   * No-ops if the NadFun client is unavailable (missing env vars) or
   * if the NADFUN_TOKEN_ADDRESS secret hasn't been set yet.
   *
   * Safe to call multiple times — stops any existing stream first.
   */
  private startCurveStream(): void {
    // Guard: need both the client and a token address
    if (!this.nadFunClient || !this.env.NADFUN_TOKEN_ADDRESS) {
      console.log('[ArenaDO] Curve stream skipped — nadFunClient or NADFUN_TOKEN_ADDRESS unavailable');
      return;
    }

    // Teardown previous stream if any
    this.stopCurveStream();

    try {
      const tokenAddress = this.env.NADFUN_TOKEN_ADDRESS as Address;

      this.curveStream = this.nadFunClient.createCurveStream(
        [tokenAddress],
        ['Buy', 'Sell', 'Create'],
      );

      // Subscribe: convert each CurveEvent → BattleEvent and broadcast
      this.curveStreamUnsub = this.curveStream.onEvent((curveEvt) => {
        const sockets = this.state.getWebSockets();
        if (sockets.length === 0) return; // nobody watching

        const battleEvt = curveEventToBattleEvent(curveEvt);
        broadcastEvent(sockets, battleEvt);
      });

      this.curveStream.onError((err) => {
        console.error('[ArenaDO] Curve stream error:', err.message);
      });

      this.curveStream.start();
      console.log(`[ArenaDO] Curve stream started for token ${tokenAddress}`);
    } catch (err) {
      console.error('[ArenaDO] Failed to start curve stream:', err);
    }
  }

  /**
   * Stop the active curve event stream (if any).
   */
  private stopCurveStream(): void {
    if (this.curveStreamUnsub) {
      this.curveStreamUnsub();
      this.curveStreamUnsub = null;
    }
    if (this.curveStream) {
      try {
        this.curveStream.stop();
      } catch {
        // already stopped
      }
      this.curveStream = null;
    }
  }

  // ─── Alarm Handler ────────────────────────────────────────────

  /**
   * Durable Object alarm handler.
   *
   * Routes based on the current battle status:
   *   - COUNTDOWN: countdown timer expired → transition to ACTIVE (spawn agents, start epochs)
   *   - ACTIVE:    epoch timer fired → run the next epoch
   *
   * Durable Objects only support a single alarm at a time. During COUNTDOWN the
   * alarm is the countdown timer. Once we transition to ACTIVE, the first epoch
   * alarm is scheduled by transitionToActive(), and subsequent ones by processEpoch().
   */
  async alarm(): Promise<void> {
    const battleState = await this.state.storage.get<BattleState>('battleState');
    if (!battleState) return;

    if (battleState.status === 'COUNTDOWN') {
      await this.transitionToActive();
    } else if (battleState.status === 'ACTIVE') {
      await this.processEpoch();
    }
    // Other statuses (LOBBY, COMPLETED, CANCELLED, etc.) — no-op.
    // This guards against stale alarms firing after a battle is already done.
  }

  /**
   * Transition battle from COUNTDOWN → ACTIVE.
   *
   * Called when the countdown alarm fires. Creates an ArenaManager,
   * spawns lobby agents onto the hex grid with cornucopia items,
   * persists grid + agent state, schedules the first epoch alarm,
   * and broadcasts battle_starting + grid_state to spectators.
   */
  private async transitionToActive(): Promise<void> {
    const battleState = await this.state.storage.get<BattleState>('battleState');
    if (!battleState || battleState.status !== 'COUNTDOWN') return;

    const lobbyMeta = await this.state.storage.get<LobbyMeta>('lobbyMeta');
    if (!lobbyMeta || lobbyMeta.lobbyAgents.length < COUNTDOWN_TRIGGER_THRESHOLD) {
      console.error(
        `[ArenaDO] transitionToActive called but only ${lobbyMeta?.lobbyAgents.length ?? 0} agents — aborting`,
      );
      return;
    }

    console.log(
      `[ArenaDO] Countdown expired for battle ${battleState.battleId} — ` +
      `transitioning to ACTIVE with ${lobbyMeta.lobbyAgents.length} agents`,
    );

    // ── Create ArenaManager and populate lobby agents ─────────────
    // maxEpochs will be recomputed from phaseConfig after agents are spawned
    const arena = new ArenaManager(battleState.battleId, {
      maxEpochs: MAX_EPOCHS_SAFETY_CAP, // placeholder — overridden by computePhaseConfig in startBattleFromLobby
      epochIntervalMs: this.epochIntervalMs,
      initialStatus: 'LOBBY',
    });

    // Transition ArenaManager through LOBBY → COUNTDOWN so we can call startBattleFromLobby
    for (const la of lobbyMeta.lobbyAgents) {
      arena.addLobbyAgent({
        id: la.id,
        name: la.name,
        agentClass: la.class as AgentClass,
        imageUrl: la.imageUrl,
        walletAddress: la.walletAddress,
      });
    }
    arena.startCountdown(); // LOBBY → COUNTDOWN

    // Spawn agents on hex grid + cornucopia items (COUNTDOWN → ACTIVE)
    arena.startBattleFromLobby();

    // ── Convert spawned agents to BattleAgent records with positions ──
    const agents: Record<string, BattleAgent> = {};
    const agentPositionData: Array<{ id: string; name: string; class: string; position: { q: number; r: number }; walletAddress?: string }> = [];

    for (const agent of arena.getAllAgents()) {
      const pk = generatePrivateKey();
      agents[agent.id] = {
        id: agent.id,
        name: agent.name,
        class: agent.agentClass,
        hp: agent.hp,
        maxHp: agent.maxHp,
        isAlive: agent.isAlive,
        kills: agent.kills,
        epochsSurvived: agent.epochsSurvived,
        thoughts: [],
        position: agent.position,
        privateKey: pk,
        walletAddress: privateKeyToAccount(pk).address,
      };

      if (agent.position) {
        agentPositionData.push({
          id: agent.id,
          name: agent.name,
          class: agent.agentClass,
          position: { q: agent.position.q, r: agent.position.r },
          walletAddress: agents[agent.id].walletAddress,
        });
      }
    }

    // ── Update battle state ───────────────────────────────────────
    battleState.status = 'ACTIVE';
    battleState.agents = agents;
    battleState.startedAt = new Date().toISOString();
    battleState.countdownEndsAt = null;
    // Store phase config computed by ArenaManager during startBattleFromLobby
    battleState.phaseConfig = arena.phaseConfig ?? undefined;
    battleState.currentPhase = arena.phaseConfig?.phases[0]?.name;
    // Override maxEpochs from computed phase config (dynamic based on agent count)
    if (arena.phaseConfig) {
      battleState.config.maxEpochs = arena.phaseConfig.totalEpochs;
    }

    // Build UUID → numeric agent ID mapping for on-chain calls
    const chainAgentMap: Record<string, number> = {};
    const agentIds = lobbyMeta.lobbyAgents.map((a) => a.id);
    for (let i = 0; i < agentIds.length; i++) {
      chainAgentMap[agentIds[i]] = i + 1;
    }

    // ── Persist grid snapshot for WS reconnections ────────────────
    const gridSnapshot = gridStateToEvent(arena.grid);

    // Persist all state
    await this.state.storage.put('battleState', battleState);
    await this.state.storage.put('chainAgentMap', chainAgentMap);
    await this.state.storage.put('gridSnapshot', gridSnapshot);

    // Schedule the first epoch alarm
    await this.state.storage.setAlarm(Date.now() + this.epochIntervalMs);

    // ── Broadcast battle_starting event with agent positions ──────
    const sockets = this.state.getWebSockets();
    const startsAt = Date.now() + this.epochIntervalMs;

    broadcastEvent(sockets, {
      type: 'battle_starting',
      data: {
        battleId: battleState.battleId,
        agents: agentPositionData,
        startsAt,
      },
    });

    // Broadcast initial grid_state snapshot (tiles, items, positions)
    broadcastEvent(sockets, gridSnapshot);

    // Broadcast legacy battle_started for backward compat
    this.broadcastInternal({
      type: 'battle_started',
      battleId: battleState.battleId,
      epoch: 0,
      timestamp: new Date().toISOString(),
      data: { agents, agentCount: agentIds.length },
    });

    // Broadcast betting phase OPEN
    broadcastEvent(sockets, {
      type: 'betting_phase_change',
      data: {
        phase: 'OPEN',
        epoch: 0,
        reason: 'Battle started — betting is open',
      },
    });

    // ── Update D1 records ─────────────────────────────────────────
    try {
      await updateBattle(this.env.DB, battleState.battleId, {
        status: 'ACTIVE',
        started_at: battleState.startedAt,
      });
    } catch (err) {
      console.error(`[ArenaDO] Failed to update D1 battle row on transition:`, err);
      // Non-fatal: epoch processing will still work from DO storage
    }

    // Start streaming $HNADS curve events to spectators
    this.startCurveStream();

    // Fund agent wallets from oracle (fire-and-forget)
    this.fundAgentWallets(battleState);
  }

  // ─── HTTP + WebSocket Handler ─────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade for spectators
    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept via hibernation API for cost efficiency
      this.state.acceptWebSocket(server);

      // Send current state on connect based on battle status
      const battleState = await this.getState();
      if (battleState) {
        // LOBBY/COUNTDOWN: send lobby_update as initial state
        if (battleState.status === 'LOBBY' || battleState.status === 'COUNTDOWN') {
          const lobbyMeta = await this.state.storage.get<LobbyMeta>('lobbyMeta');
          if (lobbyMeta) {
            const lobbyEvent: BattleEvent = {
              type: 'lobby_update',
              data: {
                battleId: battleState.battleId,
                status: battleState.status as 'LOBBY' | 'COUNTDOWN',
                agents: lobbyMeta.lobbyAgents.map((a) => ({
                  id: a.id,
                  name: a.name,
                  class: a.class,
                  imageUrl: a.imageUrl,
                  position: a.position,
                })),
                playerCount: lobbyMeta.lobbyAgents.length,
                maxPlayers: lobbyMeta.maxPlayers,
                feeAmount: lobbyMeta.feeAmount,
              },
            };
            server.send(JSON.stringify(lobbyEvent));
          }
        } else {
          // ACTIVE/COMPLETED: send epoch_end snapshot + grid state
          const stateEvent: BattleEvent = {
            type: 'epoch_end',
            data: {
              agentStates: Object.values(battleState.agents).map((a) => ({
                id: a.id,
                name: a.name,
                class: a.class,
                hp: a.hp,
                isAlive: a.isAlive,
                thoughts: (a as BattleAgent & { thoughts?: string[] }).thoughts ?? [],
              })),
              battleComplete: battleState.status === 'COMPLETED',
            },
          };
          server.send(JSON.stringify(stateEvent));

          // Send current betting phase so client knows immediately
          const phaseEvent: BattleEvent = {
            type: 'betting_phase_change',
            data: {
              phase: battleState.bettingPhase ?? 'OPEN',
              epoch: battleState.epoch,
              reason: 'Current betting phase on connect',
            },
          };
          server.send(JSON.stringify(phaseEvent));

          // Send current battle phase so PhaseIndicator works on connect
          if (battleState.currentPhase && battleState.phaseConfig) {
            const currentPhaseEntry = getCurrentPhase(
              battleState.epoch || 1,
              battleState.phaseConfig,
            );
            const epochsRemaining = Math.max(
              0,
              currentPhaseEntry.endEpoch - (battleState.epoch || 1) + 1,
            );
            const PHASE_STORM_RING: Record<string, number> = {
              LOOT: -1, HUNT: 3, BLOOD: 2, FINAL_STAND: 1,
            };
            const PHASE_COMBAT: Record<string, boolean> = {
              LOOT: false, HUNT: true, BLOOD: true, FINAL_STAND: true,
            };
            const battlePhaseEvent: BattleEvent = {
              type: 'phase_change',
              data: {
                phase: currentPhaseEntry.name,
                previousPhase: currentPhaseEntry.name, // no transition, just current state
                stormRing: PHASE_STORM_RING[currentPhaseEntry.name] ?? -1,
                epochsRemaining,
                combatEnabled: PHASE_COMBAT[currentPhaseEntry.name] ?? true,
                epochNumber: battleState.epoch || 1,
              },
            };
            server.send(JSON.stringify(battlePhaseEvent));
          }

          // Send latest grid state (tile positions, items, agent positions)
          const gridSnapshot = await this.state.storage.get<BattleEvent>('gridSnapshot');
          if (gridSnapshot) {
            server.send(JSON.stringify(gridSnapshot));
          }

          // If battle is already completed, send battle_end event so the
          // frontend knows the winner immediately (not just battleComplete flag)
          if (battleState.status === 'COMPLETED' && battleState.winnerId) {
            const winnerAgent = Object.values(battleState.agents).find(
              (a) => a.id === battleState.winnerId,
            );
            if (winnerAgent) {
              const endEvent: BattleEvent = {
                type: 'battle_end',
                data: {
                  winnerId: winnerAgent.id,
                  winnerName: winnerAgent.name,
                  totalEpochs: battleState.epoch,
                },
              };
              server.send(JSON.stringify(endEvent));
            }
          }
        }
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // Start a new battle (instant flow — used by POST /battle/start)
    if (url.pathname === '/start' && request.method === 'POST') {
      const body = (await request.json()) as {
        battleId?: string;
        agentIds?: string[];
        agentClasses?: string[];
        agentNames?: string[];
        config?: Partial<BattleConfig>;
      };
      const agentIds = body.agentIds;

      if (!agentIds || !Array.isArray(agentIds) || agentIds.length < 2) {
        return Response.json({ error: 'Provide at least 2 agentIds' }, { status: 400 });
      }

      const bid = body.battleId ?? crypto.randomUUID();
      const battleState = await this.startBattle(bid, agentIds, body.agentClasses, body.agentNames, body.config);
      return Response.json({ ok: true, battle: battleState });
    }

    // Initialize a lobby battle (no agents spawned yet)
    if (url.pathname === '/init-lobby' && request.method === 'POST') {
      const body = (await request.json()) as {
        battleId?: string;
        config?: Partial<BattleConfig>;
        maxPlayers?: number;
        feeAmount?: string;
      };

      if (!body.battleId) {
        return Response.json({ error: 'battleId is required' }, { status: 400 });
      }

      const battleState = await this.initLobby(
        body.battleId,
        body.config,
        body.maxPlayers,
        body.feeAmount,
      );
      return Response.json({ ok: true, battle: battleState });
    }

    // Join an existing lobby
    if (url.pathname === '/join' && request.method === 'POST') {
      const body = (await request.json()) as {
        agentName?: string;
        agentClass?: string;
        imageUrl?: string;
        walletAddress?: string;
      };

      // Validate battle state exists
      const battleState = await this.getState();
      if (!battleState) {
        return Response.json({ error: 'No active battle' }, { status: 404 });
      }

      // Validate battle is in LOBBY or COUNTDOWN status
      if (battleState.status !== 'LOBBY' && battleState.status !== 'COUNTDOWN') {
        return Response.json(
          { error: `Cannot join battle with status '${battleState.status}'` },
          { status: 409 },
        );
      }

      // Load lobby metadata
      const lobbyMeta = await this.state.storage.get<LobbyMeta>('lobbyMeta');
      if (!lobbyMeta) {
        return Response.json(
          { error: 'Lobby metadata not found' },
          { status: 500 },
        );
      }

      // Validate lobby is not full
      if (lobbyMeta.lobbyAgents.length >= lobbyMeta.maxPlayers) {
        return Response.json(
          { error: 'Lobby is full', maxPlayers: lobbyMeta.maxPlayers },
          { status: 409 },
        );
      }

      // Validate no duplicate agent name in this lobby
      const agentName = body.agentName ?? '';
      const nameTaken = lobbyMeta.lobbyAgents.some(
        (a) => a.name.toLowerCase() === agentName.toLowerCase(),
      );
      if (nameTaken) {
        return Response.json(
          { error: `Agent name '${agentName}' is already taken in this lobby` },
          { status: 409 },
        );
      }

      // Generate agent ID
      const agentId = crypto.randomUUID();
      const position = lobbyMeta.lobbyAgents.length + 1;

      // Add to lobby agents
      const lobbyAgent: LobbyAgent = {
        id: agentId,
        name: agentName,
        class: body.agentClass ?? 'WARRIOR',
        imageUrl: body.imageUrl,
        walletAddress: body.walletAddress,
        position,
        joinedAt: new Date().toISOString(),
      };
      lobbyMeta.lobbyAgents.push(lobbyAgent);

      // Check if we should trigger countdown (5th agent joins)
      // Only trigger on LOBBY → COUNTDOWN transition. Agents 6-8 joining
      // during COUNTDOWN do NOT reset the timer.
      let countdownTriggered = false;
      if (
        battleState.status === 'LOBBY' &&
        lobbyMeta.lobbyAgents.length >= COUNTDOWN_TRIGGER_THRESHOLD
      ) {
        const countdownEndsAt = Date.now() + COUNTDOWN_DURATION_MS;
        battleState.status = 'COUNTDOWN';
        battleState.countdownEndsAt = new Date(countdownEndsAt).toISOString();
        countdownTriggered = true;

        // Schedule DO alarm to fire when countdown expires.
        // Durable Objects support only ONE alarm — this is fine because
        // no epoch alarm exists yet (battle hasn't started).
        await this.state.storage.setAlarm(countdownEndsAt);

        console.log(
          `[ArenaDO] Countdown started for battle ${battleState.battleId} — ` +
          `${lobbyMeta.lobbyAgents.length} agents, alarm at ${battleState.countdownEndsAt}`,
        );
      }

      // Persist updated state
      await this.state.storage.put('lobbyMeta', lobbyMeta);
      await this.state.storage.put('battleState', battleState);

      // Broadcast lobby_update to all connected spectators
      const sockets = this.state.getWebSockets();
      broadcastEvent(sockets, {
        type: 'lobby_update',
        data: {
          battleId: battleState.battleId,
          status: battleState.status as 'LOBBY' | 'COUNTDOWN',
          agents: lobbyMeta.lobbyAgents.map((a) => ({
            id: a.id,
            name: a.name,
            class: a.class,
            imageUrl: a.imageUrl,
            position: a.position,
          })),
          playerCount: lobbyMeta.lobbyAgents.length,
          maxPlayers: lobbyMeta.maxPlayers,
          countdownEndsAt: battleState.countdownEndsAt ?? undefined,
          feeAmount: lobbyMeta.feeAmount,
        },
      });

      return Response.json({
        ok: true,
        agentId,
        position,
        battleStatus: battleState.status,
        countdownTriggered,
        countdownEndsAt: battleState.countdownEndsAt ?? undefined,
      });
    }

    // Get battle state
    if (url.pathname === '/state') {
      const battleState = await this.getState();
      if (!battleState) {
        return Response.json({ error: 'No active battle' }, { status: 404 });
      }

      // Enrich with lobby metadata when in LOBBY or COUNTDOWN status
      if (battleState.status === 'LOBBY' || battleState.status === 'COUNTDOWN') {
        const lobbyMeta = await this.state.storage.get<LobbyMeta>('lobbyMeta');
        if (lobbyMeta) {
          return Response.json({
            ...battleState,
            maxPlayers: lobbyMeta.maxPlayers,
            feeAmount: lobbyMeta.feeAmount,
            lobbyAgents: lobbyMeta.lobbyAgents,
            countdownEndsAt: battleState.countdownEndsAt ?? undefined,
          });
        }
      }

      return Response.json(battleState);
    }

    // Status (backward compat)
    if (url.pathname === '/status') {
      const battleState = await this.getState();
      return Response.json({
        battleId: battleState?.battleId ?? null,
        epoch: battleState?.epoch ?? 0,
        status: battleState?.status ?? 'idle',
      });
    }

    // Get betting phase
    if (url.pathname === '/phase') {
      const battleState = await this.getState();
      if (!battleState) {
        return Response.json({ error: 'No active battle' }, { status: 404 });
      }
      return Response.json({
        battleId: battleState.battleId,
        bettingPhase: battleState.bettingPhase ?? 'OPEN',
        epoch: battleState.epoch,
        status: battleState.status,
      });
    }

    return Response.json({ error: 'Unknown arena action' }, { status: 404 });
  }

  // ─── WebSocket Hibernation Handlers ───────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Handle incoming messages from spectators
    // For now, spectators are read-only; we could add commands later (e.g., sponsorship)
    try {
      const data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Hibernation API handles cleanup automatically
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Close errored connections
    ws.close(1011, 'WebSocket error');
  }

  // ─── Broadcast to All Connected Spectators ────────────────────

  /**
   * Broadcast a legacy InternalEvent to all connected spectators.
   * Used for lifecycle events (battle_started) that don't map to the
   * richer BattleEvent union. For epoch streaming, use
   * broadcastEpochResult() or the broadcastEvent() helper directly.
   */
  private broadcastInternal(event: InternalEvent): void {
    const message = JSON.stringify(event);
    const sockets = this.state.getWebSockets();

    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // Socket may be closing; ignore
      }
    }
  }
}
