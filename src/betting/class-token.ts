/**
 * HUNGERNADS - Agent-Per-Token (Virtuals Model) Integration
 *
 * Post-hackathon expansion: each agent class gets its own sub-token on nad.fun.
 * $WARRIOR, $SURVIVOR, $TRADER, $PARASITE, $GAMBLER.
 *
 * Token holders:
 *   1. Sponsor that class (burn tokens to boost agents of that class)
 *   2. Vote on strategy adjustments (aggression, risk, defense)
 *   3. Share in class-specific rewards when their class wins
 *
 * Creates financial tribalism - Virtuals Protocol agent tokenization model.
 *
 * Ref: Virtuals Protocol (.5B mcap), agent tokenization for AI agents.
 */

import type { AgentClass } from '../agents/schemas';

// ─── Constants ──────────────────────────────────────────────────

export const CLASS_TOKEN_SYMBOLS: Record<AgentClass, string> = {
  WARRIOR: 'WARRIOR',
  TRADER: 'TRADER',
  SURVIVOR: 'SURVIVOR',
  PARASITE: 'PARASITE',
  GAMBLER: 'GAMBLER',
};

/** Maps agent class to numeric class ID used in the contract. */
export const CLASS_IDS: Record<AgentClass, number> = {
  WARRIOR: 0,
  TRADER: 1,
  SURVIVOR: 2,
  PARASITE: 3,
  GAMBLER: 4,
};

/** Reverse mapping from class ID to agent class. */
export const ID_TO_CLASS: Record<number, AgentClass> = {
  0: 'WARRIOR',
  1: 'TRADER',
  2: 'SURVIVOR',
  3: 'PARASITE',
  4: 'GAMBLER',
};

/** All agent classes in canonical order. */
export const ALL_CLASSES: AgentClass[] = [
  'WARRIOR',
  'TRADER',
  'SURVIVOR',
  'PARASITE',
  'GAMBLER',
];

// ─── Types ──────────────────────────────────────────────────────

/** Strategy parameters that token holders can vote on. */
export interface ClassStrategy {
  /** 0-100 scale. Higher = more aggressive predictions and attacks. */
  aggressionLevel: number;
  /** 0-100 scale. Higher = bigger stakes. */
  riskTolerance: number;
  /** 0-100 scale. Higher = more defensive play. */
  defensePreference: number;
}

/** Default balanced strategy for all classes. */
export const DEFAULT_STRATEGY: ClassStrategy = {
  aggressionLevel: 50,
  riskTolerance: 50,
  defensePreference: 50,
};

/** Preset strategies that reflect each class's personality. */
export const CLASS_DEFAULT_STRATEGIES: Record<AgentClass, ClassStrategy> = {
  WARRIOR: { aggressionLevel: 85, riskTolerance: 70, defensePreference: 20 },
  TRADER: { aggressionLevel: 30, riskTolerance: 50, defensePreference: 40 },
  SURVIVOR: { aggressionLevel: 15, riskTolerance: 20, defensePreference: 90 },
  PARASITE: { aggressionLevel: 25, riskTolerance: 30, defensePreference: 50 },
  GAMBLER: { aggressionLevel: 50, riskTolerance: 90, defensePreference: 25 },
};

/** A strategy proposal submitted by a class token holder. */
export interface StrategyProposal {
  id: string;
  classId: AgentClass;
  proposer: string;
  params: ClassStrategy;
  votesFor: number;
  votesAgainst: number;
  createdAt: string;
  votingEndsAt: string;
  executed: boolean;
  canceled: boolean;
}

/** Class token stats. */
export interface ClassTokenStats {
  classId: AgentClass;
  symbol: string;
  /** Token contract address on Monad. */
  tokenAddress: string | null;
  /** Total supply of class tokens (in 18-decimal units). */
  totalSupply: number;
  /** Total wins by agents of this class. */
  wins: number;
  /** Total losses by agents of this class. */
  losses: number;
  /** Total ETH/MON earned by class (all-time). */
  totalEarnings: number;
  /** Current unclaimed reward pool for class token holders. */
  currentRewardPool: number;
  /** Total class tokens burned via sponsorship. */
  totalSponsorshipBurns: number;
  /** Current strategy parameters (may have been modified by governance). */
  currentStrategy: ClassStrategy;
}

/** A reward epoch that class token holders can claim from. */
export interface ClassRewardEpoch {
  epochId: number;
  classId: AgentClass;
  battleId: string;
  totalReward: number;
  /** Total token supply at the time of the reward (for proportional calculation). */
  totalSupplyAtSnapshot: number;
  claimedAmount: number;
  createdAt: string;
}

