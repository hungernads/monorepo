/**
 * HUNGERNADS - Gambler Agent
 *
 * Pure chaos agent. Unpredictable decisions driven by randomness.
 * Sometimes brilliant, sometimes suicidal. The wildcard that disrupts the meta.
 *
 * Combat triangle: Picks ANY stance randomly each epoch.
 * Class bonus: random 0-15% on any stance (chaos rewards the bold).
 *
 * Unlike other agents that rely primarily on LLM personality for strategy,
 * the Gambler injects programmatic randomness to guarantee unpredictability.
 * LLMs are pattern-matchers — they struggle to be truly random.
 * So we mix LLM flavor text with hard random mechanics.
 */

import { BaseAgent, getDefaultActions, FallbackContext } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, Asset, Direction, EpochActions, CombatStance, SkillDefinition } from './schemas';
import type { HexCoord } from '../arena/types/hex';
import { getNeighbors, isStormTile, hexKey } from '../arena/hex-grid';
import { PERSONALITIES } from './personalities';
import { agentDecision } from '../llm';

// ---------------------------------------------------------------------------
// Gambler-specific constants
// ---------------------------------------------------------------------------

const GAMBLER_CONFIG = {
  /** Prediction stake range */
  stakeMin: 5,
  stakeMax: 50, // Capped by PredictionSchema
  /** Probability of each combat stance - tuned for ~50% attack rate */
  attackProbability: 0.35,
  sabotageProbability: 0.15,
  defendProbability: 0.15,
  // Remaining ~35% = NONE
  /** Max proportion of HP to risk on combat */
  combatStakeMaxPct: 0.4,
  /** LLM temperature — cranked up for maximum chaos */
  llmTemperature: 1.0,
} as const;

const ASSETS: readonly Asset[] = ['ETH', 'BTC', 'SOL', 'MON'] as const;
const DIRECTIONS: readonly Direction[] = ['UP', 'DOWN'] as const;
const STANCES: readonly CombatStance[] = ['ATTACK', 'SABOTAGE', 'DEFEND', 'NONE'] as const;

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

  getSkillDefinition(): SkillDefinition {
    return {
      name: 'ALL_IN',
      cooldown: BaseAgent.DEFAULT_SKILL_COOLDOWN,
      description: 'ALL IN: Double or nothing! Your prediction stake is DOUBLED. If correct, you gain double HP. If wrong, you lose double HP. Pure chaos.',
    };
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
  async decide(arenaState: ArenaState, fallbackCtx?: FallbackContext): Promise<EpochActions> {
    const others = arenaState.agents
      .filter(a => a.id !== this.id && a.isAlive)
      .map(a => ({ name: a.name, class: a.class, hp: a.hp }));

    // Build chaotic actions programmatically
    const chaosActions = this._buildChaosActions(others, fallbackCtx);

    // Try LLM for the reasoning/flavor only
    const skillContext = this.getSkillPromptContext();
    const allianceContext = this.getAlliancePromptContext();

    try {
      const result = await agentDecision(
        this.name,
        this.agentClass,
        this.getPersonality() + '\n' + skillContext + '\n' + allianceContext,
        this.hp,
        {
          eth: arenaState.marketData.prices.ETH ?? 0,
          btc: arenaState.marketData.prices.BTC ?? 0,
          sol: arenaState.marketData.prices.SOL ?? 0,
          mon: arenaState.marketData.prices.MON ?? 0,
        },
        others,
        this.lessons.slice(-3).map(l => l.learning),
        this.llmKeys,
        this.currentSpatialContext || undefined,
      );

      // Use the LLM's reasoning but override the mechanical decisions with chaos
      const reasoning = result.reasoning || chaosActions.reasoning;

      const merged: EpochActions = {
        prediction: chaosActions.prediction,
        combatStance: chaosActions.combatStance,
        combatTarget: chaosActions.combatTarget,
        combatStake: chaosActions.combatStake,
        move: chaosActions.move ?? result?.move,
        reasoning: `[CHAOS] ${reasoning}`,
      };

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
    ctx?: FallbackContext,
  ): EpochActions {
    // Random prediction
    const asset = pick(ASSETS);
    const direction = pick(DIRECTIONS);
    const stake = randInt(GAMBLER_CONFIG.stakeMin, GAMBLER_CONFIG.stakeMax);

    // Gambler randomly activates ALL IN — 50% chance when available
    const shouldUseSkill = this.canUseSkill() && chance(0.5);

    // Random adjacent move (chaos style)
    let chaosMove: HexCoord | undefined;
    if (ctx && this.position) {
      const neighbors = getNeighbors(this.position, ctx.grid);
      const safe = neighbors.filter(n => !isStormTile(n, ctx.phase));
      const valid = safe.filter(n => {
        const tile = ctx.grid.tiles.get(hexKey(n));
        return !tile?.occupantId;
      });
      if (valid.length > 0) {
        chaosMove = valid[Math.floor(Math.random() * valid.length)];
      }
    }

    const actions: EpochActions = {
      prediction: { asset, direction, stake },
      combatStance: 'NONE',
      move: chaosMove,
      useSkill: shouldUseSkill,
      reasoning: this._chaosReasoning(asset, direction, stake),
    };

    // Random combat stance
    const roll = Math.random();
    if (others.length > 0 && roll < GAMBLER_CONFIG.attackProbability) {
      // ATTACK a random target
      const target = pick(others);
      const maxCombatStake = Math.max(1, Math.floor(this.hp * GAMBLER_CONFIG.combatStakeMaxPct));
      actions.combatStance = 'ATTACK';
      actions.combatTarget = target.name;
      actions.combatStake = randInt(1, maxCombatStake);
    } else if (others.length > 0 && roll < GAMBLER_CONFIG.attackProbability + GAMBLER_CONFIG.sabotageProbability) {
      // SABOTAGE a random target
      const target = pick(others);
      const maxCombatStake = Math.max(1, Math.floor(this.hp * GAMBLER_CONFIG.combatStakeMaxPct));
      actions.combatStance = 'SABOTAGE';
      actions.combatTarget = target.name;
      actions.combatStake = randInt(1, maxCombatStake);
    } else if (roll < GAMBLER_CONFIG.attackProbability + GAMBLER_CONFIG.sabotageProbability + GAMBLER_CONFIG.defendProbability) {
      // DEFEND for no reason
      actions.combatStance = 'DEFEND';
    }
    // else: NONE (already set)

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
