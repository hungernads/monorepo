/**
 * HUNGERNADS - Arena Manager
 *
 * Battle lifecycle manager. Spawns agents, tracks state transitions,
 * detects winners, and produces a battle record on completion.
 *
 * The ArenaManager ties together all the engine pieces but does NOT
 * run epochs itself -- that's the epoch processor's job.
 *
 * Two lifecycle paths:
 *
 * Classic (CLI/quick-start):
 *   PENDING -> BETTING_OPEN -> ACTIVE -> COMPLETED
 *
 * Lobby (multiplayer join):
 *   LOBBY -> COUNTDOWN -> ACTIVE -> COMPLETED
 *   LOBBY -> CANCELLED  (timeout / not enough players)
 *   COUNTDOWN -> CANCELLED  (manual cancel)
 */

import { BaseAgent } from '../agents/base-agent';
import { WarriorAgent } from '../agents/warrior';
import { TraderAgent } from '../agents/trader';
import { SurvivorAgent } from '../agents/survivor';
import { ParasiteAgent } from '../agents/parasite';
import { GamblerAgent } from '../agents/gambler';
import type { AgentClass, ArenaAgentState, HexCoord } from '../agents/schemas';
import { pickAgentName } from '../agents/names';
import { assignInitialPositions, getAdjacentAgents, buildSpatialContext } from './grid';
import {
  createGrid,
  placeAgent,
  removeAgent as removeAgentFromGrid,
  getEmptyTiles,
  getOuterRingTiles,
  getTilesByType,
  serializeGrid,
  hexKey,
} from './hex-grid';
import type { HexGridState } from './hex-grid';
import {
  spawnCornucopiaItems,
  addItemsToGrid,
  tickItemBuffs,
  addBuff,
} from './items';
import type { ItemBuff, BuffTickResult } from './items';
import type { BattleStatus, BattlePhase } from './types/status';
import {
  computePhaseConfig,
  getCurrentPhase,
  type PhaseConfig,
  type PhaseEntry,
} from './phases';

// Re-export BattleStatus so consumers can import from arena.ts or arena/index.ts
export type { BattleStatus } from './types/status';
export type { BattlePhase } from './types/status';
export type { PhaseConfig, PhaseEntry } from './phases';
export { computePhaseConfig, getCurrentPhase } from './phases';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serializable battle state for broadcasting to spectators / API consumers. */
export interface BattleState {
  battleId: string;
  status: BattleStatus;
  epochCount: number;
  agents: ArenaAgentState[];
  startedAt: string | null;
  endedAt: string | null;
  winnerId: string | null;
  winnerName: string | null;
  /** Serialized hex grid state (37-tile arena). */
  grid?: ReturnType<typeof serializeGrid>;
  /** Lobby agents waiting to be spawned (only present in LOBBY/COUNTDOWN status). */
  lobbyAgents?: LobbyAgent[];
  /** ISO timestamp when countdown ends (only present in COUNTDOWN status). */
  countdownEndsAt?: string | null;
  /** Current battle phase (only present during ACTIVE status). */
  currentPhase?: BattlePhase;
  /** Phase configuration for this battle (set when battle starts). */
  phaseConfig?: PhaseConfig;
}

/** Record of an eliminated agent, produced when eliminateAgent() is called. */
export interface EliminationRecord {
  agentId: string;
  agentName: string;
  agentClass: AgentClass;
  eliminatedAtEpoch: number;
  finalHp: number;
}

/**
 * Pre-spawn agent data for lobby-based battles.
 * Holds all the information needed to instantiate an agent when the battle starts,
 * without actually creating a BaseAgent instance yet.
 */
export interface LobbyAgent {
  /** Unique agent ID (generated on join). */
  id: string;
  /** Display name chosen by the player or auto-generated. */
  name: string;
  /** Agent class (WARRIOR, TRADER, etc.). */
  agentClass: AgentClass;
  /** Optional profile image URL. */
  imageUrl?: string;
  /** Wallet address of the player who joined. */
  walletAddress?: string;
  /** ISO timestamp when the agent joined the lobby. */
  joinedAt: string;
}

/** Complete battle record produced on completion, suitable for DB persistence. */
export interface BattleRecord {
  battleId: string;
  status: 'COMPLETED' | 'CANCELLED';
  epochCount: number;
  startedAt: string;
  endedAt: string;
  winnerId: string | null;
  winnerName: string | null;
  winnerClass: AgentClass | null;
  roster: Array<{
    agentId: string;
    agentName: string;
    agentClass: AgentClass;
    finalHp: number;
    kills: number;
    epochsSurvived: number;
    isAlive: boolean;
  }>;
  eliminations: EliminationRecord[];
}

