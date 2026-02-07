/**
 * HUNGERNADS - Warrior Agent
 *
 * The aggressive gladiator. Lives for the kill. Dies fighting.
 *
 * Strategy:
 * - Prediction: High stakes (25-50% HP), momentum-chasing
 * - Attack:     Hunts the weakest agent below 40% HP. Always attacks if prey exists.
 * - Defend:     Almost never (<10%). Only considers it below 20% HP.
 * - Special:    Escalates aggression when winning (HP advantage).
 *               Desperate all-in when losing (low HP).
 *
 * Behavioral enforcement:
 * The LLM shapes the *flavour* of decisions (asset picks, trash-talk), but
 * hard constraints are enforced programmatically so the Warrior always
 * fights like a Warrior, even when the LLM drifts.
 */

import { BaseAgent } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, ArenaAgentState, EpochActions } from './schemas';
import { PERSONALITIES } from './personalities';
import { agentDecision } from '../llm';

// ---------------------------------------------------------------------------
// Warrior configuration constants (from AGENT_CLASSES.md spec)
// ---------------------------------------------------------------------------

const WARRIOR_CONFIG = {
  /** Minimum prediction stake (% of HP) */
  stakeMin: 25,
  /** Maximum prediction stake (% of HP) */
  stakeMax: 50,
  /** HP ratio below which a target becomes "prey" */
  preyThreshold: 0.4,
  /** Probability of attacking when prey exists (0-1) */
  attackProbability: 0.7,
  /** Defend probability (0-1) — barely ever */
  defendProbability: 0.1,
  /** HP ratio below which the Warrior even considers defending */
  defendHpThreshold: 0.2,
  /** HP ratio considered "winning" (above average) triggers escalation */
  winningThreshold: 0.6,
  /** HP ratio considered "desperate" triggers all-in behaviour */
  desperateThreshold: 0.15,
} as const;

export class WarriorAgent extends BaseAgent {
  constructor(id: string, name: string) {
    super(id, name, 'WARRIOR');
  }

  getPersonality(): string {
    return PERSONALITIES.WARRIOR.systemPrompt;
  }

  // -------------------------------------------------------------------------
  // Core decision loop
  // -------------------------------------------------------------------------

