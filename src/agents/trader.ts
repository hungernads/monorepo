/**
 * HUNGERNADS - Trader Agent
 *
 * Cold, analytical agent focused purely on market prediction accuracy.
 * 15-25% stakes, requires indicator confirmations (momentum, volume pattern).
 * Never attacks. Defends ~30% of the time as insurance.
 *
 * Special: Reduces position size in volatile markets, goes all-in on
 * high-conviction signals.
 */

import { BaseAgent, getDefaultActions } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, EpochActions } from './schemas';
import { PERSONALITIES } from './personalities';
import { agentDecision } from '../llm';

// ---------------------------------------------------------------------------
// Trader config constants (mirrors AGENT_CLASSES.md spec)
// ---------------------------------------------------------------------------

const TRADER_STAKE_MIN = 15;
const TRADER_STAKE_MAX = 25;
const TRADER_DEFEND_HP_THRESHOLD = 0.4; // Defend more aggressively below 40% HP
const TRADER_BASE_DEFEND_CHANCE = 0.3; // 30% defend probability at normal HP
const TRADER_LOW_HP_DEFEND_CHANCE = 0.6; // 60% defend when HP is low

// ---------------------------------------------------------------------------
// TraderAgent
// ---------------------------------------------------------------------------

export class TraderAgent extends BaseAgent {
  constructor(id: string, name: string) {
    super(id, name, 'TRADER');
  }

  getPersonality(): string {
    return PERSONALITIES.TRADER.systemPrompt;
  }

  async decide(arenaState: ArenaState): Promise<EpochActions> {
    const others = arenaState.agents
      .filter(a => a.id !== this.id && a.isAlive)
      .map(a => ({ name: a.name, class: a.class, hp: a.hp }));

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

      // -------------------------------------------------------------------
      // Trader guardrails: enforce class-specific constraints
      // -------------------------------------------------------------------

      // 1. Trader NEVER attacks. Strip any attack the LLM hallucinated.
      const attack = undefined;

      // 2. Clamp prediction stake to Trader range (15-25%).
      //    In volatile markets (high price changes), reduce towards minimum.
      //    On high-conviction signals, allow up to max.
      const rawStake = result.prediction?.stake ?? TRADER_STAKE_MIN;
      const clampedStake = Math.max(
        TRADER_STAKE_MIN,
        Math.min(TRADER_STAKE_MAX, rawStake),
      );

      // 3. Defend logic: Trader defends ~30% of the time as insurance.
      //    If HP is below 40%, defend more aggressively (~60%).
      //    Always respect if the LLM explicitly chose to defend.
      let defend = result.defend ?? false;
      if (!defend) {
        const hpRatio = this.hp / this.maxHp;
        if (hpRatio < TRADER_DEFEND_HP_THRESHOLD) {
          defend = Math.random() < TRADER_LOW_HP_DEFEND_CHANCE;
        } else {
          defend = Math.random() < TRADER_BASE_DEFEND_CHANCE;
        }
      }

      const parsed = EpochActionsSchema.safeParse({
        prediction: {
          asset: result.prediction?.asset,
          direction: result.prediction?.direction,
          stake: clampedStake,
        },
        attack,
        defend,
        reasoning: result.reasoning,
      });

      if (!parsed.success) {
        console.warn(`[TRADER:${this.name}] Invalid LLM response, using defaults`);
        return this._traderDefaults();
      }

      return parsed.data;
    } catch (error) {
      console.error(`[TRADER:${this.name}] Decision failed:`, error);
      return this._traderDefaults();
    }
  }

  // -------------------------------------------------------------------------
  // Trader-specific fallback
  // -------------------------------------------------------------------------

  /**
   * Trader defaults are more conservative than the generic getDefaultActions.
   * Minimum stake, no attack, defend based on HP level.
   */
  private _traderDefaults(): EpochActions {
    const base = getDefaultActions(this);

    // Override stake to Trader minimum
    base.prediction.stake = TRADER_STAKE_MIN;

    // Never attack
    delete (base as Record<string, unknown>).attack;

    // Defend if below threshold, otherwise 30% chance
    const hpRatio = this.hp / this.maxHp;
    base.defend =
      hpRatio < TRADER_DEFEND_HP_THRESHOLD ||
      Math.random() < TRADER_BASE_DEFEND_CHANCE;

    base.reasoning = `[FALLBACK] ${this.name} defaulted to conservative prediction. The numbers don't lie - but the data was unclear.`;

    return base;
  }
}