/** Agent count limits for battles. */
export const MIN_AGENTS = 2;
export const MAX_AGENTS = 20;

export interface BattleConfig {
  maxEpochs: number;
  epochIntervalMs: number;
  /** Initial status for the battle. Defaults to PENDING (classic flow). Set to LOBBY for lobby flow. */
  initialStatus?: 'PENDING' | 'LOBBY';
  /** Countdown duration in ms (LOBBY → COUNTDOWN → ACTIVE). Default 30 seconds. */
  countdownDurationMs?: number;
  /** Minimum agents required to start countdown. Default 2. */
  minLobbyAgents?: number;
  /** Maximum agents allowed in lobby. Default MAX_AGENTS (20). */
  maxLobbyAgents?: number;
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  maxEpochs: 16, // Default for 5 agents (computed dynamically via computePhaseConfig at battle start)
  epochIntervalMs: 5 * 60 * 1000, // 5 minutes
  initialStatus: 'PENDING',
  countdownDurationMs: 30_000, // 30 seconds
  minLobbyAgents: MIN_AGENTS,
  maxLobbyAgents: MAX_AGENTS,
};

/** All five agent classes in canonical order. */
const ALL_CLASSES: AgentClass[] = ['WARRIOR', 'TRADER', 'SURVIVOR', 'PARASITE', 'GAMBLER'];

// ---------------------------------------------------------------------------
// Factory: instantiate agent from class
// ---------------------------------------------------------------------------

function createAgent(agentClass: AgentClass, id: string, name: string): BaseAgent {
  switch (agentClass) {
    case 'WARRIOR':
      return new WarriorAgent(id, name);
    case 'TRADER':
      return new TraderAgent(id, name);
    case 'SURVIVOR':
      return new SurvivorAgent(id, name);
    case 'PARASITE':
      return new ParasiteAgent(id, name);
    case 'GAMBLER':
      return new GamblerAgent(id, name);
    default: {
      const _exhaustive: never = agentClass;
      throw new Error(`Unknown agent class: ${_exhaustive}`);
    }
  }
}

// pickName is now handled by pickAgentName from '../agents/names'

// ---------------------------------------------------------------------------
// ArenaManager
// ---------------------------------------------------------------------------

export class ArenaManager {
  public readonly battleId: string;
  public status: BattleStatus;
  public agents: Map<string, BaseAgent>;
  public epochCount: number;
  public startedAt: Date | null;
  public endedAt: Date | null;
  public readonly config: BattleConfig;

  /** 37-tile hex grid state (tiles, occupants, items). */
  public grid: HexGridState;
  /** Active item buffs per agent (agentId -> ItemBuff[]). */
  public agentBuffs: Map<string, ItemBuff[]>;

  /** Lobby agents waiting to be spawned (lobby flow only). Keyed by agent ID. */
  public lobbyAgents: Map<string, LobbyAgent>;
  /** ISO timestamp when countdown ends and battle should start (set by startCountdown). */
  public countdownEndsAt: string | null;
  /** ISO timestamp when the battle was cancelled (set by cancelBattle). */
  public cancelledAt: string | null;

  /**
   * Phase configuration for this battle. Computed from player count when the
   * battle starts. Null before battle is ACTIVE.
   */
  public phaseConfig: PhaseConfig | null;

  private eliminations: EliminationRecord[];

  constructor(battleId: string, config: Partial<BattleConfig> = {}) {
    this.battleId = battleId;
    this.config = { ...DEFAULT_BATTLE_CONFIG, ...config };
    this.status = this.config.initialStatus ?? 'PENDING';
    this.agents = new Map();
    this.epochCount = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.cancelledAt = null;
    this.eliminations = [];
    this.grid = createGrid(); // 37-tile hex grid (radius 3)
    this.agentBuffs = new Map();
    this.lobbyAgents = new Map();
    this.countdownEndsAt = null;
    this.phaseConfig = null;
  }

  // -------------------------------------------------------------------------
  // Agent Spawning
  // -------------------------------------------------------------------------

