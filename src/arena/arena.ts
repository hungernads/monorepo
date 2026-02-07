/**
 * HUNGERNADS - Arena Manager
 *
 * Battle lifecycle manager. Spawns agents, tracks state transitions,
 * detects winners, and produces a battle record on completion.
 *
 * The ArenaManager ties together all the engine pieces but does NOT
 * run epochs itself -- that's the epoch processor's job.
 *
 * Lifecycle: PENDING -> BETTING_OPEN -> ACTIVE -> COMPLETED
 */

import { BaseAgent } from '../agents/base-agent';
import { WarriorAgent } from '../agents/warrior';
import { TraderAgent } from '../agents/trader';
import { SurvivorAgent } from '../agents/survivor';
import { ParasiteAgent } from '../agents/parasite';
import { GamblerAgent } from '../agents/gambler';
import type { AgentClass, ArenaAgentState } from '../agents/schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BattleStatus = 'PENDING' | 'BETTING_OPEN' | 'ACTIVE' | 'COMPLETED';

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
}

/** Record of an eliminated agent, produced when eliminateAgent() is called. */
export interface EliminationRecord {
  agentId: string;
  agentName: string;
  agentClass: AgentClass;
  eliminatedAtEpoch: number;
  finalHp: number;
}

/** Complete battle record produced on completion, suitable for DB persistence. */
export interface BattleRecord {
  battleId: string;
  status: 'COMPLETED';
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

export interface BattleConfig {
  maxEpochs: number;
  epochIntervalMs: number;
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  maxEpochs: 100,
  epochIntervalMs: 5 * 60 * 1000, // 5 minutes
};

// ---------------------------------------------------------------------------
// Agent names per class (thematic)
// ---------------------------------------------------------------------------

const AGENT_NAMES: Record<AgentClass, string[]> = {
  WARRIOR: ['Bloodfang', 'Ironjaw', 'Wrathbringer', 'Skullcrusher', 'Doomhammer'],
  TRADER: ['Quant', 'Fibonacci', 'Bollinger', 'Ichimoku', 'Stochastic'],
  SURVIVOR: ['Cockroach', 'Endurance', 'Tortoise', 'Wallflower', 'Persistence'],
  PARASITE: ['Leech', 'Mimic', 'Copycat', 'Shadow', 'Symbiote'],
  GAMBLER: ['Dice', 'Jackpot', 'Wildcard', 'Roulette', 'Chaos'],
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

/**
 * Pick a name for an agent class, cycling through the pool.
 * Uses a simple counter map to avoid duplicates within a battle.
 */
function pickName(agentClass: AgentClass, usedCounters: Map<AgentClass, number>): string {
  const pool = AGENT_NAMES[agentClass];
  const idx = usedCounters.get(agentClass) ?? 0;
  usedCounters.set(agentClass, idx + 1);
  return pool[idx % pool.length];
}

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

  private eliminations: EliminationRecord[];

  constructor(battleId: string, config: Partial<BattleConfig> = {}) {
    this.battleId = battleId;
    this.config = { ...DEFAULT_BATTLE_CONFIG, ...config };
    this.status = 'PENDING';
    this.agents = new Map();
    this.epochCount = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.eliminations = [];
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
    if (classList.length < 2) {
      throw new Error('Need at least 2 agents for a battle');
    }

    const nameCounters = new Map<AgentClass, number>();

    for (const agentClass of classList) {
      const id = crypto.randomUUID();
      const name = pickName(agentClass, nameCounters);
      const agent = createAgent(agentClass, id, name);
      this.agents.set(id, agent);
    }
  }

  // -------------------------------------------------------------------------
  // Battle Lifecycle Transitions
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
   * Records start time.
   */
  startBattle(): void {
    if (this.status !== 'BETTING_OPEN') {
      throw new Error(`Cannot start battle: status is ${this.status}, expected BETTING_OPEN`);
    }
    this.status = 'ACTIVE';
    this.startedAt = new Date();
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
    this.status = 'ACTIVE';
    this.startedAt = new Date();
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
   * Check if the battle is complete (1 or fewer agents alive).
   * Does NOT transition state -- call completeBattle() for that.
   */
  isComplete(): boolean {
    if (this.status === 'COMPLETED') return true;
    if (this.status !== 'ACTIVE') return false;

    const alive = this.getActiveAgents();
    return alive.length <= 1;
  }

  /** Get the winner if exactly one agent remains alive. Null if 0 or 2+ alive. */
  getWinner(): BaseAgent | null {
    const alive = this.getActiveAgents();
    if (alive.length === 1) return alive[0];
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

    return {
      battleId: this.battleId,
      status: this.status,
      epochCount: this.epochCount,
      agents,
      startedAt: this.startedAt?.toISOString() ?? null,
      endedAt: this.endedAt?.toISOString() ?? null,
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? null,
    };
  }

  /** Get elimination history. */
  getEliminations(): EliminationRecord[] {
    return [...this.eliminations];
  }
}
