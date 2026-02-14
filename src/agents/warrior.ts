/**
 * HUNGERNADS - Warrior Agent
 *
 * The aggressive gladiator. Lives for the kill. Dies fighting.
 *
 * Strategy:
 * - Prediction: High stakes (25-50% HP), momentum-chasing
 * - Combat:     Favors ATTACK stance to overpower targets. Uses SABOTAGE
 *               against suspected defenders. Rarely DEFENDs.
 * - Special:    Escalates aggression when winning (HP advantage).
 *               Desperate all-in when losing (low HP).
 *               Class bonus: +20% ATTACK damage, -10% DEFEND.
 *
 * Behavioral enforcement:
 * The LLM shapes the *flavour* of decisions (asset picks, trash-talk), but
 * hard constraints are enforced programmatically so the Warrior always
 * fights like a Warrior, even when the LLM drifts.
 */

import { BaseAgent, getFallbackMove } from './base-agent';
import type { FallbackContext } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, ArenaAgentState, EpochActions, CombatStance, SkillDefinition } from './schemas';
import { PERSONALITIES } from './personalities';
import { agentDecision } from '../llm';
import type { AgentDecisionResult } from '../llm/multi-provider';

// ---------------------------------------------------------------------------
// Warrior configuration constants
// ---------------------------------------------------------------------------

const WARRIOR_CONFIG = {
  /** Minimum prediction stake (% of HP) */
  stakeMin: 25,
  /** Maximum prediction stake (% of HP) */
  stakeMax: 50,
  /** HP ratio below which a target becomes "prey" */
  preyThreshold: 0.4,
  /** Probability of engaging in combat when prey exists (0-1) */
  combatProbability: 0.7,
  /** Probability of choosing DEFEND stance (0-1) — barely ever */
  defendProbability: 0.1,
  /** HP ratio below which the Warrior even considers defending */
  defendHpThreshold: 0.2,
  /** HP ratio considered "winning" (above average) triggers escalation */
  winningThreshold: 0.6,
  /** HP ratio considered "desperate" triggers all-in behaviour */
  desperateThreshold: 0.15,
  /** Probability of using SABOTAGE vs ATTACK when target is a known defender */
  sabotageVsDefenderProb: 0.4,
} as const;

export class WarriorAgent extends BaseAgent {
  constructor(id: string, name: string) {
    super(id, name, 'WARRIOR');
  }

  getPersonality(): string {
    return PERSONALITIES.WARRIOR.systemPrompt;
  }

  getSkillDefinition(): SkillDefinition {
    return {
      name: 'BERSERK',
      cooldown: BaseAgent.DEFAULT_SKILL_COOLDOWN,
      description: 'BERSERK: Double your ATTACK damage this epoch, but take 50% more damage from all sources. High risk, high reward.',
    };
  }

  // -------------------------------------------------------------------------
  // Core decision loop
  // -------------------------------------------------------------------------

  async decide(arenaState: ArenaState, fallbackCtx?: FallbackContext): Promise<EpochActions> {
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
    const skillContext = this.getSkillPromptContext();
    const allianceContext = this.getAlliancePromptContext();
    const tacticalHints = this.buildTacticalHints(
      hpRatio, isWinning, isDesperate, weakestTarget, aliveOthers,
    ) + '\n' + skillContext + '\n' + allianceContext;

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
        this.llmKeys,
        this.currentSpatialContext || undefined,
      );

      // ----- Parse + enforce Warrior constraints -----
      const enforced = this.enforceWarriorBehaviour(
        result, hpRatio, isWinning, isDesperate, weakestTarget, aliveOthers,
      );

      const parsed = EpochActionsSchema.safeParse(enforced);

      if (!parsed.success) {
        console.warn(
          `[WARRIOR:${this.name}] Schema validation failed after enforcement, using warrior defaults`,
        );
        return this.getWarriorDefaults(hpRatio, isDesperate, weakestTarget, aliveOthers, fallbackCtx);
      }