  /**
   * Spawn agents from the given class list.
   * Defaults to one of each class (5 agents) if no list provided.
   *
   * Can only be called while the battle is in PENDING status.
   * Throws if called after agents are already spawned or battle is active.
   */
  spawnAgents(classes?: AgentClass[]): void {
    if (this.status !== 'PENDING') {
      throw new Error(`Cannot spawn agents: battle is ${this.status}, expected PENDING`);
    }
    if (this.agents.size > 0) {
      throw new Error('Agents already spawned for this battle');
    }

    const classList = classes ?? ALL_CLASSES;
    if (classList.length < MIN_AGENTS) {
      throw new Error(`Need at least ${MIN_AGENTS} agents for a battle, got ${classList.length}`);
    }
    if (classList.length > MAX_AGENTS) {
      throw new Error(`Cannot exceed ${MAX_AGENTS} agents per battle, got ${classList.length}`);
    }

    const usedNames = new Set<string>();
    const agentIds: string[] = [];

    for (const agentClass of classList) {
      const id = crypto.randomUUID();
      const name = pickAgentName(agentClass, usedNames);
      usedNames.add(name);
      const agent = createAgent(agentClass, id, name);
      this.agents.set(id, agent);
      agentIds.push(id);
    }

    // Place agents on outer ring (Lv1, ring 3) tiles only — 18 EDGE tiles available
    const outerTiles = getOuterRingTiles(this.grid);
    // Shuffle outer tiles for random placement
    const shuffled = [...outerTiles];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (let i = 0; i < agentIds.length; i++) {
      const tile = shuffled[i % shuffled.length];
      const pos = tile.coord;
      const agentId = agentIds[i];
      this.grid = placeAgent(agentId, pos, this.grid);
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.position = { q: pos.q, r: pos.r };
      }
    }