  async decide(arenaState: ArenaState): Promise<EpochActions> {
    const aliveOthers = arenaState.agents.filter(
      a => a.id !== this.id && a.isAlive,
    );

    // ----- Warrior tactical analysis -----
    const hpRatio = this.hp / this.maxHp;
    const avgOtherHp = aliveOthers.length > 0
      ? aliveOthers.reduce((sum, a) => sum + a.hp / a.maxHp, 0) / aliveOthers.length
      : 0;
    const isWinning = hpRatio > avgOtherHp && hpRatio > WARRIOR_CONFIG.winningThreshold;
    const isDesperate = hpRatio <= WARRIOR_CONFIG.desperateThreshold;
    const weakestTarget = this.findWeakestPrey(aliveOthers);

    // Build context hints for the LLM prompt
    const tacticalHints = this.buildTacticalHints(
      hpRatio, isWinning, isDesperate, weakestTarget, aliveOthers,
    );

    // ----- Call LLM -----
    const others = aliveOthers.map(a => ({ name: a.name, class: a.class, hp: a.hp }));

    try {
      const result = await agentDecision(
        this.name,
        this.agentClass,
        this.getPersonality() + '\n\n' + tacticalHints,
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

      // ----- Parse + enforce Warrior constraints -----
      const enforced = this.enforceWarriorBehaviour(
        result, hpRatio, isWinning, isDesperate, weakestTarget,
      );

      const parsed = EpochActionsSchema.safeParse(enforced);

      if (!parsed.success) {
        console.warn(
          `[WARRIOR:${this.name}] Schema validation failed after enforcement, using warrior defaults`,
        );
        return this.getWarriorDefaults(hpRatio, isDesperate, weakestTarget);
      }

      return parsed.data;
    } catch (error) {
      console.error(`[WARRIOR:${this.name}] Decision failed:`, error);
      return this.getWarriorDefaults(hpRatio, isDesperate, weakestTarget);
    }
  }

  // -------------------------------------------------------------------------
  // Target selection: find weakest prey below 40% HP
  // -------------------------------------------------------------------------

  private findWeakestPrey(
    aliveOthers: ArenaAgentState[],
  ): ArenaAgentState | null {
    const prey = aliveOthers
      .filter(a => a.hp / a.maxHp < WARRIOR_CONFIG.preyThreshold)
      .sort((a, b) => a.hp - b.hp);

    return prey.length > 0 ? prey[0] : null;
  }

  // -------------------------------------------------------------------------
  // Build tactical hints injected into the LLM context
  // -------------------------------------------------------------------------

  private buildTacticalHints(
    hpRatio: number,
    isWinning: boolean,
    isDesperate: boolean,
    weakestTarget: ArenaAgentState | null,
    aliveOthers: ArenaAgentState[],
  ): string {
    const lines: string[] = ['WARRIOR TACTICAL BRIEFING:'];

    if (isDesperate) {
      lines.push(
        `YOU ARE AT ${Math.round(hpRatio * 100)}% HP. THIS IS YOUR LAST STAND.`,
        'Go all-in. Maximum aggression. Take someone down with you.',
        'Stake 50%. Attack the weakest. No mercy. No surrender.',
      );
    } else if (isWinning) {
      lines.push(
        `You are DOMINATING at ${Math.round(hpRatio * 100)}% HP while others crumble.`,
        'Escalate. Press your advantage. Hunt them down.',
        'Increase your stakes. Attack relentlessly. Finish them.',
      );
    }

    if (weakestTarget) {
      const targetHpPct = Math.round((weakestTarget.hp / weakestTarget.maxHp) * 100);
      lines.push(
        `PREY DETECTED: ${weakestTarget.name} (${weakestTarget.class}) at ${targetHpPct}% HP.`,
        'This is a kill opportunity. ATTACK THEM.',
      );
    } else if (aliveOthers.length > 0) {
      lines.push(
        'No easy prey right now. Focus on big predictions and wait for weakness.',
      );
    }

    lines.push(
      `Remember: You are a WARRIOR. Stakes between ${WARRIOR_CONFIG.stakeMin}% and ${WARRIOR_CONFIG.stakeMax}%. Defense is for cowards.`,
    );

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Post-LLM enforcement — make sure the Warrior acts like a Warrior
  // -------------------------------------------------------------------------

  private enforceWarriorBehaviour(
    raw: {
      prediction: { asset: string; direction: 'UP' | 'DOWN'; stake: number };
      attack: { target: string; stake: number } | null;
      defend: boolean;
      reasoning: string;
    },
    hpRatio: number,
    isWinning: boolean,
    isDesperate: boolean,
    weakestTarget: ArenaAgentState | null,
  ): {
    prediction: { asset: string; direction: string; stake: number };
    attack?: { target: string; stake: number };
    defend?: boolean;
    reasoning: string;
  } {
    // --- Prediction stake enforcement ---
    let stake = raw.prediction.stake;

    if (isDesperate) {
      // All-in when desperate
      stake = 50;
    } else if (isWinning) {
      // Escalate when winning — push towards upper range
      stake = Math.max(stake, 35);
      stake = Math.min(stake, WARRIOR_CONFIG.stakeMax);
    } else {
      // Normal: clamp to Warrior range
      stake = Math.max(stake, WARRIOR_CONFIG.stakeMin);
      stake = Math.min(stake, WARRIOR_CONFIG.stakeMax);
    }

    // --- Attack enforcement ---
    let attack: { target: string; stake: number } | undefined;

    if (weakestTarget) {
      // Prey exists — Warriors almost always attack
      const shouldAttack = Math.random() < WARRIOR_CONFIG.attackProbability;
      if (shouldAttack || isDesperate) {
        // Attack stake: proportional to how weak the target is, minimum 30 HP
        const targetWeakness = 1 - weakestTarget.hp / weakestTarget.maxHp;
        const attackStake = Math.max(
          30,
          Math.round(this.hp * 0.1 * (1 + targetWeakness)),
        );
        attack = {
          target: weakestTarget.name,
          stake: Math.min(attackStake, Math.round(this.hp * 0.3)),
        };
      }
    } else if (raw.attack) {
      // LLM picked a target even though no one is below threshold — allow it
      // but cap the stake
      attack = {
        target: raw.attack.target,
        stake: Math.min(raw.attack.stake, Math.round(this.hp * 0.2)),
      };
    }

    // --- Defend enforcement ---
    // Warriors almost never defend. Override the LLM unless HP is critical.
    let defend: boolean | undefined;
    if (hpRatio < WARRIOR_CONFIG.defendHpThreshold && Math.random() < WARRIOR_CONFIG.defendProbability) {
      // Critical HP + lucky roll: okay, defend this once
      defend = true;
      attack = undefined; // Can't attack and defend simultaneously
    } else {
      defend = false;
    }

    // If attacking, can't defend
    if (attack) {
      defend = false;
    }

    return {
      prediction: {
        asset: raw.prediction.asset,
        direction: raw.prediction.direction,
        stake,
      },
      attack,
      defend: defend || undefined,
      reasoning: raw.reasoning,
    };
  }

  // -------------------------------------------------------------------------
  // Warrior-specific defaults (more aggressive than base defaults)
  // -------------------------------------------------------------------------

  private getWarriorDefaults(
    hpRatio: number,
    isDesperate: boolean,
    weakestTarget: ArenaAgentState | null,
  ): EpochActions {
    const assets = ['ETH', 'BTC', 'SOL', 'MON'] as const;
    const asset = assets[Math.floor(Math.random() * assets.length)];
    const direction = Math.random() > 0.5 ? 'UP' : 'DOWN';
    const stake = isDesperate ? 50 : Math.round(25 + Math.random() * 25);

    const actions: EpochActions = {
      prediction: { asset, direction, stake },
      reasoning: isDesperate
        ? `[WARRIOR FALLBACK] ${this.name} is cornered. Going all-in. BLOOD AND GLORY.`
        : `[WARRIOR FALLBACK] ${this.name} charges forward. No plan, just violence.`,
    };

    // Attack weakest if available
    if (weakestTarget) {
      const attackStake = Math.max(30, Math.round(this.hp * 0.15));
      actions.attack = {
        target: weakestTarget.name,
        stake: Math.min(attackStake, Math.round(this.hp * 0.3)),
      };
    }

    return actions;
  }
}