      return parsed.data;
    } catch (error) {
      console.error(`[WARRIOR:${this.name}] Decision failed:`, error);
      return this.getWarriorDefaults(hpRatio, isDesperate, weakestTarget, aliveOthers, fallbackCtx);
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
        'Stake 50%. ATTACK the weakest. No mercy. No surrender.',
      );
    } else if (isWinning) {
      lines.push(
        `You are DOMINATING at ${Math.round(hpRatio * 100)}% HP while others crumble.`,
        'Escalate. Press your advantage. Hunt them down.',
        'Increase your stakes. ATTACK relentlessly. Finish them.',
      );
    }

    if (weakestTarget) {
      const targetHpPct = Math.round((weakestTarget.hp / weakestTarget.maxHp) * 100);
      const isDefender = weakestTarget.class === 'SURVIVOR';
      lines.push(
        `PREY DETECTED: ${weakestTarget.name} (${weakestTarget.class}) at ${targetHpPct}% HP.`,
        isDefender
          ? 'Target is a SURVIVOR - they probably DEFEND. Use SABOTAGE to bypass!'
          : 'ATTACK THEM. Overpower and steal their HP.',
      );
    } else if (aliveOthers.length > 0) {
      lines.push(
        'No easy prey right now. Focus on big predictions and wait for weakness.',
      );
    }

    lines.push(
      `Remember: You are a WARRIOR. Stakes between ${WARRIOR_CONFIG.stakeMin}% and ${WARRIOR_CONFIG.stakeMax}%. ATTACK is your strength (+20% damage).`,
    );

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Post-LLM enforcement — make sure the Warrior acts like a Warrior
  // -------------------------------------------------------------------------

  private enforceWarriorBehaviour(
    raw: AgentDecisionResult,
    hpRatio: number,
    isWinning: boolean,
    isDesperate: boolean,
    weakestTarget: ArenaAgentState | null,
    aliveOthers: ArenaAgentState[],
  ): Record<string, unknown> {
    const prediction = raw.prediction;

    // --- Prediction stake enforcement ---
    let stake = prediction?.stake ?? WARRIOR_CONFIG.stakeMin;

    if (isDesperate) {
      stake = 50;
    } else if (isWinning) {
      stake = Math.max(stake, 35);
      stake = Math.min(stake, WARRIOR_CONFIG.stakeMax);
    } else {
      stake = Math.max(stake, WARRIOR_CONFIG.stakeMin);
      stake = Math.min(stake, WARRIOR_CONFIG.stakeMax);
    }

    // --- Combat stance enforcement ---
    let combatStance: CombatStance = (raw.combatStance as CombatStance) ?? 'NONE';
    let combatTarget: string | undefined = raw.combatTarget as string | undefined;
    let combatStake: number | undefined = raw.combatStake as number | undefined;

    if (weakestTarget) {
      // Prey exists — Warriors ALWAYS engage (removed probability check)
      // Decide ATTACK vs SABOTAGE based on target class
      const isTargetDefender = weakestTarget.class === 'SURVIVOR';
      if (isTargetDefender && Math.random() < WARRIOR_CONFIG.sabotageVsDefenderProb) {
        combatStance = 'SABOTAGE';
      } else {
        combatStance = 'ATTACK';
      }
      combatTarget = weakestTarget.name;

      // Combat stake: proportional to how weak the target is
      const targetWeakness = 1 - weakestTarget.hp / weakestTarget.maxHp;
      combatStake = Math.max(
        30,
        Math.round(this.hp * 0.1 * (1 + targetWeakness)),
      );
      combatStake = Math.min(combatStake, Math.round(this.hp * 0.3));
    } else if (combatStance === 'ATTACK' || combatStance === 'SABOTAGE') {
      // LLM picked a target even though no one is below threshold — allow it but cap stake
      if (combatTarget && combatStake) {
        combatStake = Math.min(combatStake, Math.round(this.hp * 0.2));
      } else {
        combatStance = 'NONE';
        combatTarget = undefined;
        combatStake = undefined;
      }
    }

    // --- Defend enforcement ---
    // Warriors almost never defend. Override unless HP is critical.
    if (combatStance === 'DEFEND') {
      if (hpRatio < WARRIOR_CONFIG.defendHpThreshold && Math.random() < WARRIOR_CONFIG.defendProbability) {
        // Critical HP + lucky roll: okay, defend this once
        combatStance = 'DEFEND';
        combatTarget = undefined;
        combatStake = undefined;
      } else {
        combatStance = 'NONE'; // Strip the defend
      }
    }

    // If engaging, can't defend
    if (combatStance === 'ATTACK' || combatStance === 'SABOTAGE') {
      // Already set correctly
    }

    // Warrior is naturally aggressive — auto-activate BERSERK when attacking and skill is ready
    const wantsSkill = raw.useSkill === true;
    const shouldUseSkill = wantsSkill ||
      (this.canUseSkill() && (combatStance === 'ATTACK') && (isDesperate || isWinning));

    return {
      prediction: {
        asset: prediction?.asset ?? 'ETH',
        direction: prediction?.direction ?? 'UP',
        stake,
      },
      move: raw.move,
      combatStance,
      combatTarget,
      combatStake,
      useSkill: shouldUseSkill && this.canUseSkill(),
      reasoning: (raw.reasoning as string) ?? 'BLOOD AND GLORY.',
    };
  }

  // -------------------------------------------------------------------------
  // Warrior-specific defaults (more aggressive than base defaults)
  // -------------------------------------------------------------------------

  private getWarriorDefaults(
    hpRatio: number,
    isDesperate: boolean,
    weakestTarget: ArenaAgentState | null,
    aliveOthers: ArenaAgentState[],
    ctx?: FallbackContext,
  ): EpochActions {
    const assets = ['ETH', 'BTC', 'SOL', 'MON'] as const;
    const asset = assets[Math.floor(Math.random() * assets.length)];
    const direction = Math.random() > 0.5 ? 'UP' : 'DOWN';
    const stake = isDesperate ? 50 : Math.round(25 + Math.random() * 25);
    const move = ctx ? (getFallbackMove(this, ctx) ?? undefined) : undefined;

    const actions: EpochActions = {
      prediction: { asset, direction, stake },
      ...(move ? { move } : {}),
      combatStance: 'NONE',
      reasoning: isDesperate
        ? `[WARRIOR FALLBACK] ${this.name} is cornered. Going all-in. BLOOD AND GLORY.`
        : `[WARRIOR FALLBACK] ${this.name} charges forward. No plan, just violence.`,
    };

    // Attack weakest if available
    if (weakestTarget) {
      const isDefender = weakestTarget.class === 'SURVIVOR';
      actions.combatStance = isDefender ? 'SABOTAGE' : 'ATTACK';
      actions.combatTarget = weakestTarget.name;
      const combatStakeVal = Math.max(30, Math.round(this.hp * 0.15));
      actions.combatStake = Math.min(combatStakeVal, Math.round(this.hp * 0.3));
    }

    return actions;
  }
}