    // Also assign positions via the old 7-hex system for backward compat
    const positions = assignInitialPositions(agentIds);
    // (Positions from the 37-tile grid take precedence; old positions are overwritten above)
  }

  // -------------------------------------------------------------------------
  // Lobby Agent Management (lobby flow only)
  // -------------------------------------------------------------------------

  /**
   * Add an agent to the lobby. Does NOT spawn on the grid yet.
   * Can only be called while the battle is in LOBBY or COUNTDOWN status.
   *
   * Returns the LobbyAgent that was added.
   * Throws if the lobby is full or the battle is not in a lobby-compatible state.
   */
  addLobbyAgent(agent: Omit<LobbyAgent, 'joinedAt'>): LobbyAgent {
    if (this.status !== 'LOBBY' && this.status !== 'COUNTDOWN') {
      throw new Error(`Cannot add lobby agent: battle is ${this.status}, expected LOBBY or COUNTDOWN`);
    }

    const maxLobby = this.config.maxLobbyAgents ?? MAX_AGENTS;
    if (this.lobbyAgents.size >= maxLobby) {
      throw new Error(`Lobby is full (max ${maxLobby} agents)`);
    }

    if (this.lobbyAgents.has(agent.id)) {
      throw new Error(`Agent ${agent.id} already in lobby`);
    }

    const lobbyAgent: LobbyAgent = {
      ...agent,
      joinedAt: new Date().toISOString(),
    };

    this.lobbyAgents.set(agent.id, lobbyAgent);
    return lobbyAgent;
  }

  /**
   * Remove an agent from the lobby (e.g. player leaves before battle starts).
   * Can only be called while the battle is in LOBBY status.
   * Cannot remove during COUNTDOWN (they committed by staying).
   */
  removeLobbyAgent(agentId: string): void {
    if (this.status !== 'LOBBY') {
      throw new Error(`Cannot remove lobby agent: battle is ${this.status}, expected LOBBY`);
    }
    if (!this.lobbyAgents.has(agentId)) {
      throw new Error(`Agent ${agentId} not found in lobby`);
    }
    this.lobbyAgents.delete(agentId);
  }

  /** Get the current lobby agent count. */
  getLobbyAgentCount(): number {
    return this.lobbyAgents.size;
  }

  /** Check if the minimum number of agents have joined the lobby. */
  hasMinimumLobbyAgents(): boolean {
    const minRequired = this.config.minLobbyAgents ?? MIN_AGENTS;
    return this.lobbyAgents.size >= minRequired;
  }

  /**
   * Spawn all lobby agents onto the hex grid and into the agents map.
   * Converts LobbyAgent data into real BaseAgent instances placed on the grid.
   *
   * Call this when transitioning from COUNTDOWN → ACTIVE.
   * Throws if no lobby agents exist or agents are already spawned.
   */
  spawnFromLobby(): void {
    if (this.agents.size > 0) {
      throw new Error('Agents already spawned for this battle');
    }
    if (this.lobbyAgents.size === 0) {
      throw new Error('No lobby agents to spawn');
    }
    if (this.lobbyAgents.size < (this.config.minLobbyAgents ?? MIN_AGENTS)) {
      throw new Error(
        `Need at least ${this.config.minLobbyAgents ?? MIN_AGENTS} agents, only ${this.lobbyAgents.size} in lobby`
      );
    }

    const agentIds: string[] = [];

    for (const lobbyAgent of this.lobbyAgents.values()) {
      const agent = createAgent(lobbyAgent.agentClass, lobbyAgent.id, lobbyAgent.name);
      this.agents.set(lobbyAgent.id, agent);
      agentIds.push(lobbyAgent.id);
    }

    // Place agents on outer ring (Lv1, ring 3) tiles only — 18 EDGE tiles available
    const outerTiles = getOuterRingTiles(this.grid);
    const shuffled = [...outerTiles];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (let i = 0; i < agentIds.length; i++) {
      const tile = shuffled[i % shuffled.length];
      const pos = tile.coord;
      const agentId = agentIds[i];
      this.grid = placeAgent(agentId, pos, this.grid);
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.position = { q: pos.q, r: pos.r };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lobby Lifecycle Transitions
  // -------------------------------------------------------------------------

  /**
   * Start the countdown. Transition: LOBBY → COUNTDOWN.
   * Sets countdownEndsAt based on config.countdownDurationMs.
   *
   * Throws if minimum agents not reached or battle is not in LOBBY status.
   */
  startCountdown(): void {
    if (this.status !== 'LOBBY') {
      throw new Error(`Cannot start countdown: battle is ${this.status}, expected LOBBY`);
    }
    if (!this.hasMinimumLobbyAgents()) {
      const minRequired = this.config.minLobbyAgents ?? MIN_AGENTS;
      throw new Error(
        `Cannot start countdown: need at least ${minRequired} agents, only ${this.lobbyAgents.size} in lobby`
      );
    }

    this.status = 'COUNTDOWN';
    const durationMs = this.config.countdownDurationMs ?? 30_000;
    this.countdownEndsAt = new Date(Date.now() + durationMs).toISOString();
  }

  /**
   * Cancel the battle. Transition: LOBBY/COUNTDOWN → CANCELLED.
   * Terminal state -- no further transitions allowed.
   *
   * Throws if battle is not in a cancellable state.
   */
  cancelBattle(): void {
    if (this.status !== 'LOBBY' && this.status !== 'COUNTDOWN') {
      throw new Error(`Cannot cancel battle: status is ${this.status}, expected LOBBY or COUNTDOWN`);
    }

    this.status = 'CANCELLED';
    this.endedAt = new Date();
    this.cancelledAt = new Date().toISOString();
  }

  /**
   * Start a lobby battle. Transition: COUNTDOWN → ACTIVE.
   * Spawns lobby agents on the grid, records start time, and spawns cornucopia items.
   *
   * This is the lobby equivalent of startBattle() / startBattleImmediate().
   */
  startBattleFromLobby(): void {
    if (this.status !== 'COUNTDOWN') {
      throw new Error(`Cannot start battle from lobby: status is ${this.status}, expected COUNTDOWN`);
    }

    // Spawn lobby agents onto the grid
    this.spawnFromLobby();

    // Compute phase config from the number of spawned agents
    this.phaseConfig = computePhaseConfig(this.agents.size);

    this.status = 'ACTIVE';
    this.startedAt = new Date();

    // Spawn cornucopia items on the 7 center tiles
    const cornucopiaItems = spawnCornucopiaItems(this.grid);
    this.grid = addItemsToGrid(cornucopiaItems, this.grid);
  }

  // -------------------------------------------------------------------------
  // Battle Lifecycle Transitions (Classic Flow)
  // -------------------------------------------------------------------------

  /**
   * Open betting. Transition from PENDING -> BETTING_OPEN.
   * Agents must already be spawned.
   */
  openBetting(): void {
    if (this.status !== 'PENDING') {
      throw new Error(`Cannot open betting: battle is ${this.status}, expected PENDING`);
    }
    if (this.agents.size === 0) {
      throw new Error('Cannot open betting: no agents spawned');
    }
    this.status = 'BETTING_OPEN';
  }

  /**
   * Start the battle. Transition from BETTING_OPEN -> ACTIVE.
   * Records start time and spawns cornucopia items on center tiles.
   */
  startBattle(): void {
    if (this.status !== 'BETTING_OPEN') {
      throw new Error(`Cannot start battle: status is ${this.status}, expected BETTING_OPEN`);
    }
    // Compute phase config from agent count
    this.phaseConfig = computePhaseConfig(this.agents.size);

    this.status = 'ACTIVE';
    this.startedAt = new Date();

    // Spawn cornucopia items on the 7 center tiles (CORNUCOPIA zone)
    const cornucopiaItems = spawnCornucopiaItems(this.grid);
    this.grid = addItemsToGrid(cornucopiaItems, this.grid);
  }

  /**
   * Convenience: go from PENDING straight to ACTIVE (skipping betting phase).
   * Useful for testing and quick-start scenarios.
   */
  startBattleImmediate(): void {
    if (this.status !== 'PENDING') {
      throw new Error(`Cannot start battle immediately: status is ${this.status}, expected PENDING`);
    }
    if (this.agents.size === 0) {
      throw new Error('Cannot start battle: no agents spawned');
    }
    // Compute phase config from agent count
    this.phaseConfig = computePhaseConfig(this.agents.size);

    this.status = 'ACTIVE';
    this.startedAt = new Date();

    // Spawn cornucopia items on center tiles
    const cornucopiaItems = spawnCornucopiaItems(this.grid);
    this.grid = addItemsToGrid(cornucopiaItems, this.grid);
  }

  // -------------------------------------------------------------------------
  // Agent Queries
  // -------------------------------------------------------------------------

  /** Get all agents that are still alive. */
  getActiveAgents(): BaseAgent[] {
    return Array.from(this.agents.values()).filter(a => a.alive());
  }

  /** Get all agents (alive and dead). */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /** Get a specific agent by ID. */
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /** Resolve an agent by name (case-insensitive). Used for combat target resolution. */
  getAgentByName(name: string): BaseAgent | undefined {
    const lower = name.toLowerCase();
    for (const agent of this.agents.values()) {
      if (agent.name.toLowerCase() === lower) {
        return agent;
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Hex Grid Positioning
  // -------------------------------------------------------------------------

  /**
   * Get a map of all agent positions (agentId -> HexCoord).
   * Only includes agents that have a position assigned.
   */
  getAgentPositions(): Map<string, HexCoord> {
    const positions = new Map<string, HexCoord>();
    for (const [id, agent] of this.agents) {
      if (agent.position) {
        positions.set(id, agent.position);
      }
    }
    return positions;
  }

  /**
   * Get a name lookup map (agentId -> name) for all agents.
   * Used by the spatial context builder for LLM prompts.
   */
  getAgentNameMap(): Map<string, string> {
    const names = new Map<string, string>();
    for (const [id, agent] of this.agents) {
      names.set(id, agent.name);
    }
    return names;
  }

  /**
   * Get agents adjacent to a given agent (based on hex positions).
   * Returns BaseAgent instances for agents on neighboring hexes.
   */
  getAdjacentAgents(agentId: string): BaseAgent[] {
    const positions = this.getAgentPositions();
    const adjacentIds = getAdjacentAgents(agentId, positions);
    return adjacentIds
      .map(id => this.agents.get(id))
      .filter((a): a is BaseAgent => a !== undefined);
  }

  // -------------------------------------------------------------------------
  // Elimination
  // -------------------------------------------------------------------------

  /**
   * Mark an agent as eliminated. Records the elimination for the battle record.
   * The agent's HP should already be <= 0 and isAlive should be false before calling.
   *
   * If the agent is somehow still alive (coding error), this forces death.
   */
  eliminateAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found in battle ${this.battleId}`);
    }

    // Ensure agent is dead
    if (agent.alive()) {
      agent.hp = 0;
      agent.isAlive = false;
    }

    // Remove agent from the hex grid
    if (agent.position) {
      this.grid = removeAgentFromGrid(agent.position, this.grid);
    }

    // Only record the elimination once
    const alreadyRecorded = this.eliminations.some(e => e.agentId === agentId);
    if (!alreadyRecorded) {
      this.eliminations.push({
        agentId: agent.id,
        agentName: agent.name,
        agentClass: agent.agentClass,
        eliminatedAtEpoch: this.epochCount,
        finalHp: agent.hp,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Epoch Tracking
  // -------------------------------------------------------------------------

  /** Increment the epoch counter. Called by the epoch processor after each epoch. */
  incrementEpoch(): void {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Cannot increment epoch: battle is ${this.status}, expected ACTIVE`);
    }
    this.epochCount += 1;
  }

  // -------------------------------------------------------------------------
  // Win Condition
  // -------------------------------------------------------------------------

  /**
   * Check if the battle is complete (1 or fewer agents alive, or cancelled).
   * Does NOT transition state -- call completeBattle() or cancelBattle() for that.
   */
  isComplete(): boolean {
    if (this.status === 'COMPLETED') return true;
    if (this.status === 'CANCELLED') return true;
    if (this.status !== 'ACTIVE') return false;

    const alive = this.getActiveAgents();
    return alive.length <= 1;
  }

  /** Get the winner — last alive, or most kills if all REKT. Null if 2+ alive. */
  getWinner(): BaseAgent | null {
    const alive = this.getActiveAgents();
    if (alive.length === 1) return alive[0];
    if (alive.length === 0) {
      // All agents REKT — pick winner by most kills, random tiebreak
      const allAgents = Array.from(this.agents.values());
      const maxKills = Math.max(...allAgents.map(a => a.kills));
      const candidates = allAgents.filter(a => a.kills === maxKills);
      const winner = candidates[Math.floor(Math.random() * candidates.length)];
      console.log(
        `[ArenaManager] All agents REKT — winner by kills: ${winner.name} (${winner.kills} kills, ${candidates.length} tied)`
      );
      return winner;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Battle Completion
  // -------------------------------------------------------------------------

  /**
   * Complete the battle. Transition from ACTIVE -> COMPLETED.
   * Records end time and produces a full BattleRecord for persistence.
   *
   * Should only be called when isComplete() returns true.
   */
  completeBattle(): BattleRecord {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Cannot complete battle: status is ${this.status}, expected ACTIVE`);
    }

    this.status = 'COMPLETED';
    this.endedAt = new Date();

    const winner = this.getWinner();

    const roster = Array.from(this.agents.values()).map(agent => ({
      agentId: agent.id,
      agentName: agent.name,
      agentClass: agent.agentClass,
      finalHp: agent.hp,
      kills: agent.kills,
      epochsSurvived: agent.epochsSurvived,
      isAlive: agent.alive(),
    }));

    return {
      battleId: this.battleId,
      status: 'COMPLETED',
      epochCount: this.epochCount,
      startedAt: this.startedAt!.toISOString(),
      endedAt: this.endedAt.toISOString(),
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? null,
      winnerClass: winner?.agentClass ?? null,
      roster,
      eliminations: [...this.eliminations],
    };
  }

  // -------------------------------------------------------------------------
  // Serializable State (for broadcasting / API)
  // -------------------------------------------------------------------------

  /** Get a serializable snapshot of the current battle state. */
  getState(): BattleState {
    const agents: ArenaAgentState[] = Array.from(this.agents.values()).map(a => a.getState());
    const winner = this.getWinner();

    const state: BattleState = {
      battleId: this.battleId,
      status: this.status,
      epochCount: this.epochCount,
      agents,
      startedAt: this.startedAt?.toISOString() ?? null,
      endedAt: this.endedAt?.toISOString() ?? null,
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? null,
      grid: serializeGrid(this.grid),
    };

    // Include lobby-specific fields when relevant
    if (this.status === 'LOBBY' || this.status === 'COUNTDOWN') {
      state.lobbyAgents = Array.from(this.lobbyAgents.values());
      state.countdownEndsAt = this.countdownEndsAt;
    }

    // Include phase info during ACTIVE status
    if (this.phaseConfig && this.epochCount > 0) {
      const phase = getCurrentPhase(this.epochCount, this.phaseConfig);
      state.currentPhase = phase.name;
      state.phaseConfig = this.phaseConfig;
    } else if (this.phaseConfig) {
      // Battle is ACTIVE but no epochs yet — show first phase
      state.currentPhase = this.phaseConfig.phases[0]?.name;
      state.phaseConfig = this.phaseConfig;
    }

    return state;
  }

  /** Update the hex grid state (called by epoch processor after movement/items). */
  updateGrid(grid: HexGridState): void {
    this.grid = grid;
  }

  /** Tick all active item buffs. Called at the end of each epoch. */
  tickBuffs(): BuffTickResult[] {
    return tickItemBuffs(this.agentBuffs);
  }

  /** Add a buff to an agent. */
  addAgentBuff(agentId: string, buff: ItemBuff): void {
    addBuff(agentId, buff, this.agentBuffs);
  }

  /** Get elimination history. */
  getEliminations(): EliminationRecord[] {
    return [...this.eliminations];
  }
}