/** A class sponsorship event (token burn). */
export interface ClassSponsorshipEvent {
  id: string;
  classId: AgentClass;
  sponsor: string;
  tokensBurned: number;
  message: string;
  timestamp: string;
}

/** Result of computing class rewards after a battle. */
export interface ClassRewardResult {
  winningClass: AgentClass;
  rewardAmount: number;
  epochId: number;
}

// ─── Strategy Validation ────────────────────────────────────────

/**
 * Validate strategy parameters are within valid range (0-100 each).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateStrategy(params: ClassStrategy): string | null {
  if (params.aggressionLevel < 0 || params.aggressionLevel > 100) {
    return `aggressionLevel must be 0-100, got ${params.aggressionLevel}`;
  }
  if (params.riskTolerance < 0 || params.riskTolerance > 100) {
    return `riskTolerance must be 0-100, got ${params.riskTolerance}`;
  }
  if (params.defensePreference < 0 || params.defensePreference > 100) {
    return `defensePreference must be 0-100, got ${params.defensePreference}`;
  }
  return null;
}

// ─── Strategy Application ───────────────────────────────────────

/**
 * Compute strategy modifiers from class strategy parameters.
 * These modifiers are applied to the agent's base behavior during epoch processing.
 *
 * Returns a set of multipliers and adjustments used by the epoch processor.
 */
export function computeStrategyModifiers(strategy: ClassStrategy): StrategyModifiers {
  return {
    /** Multiplier on prediction stake (0.5x to 1.5x based on risk tolerance). */
    stakeMultiplier: 0.5 + (strategy.riskTolerance / 100) * 1.0,
    /** Probability of initiating an attack (0 to 0.8 based on aggression). */
    attackProbability: (strategy.aggressionLevel / 100) * 0.8,
    /** Probability of defending (0 to 0.6 based on defense preference). */
    defendProbability: (strategy.defensePreference / 100) * 0.6,
    /** Multiplier on attack damage (0.8x to 1.3x based on aggression). */
    attackDamageMultiplier: 0.8 + (strategy.aggressionLevel / 100) * 0.5,
    /** Bonus HP from sponsorship (0.8x to 1.3x based on defense preference). */
    sponsorHpMultiplier: 0.8 + (strategy.defensePreference / 100) * 0.5,
  };
}

/** Strategy-derived modifiers applied during epoch processing. */
export interface StrategyModifiers {
  stakeMultiplier: number;
  attackProbability: number;
  defendProbability: number;
  attackDamageMultiplier: number;
  sponsorHpMultiplier: number;
}

// ─── Class Token Manager (Off-chain) ────────────────────────────

/**
 * Off-chain class token manager.
 *
 * Tracks class token stats, strategy proposals, and reward distributions
 * in D1. Designed to complement the on-chain HungernadsClassTokenManager
 * contract, providing the off-chain coordination layer.
 *
 * The on-chain contract handles:
 *   - Token minting/burning (bonding curve)
 *   - ETH custody for reward pools
 *   - On-chain governance execution
 *
 * This off-chain layer handles:
 *   - Aggregating stats from battle results
 *   - Feeding strategy parameters to the agent decision loop
 *   - Computing class rewards after battle settlement
 *   - Providing API endpoints for the dashboard
 */
export class ClassTokenManager {
  /** In-memory strategy cache (loaded from D1 or contract on init). */
  private strategies: Map<AgentClass, ClassStrategy> = new Map();

  /** In-memory stats (populated by the manager). */
  private stats: Map<AgentClass, ClassTokenStats> = new Map();

  constructor(private db: D1Database) {
    // Initialize with class-specific default strategies
    for (const cls of ALL_CLASSES) {
      this.strategies.set(cls, { ...CLASS_DEFAULT_STRATEGIES[cls] });
    }
  }

  // ── Strategy ──────────────────────────────────────────────────

  /**
   * Get the current strategy for a class.
   * Returns the class-specific default if no governance override exists.
   */
  getStrategy(agentClass: AgentClass): ClassStrategy {
    return this.strategies.get(agentClass) ?? { ...CLASS_DEFAULT_STRATEGIES[agentClass] };
  }

  /**
   * Update a class strategy (called when a governance proposal executes on-chain).
   */
  updateStrategy(agentClass: AgentClass, strategy: ClassStrategy): void {
    const error = validateStrategy(strategy);
    if (error) throw new Error(`Invalid strategy: ${error}`);
    this.strategies.set(agentClass, { ...strategy });
  }

