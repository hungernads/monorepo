/**
 * HUNGERNADS - Gambler Agent
 *
 * Pure chaos agent. Unpredictable decisions driven by randomness.
 * Sometimes brilliant, sometimes suicidal. The wildcard that disrupts the meta.
 *
 * Unlike other agents that rely primarily on LLM personality for strategy,
 * the Gambler injects programmatic randomness to guarantee unpredictability.
 * LLMs are pattern-matchers -- they struggle to be truly random.
 * So we mix LLM flavor text with hard random mechanics.
 */

import { BaseAgent, getDefaultActions } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, Asset, Direction, EpochActions } from './schemas';
import { PERSONALITIES } from './personalities';
import { agentDecision } from '../llm';

// ---------------------------------------------------------------------------
// Gambler-specific constants from AGENT_CLASSES.md spec
// ---------------------------------------------------------------------------

const GAMBLER_CONFIG = {
  /** Prediction stake range -- wider than the standard 5-50 cap */
  stakeMin: 5,
  stakeMax: 50, // Capped by PredictionSchema; spec says 80 but schema enforces 50
  /** Probability of attacking a random target each epoch */
  attackProbability: 0.4,
  /** Probability of defending each epoch */
  defendProbability: 0.3,
  /** Max proportion of HP to risk on an attack */
  attackStakeMaxPct: 0.4,
  /** LLM temperature -- cranked up for maximum chaos */
  llmTemperature: 1.0,
} as const;

const ASSETS: readonly Asset[] = ['ETH', 'BTC', 'SOL', 'MON'] as const;
const DIRECTIONS: readonly Direction[] = ['UP', 'DOWN'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Random integer in [min, max] inclusive */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random element from array */
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Coin flip with given probability of `true` */
function chance(probability: number): boolean {
  return Math.random() < probability;
}

// ---------------------------------------------------------------------------
// GamblerAgent
// ---------------------------------------------------------------------------

export class GamblerAgent extends BaseAgent {
  constructor(id: string, name: string) {
    super(id, name, 'GAMBLER');
  }

  getPersonality(): string {
    return PERSONALITIES.GAMBLER.systemPrompt;
  }

  /**
   * The Gambler's decide() is a hybrid approach:
   * 1. Try the LLM for flavor text and reasoning (high temperature).
   * 2. Override the mechanical parts (asset, direction, stake, combat) with
   *    programmatic randomness to guarantee true unpredictability.
   *
   * This means the LLM provides the entertaining reasoning/personality
   * while the actual numbers are chaos-driven.
   */
  async decide(arenaState: ArenaState): Promise<EpochActions> {
    const others = arenaState.agents
      .filter(a => a.id !== this.id && a.isAlive)
      .map(a => ({ name: a.name, class: a.class, hp: a.hp }));

    // Build chaotic actions programmatically
    const chaosActions = this._buildChaosActions(others);

    // Try LLM for the reasoning/flavor only
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

      // Use the LLM's reasoning but override the mechanical decisions with chaos
      const reasoning = result.reasoning || chaosActions.reasoning;

      const merged: EpochActions = {
        prediction: chaosActions.prediction,
        reasoning: `[CHAOS] ${reasoning}`,
      };

      // Inject attack from chaos logic (ignore LLM's attack decision)
      if (chaosActions.attack) {
        merged.attack = chaosActions.attack;
      }

      // Inject defend from chaos logic
      if (chaosActions.defend) {
        merged.defend = chaosActions.defend;
      }

      // Validate the merged result
      const parsed = EpochActionsSchema.safeParse(merged);
      if (!parsed.success) {
        console.warn(
          `[GAMBLER:${this.name}] Merged actions failed validation, using raw chaos`,
        );
        return chaosActions;
      }

      return parsed.data;
    } catch (error) {
      console.error(`[GAMBLER:${this.name}] LLM failed, pure chaos mode:`, error);
      // Gambler's fallback IS chaos, not the safe conservative default
      return chaosActions;
    }
  }

  // -------------------------------------------------------------------------
  // Private: chaos generation
  // -------------------------------------------------------------------------

  /**
   * Build fully random actions. This is the core of the Gambler's identity.
   * Every parameter is independently randomized.
   */
  private _buildChaosActions(
    others: { name: string; class: string; hp: number }[],
  ): EpochActions {
    // Random prediction
    const asset = pick(ASSETS);
    const direction = pick(DIRECTIONS);
    const stake = randInt(GAMBLER_CONFIG.stakeMin, GAMBLER_CONFIG.stakeMax);

    const actions: EpochActions = {
      prediction: { asset, direction, stake },
      reasoning: this._chaosReasoning(asset, direction, stake),
    };

    // 40% chance to attack a random target
    if (others.length > 0 && chance(GAMBLER_CONFIG.attackProbability)) {
      const target = pick(others);
      const maxAttackStake = Math.max(
        1,
        Math.floor(this.hp * GAMBLER_CONFIG.attackStakeMaxPct),
      );
      const attackStake = randInt(1, maxAttackStake);
      actions.attack = { target: target.name, stake: attackStake };
      // Cannot attack and defend in the same epoch
    } else if (chance(GAMBLER_CONFIG.defendProbability)) {
      // 30% chance to defend (only if not attacking)
      actions.defend = true;
    }

    return actions;
  }

  /**
   * Generate a chaotic reasoning string when LLM is unavailable.
   * These are entertaining fallbacks that match the Gambler's personality.
   */
  private _chaosReasoning(asset: string, direction: string, stake: number): string {
    const lines = [
      `The dice say ${asset} ${direction}. Who am I to argue? ${stake}% stake. YOLO.`,
      `I flipped a coin for ${asset}. It landed on ${direction}. Fate has spoken.`,
      `${stake}% on ${asset} ${direction}. Why? The voices told me.`,
      `CHAOS DEMANDS ${asset} ${direction} at ${stake}%. The universe provides.`,
      `Random number generator says ${asset} ${direction}. Better than any TA.`,
      `${asset} going ${direction}? Maybe. Probably. Who cares. ${stake}% in.`,
      `The stars aligned for ${asset} ${direction}. Or maybe they didn't. ${stake}% anyway.`,
      `Pattern detected: there is no pattern. ${asset} ${direction}, ${stake}%.`,
      `TRADER's analysis is astrology for nerds. I roll dice. ${asset} ${direction}. ${stake}%.`,
      `Fortune favors the insane. ${stake}% on ${asset} ${direction}. LET'S GO.`,
    ];

    return pick(lines);
  }
}
