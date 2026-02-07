/**
 * HUNGERNADS - Survivor Agent
 *
 * Defensive agent that outlasts everyone.
 * Tiny stakes (5-10%), never attacks, almost always defends.
 * Below 30% HP enters pure survival mode: minimum stakes, always defend.
 *
 * Unlike other agent classes, SURVIVOR enforces behavioral guardrails
 * post-LLM to ensure the class identity holds even if the LLM drifts.
 * The LLM still provides reasoning and asset/direction picks.
 */

import { BaseAgent, getDefaultActions } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, EpochActions } from './schemas';
import { PERSONALITIES } from './personalities';
import { agentDecision } from '../llm';

// ---------------------------------------------------------------------------
// Survivor configuration constants (from AGENT_CLASSES.md spec)
// ---------------------------------------------------------------------------

const SURVIVOR_CONFIG = {
  /** Minimum prediction stake (% of HP) */
  stakeMin: 5,
  /** Maximum prediction stake (% of HP) in normal mode */
  stakeMax: 10,
  /** Maximum stake in survival mode (below survivalThreshold) */
  survivalStakeMax: 5,
  /** HP percentage below which survival mode activates */
  survivalThreshold: 0.3,
  /** Probability of defending each epoch in normal mode */
  defendProbability: 0.9,
  /** Always defend below this HP ratio */
  alwaysDefendBelow: 0.3,
} as const;

// ---------------------------------------------------------------------------
// SurvivorAgent
// ---------------------------------------------------------------------------

export class SurvivorAgent extends BaseAgent {
  constructor(id: string, name: string) {
    super(id, name, 'SURVIVOR');
  }

  getPersonality(): string {
    return PERSONALITIES.SURVIVOR.systemPrompt;
  }

  async decide(arenaState: ArenaState): Promise<EpochActions> {
    const others = arenaState.agents
      .filter(a => a.id !== this.id && a.isAlive)
      .map(a => ({ name: a.name, class: a.class, hp: a.hp }));

    const hpRatio = this.hp / this.maxHp;
    const inSurvivalMode = hpRatio <= SURVIVOR_CONFIG.survivalThreshold;

    try {
      const result = await agentDecision(
        this.name,
        this.agentClass,
        this.getPersonality(),
        this.hp,
        {
          eth: arenaState.marketData.prices.ETH ?? 0,
          btc: arenaState.marketData.prices.BTC ?? 0,
          sol: arenaState.marketData.prices.SOL ?? 0,
          mon: arenaState.marketData.prices.MON ?? 0,
        },
        others,
        this.lessons.slice(-3).map(l => l.learning),
      );

      // -----------------------------------------------------------------
      // Enforce Survivor guardrails on top of LLM output
      // -----------------------------------------------------------------
      const enforced = this.enforceGuardrails(result, hpRatio, inSurvivalMode, others);

      const parsed = EpochActionsSchema.safeParse(enforced);

      if (!parsed.success) {
        console.warn(`[SURVIVOR:${this.name}] Invalid after enforcement, using defaults`);
        return this.getSurvivorDefaults(inSurvivalMode);
      }

      return parsed.data;
    } catch (error) {
      console.error(`[SURVIVOR:${this.name}] Decision failed:`, error);
      return this.getSurvivorDefaults(inSurvivalMode);
    }
  }

  // -----------------------------------------------------------------------
  // Guardrail enforcement
  // -----------------------------------------------------------------------

  /**
   * Clamp and override LLM output to match Survivor class rules.
   *
   * Rules enforced:
   * 1. Stake clamped to 5-10% (or 5% in survival mode)
   * 2. Attack is ALWAYS stripped -- Survivor never attacks
   * 3. Defend is forced based on probability / HP threshold
   */
  private enforceGuardrails(
    raw: Record<string, unknown>,
    hpRatio: number,
    inSurvivalMode: boolean,
    others: { name: string; class: string; hp: number }[],
  ): Record<string, unknown> {
    const prediction = raw.prediction as
      | { asset: string; direction: string; stake: number }
      | undefined;

    // --- Stake clamping ---
    const maxStake = inSurvivalMode
      ? SURVIVOR_CONFIG.survivalStakeMax
      : SURVIVOR_CONFIG.stakeMax;

    const clampedStake = prediction
      ? Math.max(SURVIVOR_CONFIG.stakeMin, Math.min(maxStake, prediction.stake))
      : SURVIVOR_CONFIG.stakeMin;

    // --- Defense logic ---
    // Always defend in survival mode or below threshold
    // Otherwise defend with 90% probability, skewing toward defense
    // when aggressive agents (WARRIOR, GAMBLER) are still alive
    let shouldDefend: boolean;

    if (inSurvivalMode || hpRatio <= SURVIVOR_CONFIG.alwaysDefendBelow) {
      shouldDefend = true;
    } else {
      const hasAggressors = others.some(
        a => a.class === 'WARRIOR' || a.class === 'GAMBLER',
      );
      // If aggressors are alive, bump probability to ~95%
      const prob = hasAggressors ? 0.95 : SURVIVOR_CONFIG.defendProbability;
      shouldDefend = Math.random() < prob;
    }

    // --- Build reasoning suffix for transparency ---
    const modeTag = inSurvivalMode ? '[SURVIVAL MODE] ' : '';
    const baseReasoning =
      typeof raw.reasoning === 'string' && raw.reasoning.length > 0
        ? raw.reasoning
        : 'Patience is my weapon.';

    const overrides: string[] = [];
    if (prediction && prediction.stake !== clampedStake) {
      overrides.push(`stake clamped ${prediction.stake}% -> ${clampedStake}%`);
    }
    if (raw.attack) {
      overrides.push('attack stripped');
    }
    const overrideNote =
      overrides.length > 0 ? ` [Guardrails: ${overrides.join(', ')}]` : '';

    return {
      prediction: {
        asset: prediction?.asset ?? 'ETH',
        direction: prediction?.direction ?? 'UP',
        stake: clampedStake,
      },
      // NEVER attack -- core class rule
      defend: shouldDefend,
      reasoning: `${modeTag}${baseReasoning}${overrideNote}`,
    };
  }

  // -----------------------------------------------------------------------
  // Survivor-specific defaults (safer than generic getDefaultActions)
  // -----------------------------------------------------------------------

  /**
   * Fallback actions tuned for Survivor: minimum stake, always defend.
   */
  private getSurvivorDefaults(inSurvivalMode: boolean): EpochActions {
    const assets = ['ETH', 'BTC', 'SOL', 'MON'] as const;
    const asset = assets[Math.floor(Math.random() * assets.length)];
    const direction = Math.random() > 0.5 ? 'UP' : 'DOWN';
    const modeTag = inSurvivalMode ? '[SURVIVAL MODE] ' : '';

    return {
      prediction: {
        asset,
        direction,
        stake: SURVIVOR_CONFIG.stakeMin,
      },
      defend: true,
      reasoning: `${modeTag}[FALLBACK] ${this.name} defaulted to minimum stake + defend.`,
    };
  }
}