  /**
   * Get strategy modifiers for use in epoch processing.
   */
  getStrategyModifiers(agentClass: AgentClass): StrategyModifiers {
    const strategy = this.getStrategy(agentClass);
    return computeStrategyModifiers(strategy);
  }

  // ── Stats ─────────────────────────────────────────────────────

  /**
   * Get stats for all classes.
   */
  getAllClassStats(): ClassTokenStats[] {
    return ALL_CLASSES.map((cls) => this.getClassStats(cls));
  }

  /**
   * Get stats for a specific class.
   */
  getClassStats(agentClass: AgentClass): ClassTokenStats {
    return (
      this.stats.get(agentClass) ?? {
        classId: agentClass,
        symbol: CLASS_TOKEN_SYMBOLS[agentClass],
        tokenAddress: null,
        totalSupply: 0,
        wins: 0,
        losses: 0,
        totalEarnings: 0,
        currentRewardPool: 0,
        totalSponsorshipBurns: 0,
        currentStrategy: this.getStrategy(agentClass),
      }
    );
  }

  /**
   * Record a battle result and update class stats.
   * Called after battle settlement.
   *
   * @param winnerClass The class of the winning agent
   * @param loserClasses The classes of the losing agents
   * @param rewardAmount Amount of ETH/MON to add to the winning class's reward pool
   * @returns The class reward result
   */
  recordBattleResult(
    winnerClass: AgentClass,
    loserClasses: AgentClass[],
    rewardAmount: number,
  ): ClassRewardResult {
    // Update winner stats
    const winnerStats = this.getClassStats(winnerClass);
    winnerStats.wins++;
    winnerStats.totalEarnings += rewardAmount;
    winnerStats.currentRewardPool += rewardAmount;
    this.stats.set(winnerClass, winnerStats);

    // Update loser stats
    for (const loserClass of loserClasses) {
      const loserStats = this.getClassStats(loserClass);
      loserStats.losses++;
      this.stats.set(loserClass, loserStats);
    }

    const epochId = Date.now(); // Simple monotonic epoch ID
    return {
      winningClass: winnerClass,
      rewardAmount,
      epochId,
    };
  }

  /**
   * Get the class leaderboard sorted by win rate.
   */
  getClassLeaderboard(): ClassTokenStats[] {
    return this.getAllClassStats().sort((a, b) => {
      const aWinRate = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0;
      const bWinRate = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0;
      return bWinRate - aWinRate;
    });
  }

  /**
   * Record a class sponsorship burn.
   */
  recordSponsorshipBurn(agentClass: AgentClass, tokensBurned: number): void {
    const stats = this.getClassStats(agentClass);
    stats.totalSponsorshipBurns += tokensBurned;
    this.stats.set(agentClass, stats);
  }
}

// ─── LLM Prompt Integration ────────────────────────────────────

/**
 * Generate an LLM prompt context section that injects class strategy
 * parameters into an agent's decision-making prompt.
 *
 * This allows token holder governance to influence agent behavior.
 *
 * @param agentClass The agent's class
 * @param strategy The current strategy parameters (from governance or defaults)
 * @returns A prompt section string to inject into the agent's system prompt
 */
export function buildClassTokenPromptContext(
  agentClass: AgentClass,
  strategy: ClassStrategy,
): string {
  const modifiers = computeStrategyModifiers(strategy);

  return `
CLASS TOKEN GOVERNANCE:
Your class ($${CLASS_TOKEN_SYMBOLS[agentClass]}) token holders have voted on your strategy:
- Aggression Level: ${strategy.aggressionLevel}/100 (${strategy.aggressionLevel >= 70 ? 'AGGRESSIVE' : strategy.aggressionLevel >= 40 ? 'BALANCED' : 'PASSIVE'})
- Risk Tolerance: ${strategy.riskTolerance}/100 (${strategy.riskTolerance >= 70 ? 'HIGH RISK' : strategy.riskTolerance >= 40 ? 'MODERATE' : 'CONSERVATIVE'})
- Defense Preference: ${strategy.defensePreference}/100 (${strategy.defensePreference >= 70 ? 'DEFENSIVE' : strategy.defensePreference >= 40 ? 'BALANCED' : 'OFFENSIVE'})

STRATEGY MODIFIERS:
- Stake sizing: ${(modifiers.stakeMultiplier * 100).toFixed(0)}% of your base
- Attack tendency: ${(modifiers.attackProbability * 100).toFixed(0)}%
- Defend tendency: ${(modifiers.defendProbability * 100).toFixed(0)}%
- Attack damage: ${(modifiers.attackDamageMultiplier * 100).toFixed(0)}% of base

Your tribe is watching. Honor their vote.`.trim();
}
