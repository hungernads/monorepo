/**
 * HUNGERNADS - Base Agent Class
 *
 * Abstract agent class that all agent types extend.
 * Handles common logic: HP, decision-making interface, learning hooks, profiles.
 */

import type {
  AgentClass,
  EpochActions,
  Lesson,
  AgentProfile,
  ArenaState,
  ArenaAgentState,
  MatchupRecord,
} from './schemas';

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

export abstract class BaseAgent {
  public id: string;
  public name: string;
  public agentClass: AgentClass;
  public hp: number;
  public maxHp: number;
  public isAlive: boolean;
  public kills: number;
  public epochsSurvived: number;
  public lessons: Lesson[];

  constructor(id: string, name: string, agentClass: AgentClass) {
    this.id = id;
    this.name = name;
    this.agentClass = agentClass;
    this.hp = 1000;
    this.maxHp = 1000;
    this.isAlive = true;
    this.kills = 0;
    this.epochsSurvived = 0;
    this.lessons = [];
  }

  // -------------------------------------------------------------------------
  // Abstract methods - each agent class implements its own logic
  // -------------------------------------------------------------------------

  /**
   * Each agent class must implement its own decision logic.
   * Called once per epoch with the full arena state.
   */
  abstract decide(arenaState: ArenaState): Promise<EpochActions>;

  /**
   * Get the agent's personality prompt for LLM calls.
   */
  abstract getPersonality(): string;

  // -------------------------------------------------------------------------
  // HP management
  // -------------------------------------------------------------------------

  /**
   * Apply damage to this agent.
   * Returns the actual damage dealt (capped at current HP).
   */
  takeDamage(amount: number): number {
    if (amount < 0) return 0;
    const actual = Math.min(amount, this.hp);
    this.hp -= actual;
    if (this.hp <= 0) {
      this.hp = 0;
      this.isAlive = false;
    }
    return actual;
  }

  /**
   * Heal this agent. Cannot exceed maxHp.
   * Returns the actual amount healed.
   */
  heal(amount: number): number {
    if (amount < 0 || !this.isAlive) return 0;
    const headroom = this.maxHp - this.hp;
    const actual = Math.min(amount, headroom);
    this.hp += actual;
    return actual;
  }

  /**
   * Check if the agent is still alive.
   */
  alive(): boolean {
    return this.isAlive && this.hp > 0;
  }

  // -------------------------------------------------------------------------
  // Learning
  // -------------------------------------------------------------------------

  /**
   * Extract lessons from battle history. Typically called after each epoch or battle end.
   * Appends new lessons to the agent's lesson array and returns them.
   */
  async learn(
    battleId: string,
    epoch: number,
    context: string,
    outcome: string,
  ): Promise<Lesson> {
    // Generate learning and applied fields from context + outcome.
    // Subclasses can override for class-specific reflection, but this
    // provides a reasonable default.
    const lesson: Lesson = {
      battleId,
      epoch,
      context,
      outcome,
      learning: `From ${context}: ${outcome}`,
      applied: '', // Filled in when the lesson is actually used in a future decision
    };
    this.lessons.push(lesson);
    return lesson;
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  /**
   * Build a public-facing profile from this agent's accumulated data.
   * Used by the API to show stats to bettors.
   */
  getProfile(): AgentProfile {
    const totalBattles = this._countUniqueBattles();
    const wins = 0; // Determined externally by arena; override in arena context
    const emptyMatchups: Record<string, MatchupRecord> = {};

    return {
      agentId: this.id,
      agentClass: this.agentClass,
      totalBattles,
      wins,
      kills: this.kills,
      matchups: emptyMatchups,
      deathCauses: {},
      avgSurvival: this.epochsSurvived,
      winRate: totalBattles > 0 ? wins / totalBattles : 0,
      streak: 0,
      recentLessons: this.lessons.slice(-5),
    };
  }

  // -------------------------------------------------------------------------
  // State snapshot (for arena broadcasting)
  // -------------------------------------------------------------------------

  /**
   * Get current state snapshot matching ArenaAgentState schema.
   */
  getState(): ArenaAgentState {
    return {
      id: this.id,
      name: this.name,
      class: this.agentClass,
      hp: this.hp,
      maxHp: this.maxHp,
      isAlive: this.isAlive,
      kills: this.kills,
      epochsSurvived: this.epochsSurvived,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _countUniqueBattles(): number {
    const ids = new Set(this.lessons.map(l => l.battleId));
    return ids.size;
  }
}

// ---------------------------------------------------------------------------
// Default fallback actions
// ---------------------------------------------------------------------------

/**
 * Safe fallback actions when LLM fails or returns invalid data.
 * Small stake, random asset, no combat. Keeps the agent alive.
 */
export function getDefaultActions(agent: BaseAgent): EpochActions {
  const assets = ['ETH', 'BTC', 'SOL', 'MON'] as const;
  const asset = assets[Math.floor(Math.random() * assets.length)];
  const direction = Math.random() > 0.5 ? 'UP' : 'DOWN';

  return {
    prediction: {
      asset,
      direction,
      stake: 5, // Minimum stake - play it safe
    },
    // No attack, no defend - just survive
    reasoning: `[FALLBACK] ${agent.name} defaulted to safe prediction.`,
  };
}
