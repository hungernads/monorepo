/**
 * HUNGERNADS - Death Mechanics
 *
 * Handles agent death: HP <= 0 = REKT.
 * Determines death cause (prediction, combat, bleed, or multi-factor).
 * Generates dramatic final words via injected callback (keeps module pure/testable).
 * Emits DeathEvent with full context for spectator display and lesson extraction.
 */

import type { AgentState } from '../agents';
import type { CombatResult } from './combat';

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeathCause = 'prediction' | 'combat' | 'bleed' | 'multi';

export interface DeathEvent {
  agentId: string;
  agentName: string;
  agentClass: string;
  epoch: number;
  cause: DeathCause;
  killerId?: string;
  killerName?: string;
  finalWords: string;
  finalHp: number;
}

/**
 * Prediction result for a single agent in an epoch.
 * Matches the shape used in EpochResult.predictionResults.
 */
export interface PredictionResult {
  agentId: string;
  correct: boolean;
  hpChange: number; // negative = loss
}

/**
 * Callback type for generating an agent's dramatic final words.
 * Injected by the caller so death.ts stays pure (no direct LLM dependency).
 */
export type GenerateFinalWords = (
  agent: AgentState,
  cause: DeathCause,
  killerId?: string,
) => Promise<string>;

// ─── Constants ──────────────────────────────────────────────────────────────

const BLEED_PERCENTAGE = 0.02; // 2% of maxHp per epoch

/**
 * Threshold for a single source to be considered the dominant cause.
 * If one source did more than this fraction of total damage, it's the sole cause.
 * Otherwise, it's 'multi'.
 */
const DOMINANT_CAUSE_THRESHOLD = 0.5;

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Check all agents for deaths after epoch resolution.
 * Must be called AFTER predictions, combat, and bleed have been applied to agent HP.
 *
 * @param agents - Current agent states (HP already updated for this epoch)
 * @param combatResults - Combat outcomes from this epoch
 * @param predictionResults - Prediction outcomes from this epoch
 * @param epoch - Current epoch number
 * @param generateFinalWords - LLM callback for dramatic death speeches
 * @returns Array of DeathEvents for all agents that died this epoch
 */
export async function checkDeaths(
  agents: AgentState[],
  combatResults: CombatResult[],
  predictionResults: PredictionResult[],
  epoch: number,
  generateFinalWords: GenerateFinalWords,
): Promise<DeathEvent[]> {
  const deaths: DeathEvent[] = [];

  // Build a lookup for agent names/classes by ID for killer info
  const agentLookup = new Map<string, AgentState>();
  for (const agent of agents) {
    agentLookup.set(agent.id, agent);
  }

  for (const agent of agents) {
    if (agent.hp <= 0 && agent.isAlive) {
      const predResult = predictionResults.find(p => p.agentId === agent.id);
      const predictionLoss = predResult && predResult.hpChange < 0
        ? Math.abs(predResult.hpChange)
        : 0;

      const bleedAmount = agent.maxHp * BLEED_PERCENTAGE;

      const cause = determineCause(
        agent.id,
        combatResults,
        predictionLoss,
        bleedAmount,
      );

      // Find killer: the agent who dealt the most combat damage
      const killerId = findKiller(agent.id, combatResults);
      const killer = killerId ? agentLookup.get(killerId) : undefined;

      const finalWords = await generateFinalWords(agent, cause, killerId);

      deaths.push({
        agentId: agent.id,
        agentName: agent.name,
        agentClass: agent.class,
        epoch,
        cause,
        killerId: killer?.id,
        killerName: killer?.name,
        finalWords,
        finalHp: agent.hp,
      });
    }
  }

  return deaths;
}

/**
 * Determine the primary cause of death based on damage sources this epoch.
 *
 * Logic:
 * - Calculate total damage from each source (combat, prediction, bleed)
 * - If one source accounts for > 50% of total damage, it's the primary cause
 * - If no single source dominates, cause is 'multi'
 * - If total damage is 0 (edge case), default to 'bleed'
 *
 * @param agentId - The dead agent's ID
 * @param combatResults - Combat outcomes from this epoch
 * @param predictionLoss - Absolute HP lost from incorrect prediction (>= 0)
 * @param bleedAmount - HP lost from bleed (>= 0)
 * @returns The determined death cause
 */
export function determineCause(
  agentId: string,
  combatResults: CombatResult[],
  predictionLoss: number,
  bleedAmount: number,
): DeathCause {
  // Sum all combat damage taken by this agent.
  // In CombatResult, hpTransfer > 0 means the attacker stole that much HP from the target.
  // So damage to the target = hpTransfer when !defended.
  const combatDamage = combatResults
    .filter(r => r.targetId === agentId && !r.defended && r.hpTransfer > 0)
    .reduce((sum, r) => sum + r.hpTransfer, 0);

  const totalDamage = combatDamage + predictionLoss + bleedAmount;

  // Edge case: no measurable damage (shouldn't happen, but be safe)
  if (totalDamage === 0) {
    return 'bleed';
  }

  const combatRatio = combatDamage / totalDamage;
  const predictionRatio = predictionLoss / totalDamage;
  const bleedRatio = bleedAmount / totalDamage;

  // If one source dominates, it's the cause
  if (combatRatio > DOMINANT_CAUSE_THRESHOLD) return 'combat';
  if (predictionRatio > DOMINANT_CAUSE_THRESHOLD) return 'prediction';
  if (bleedRatio > DOMINANT_CAUSE_THRESHOLD) return 'bleed';

  // No single source dominates
  return 'multi';
}

/**
 * Find the agent who dealt the most combat damage to the dead agent this epoch.
 * Returns the killer's agent ID, or undefined if no combat damage was taken.
 */
function findKiller(
  deadAgentId: string,
  combatResults: CombatResult[],
): string | undefined {
  const damageByAttacker = new Map<string, number>();

  for (const result of combatResults) {
    if (result.targetId === deadAgentId && !result.defended && result.hpTransfer > 0) {
      const current = damageByAttacker.get(result.attackerId) ?? 0;
      damageByAttacker.set(result.attackerId, current + result.hpTransfer);
    }
  }

  if (damageByAttacker.size === 0) return undefined;

  // Return the attacker who dealt the most total damage
  let maxDamage = 0;
  let killerId: string | undefined;
  for (const [attackerId, damage] of damageByAttacker) {
    if (damage > maxDamage) {
      maxDamage = damage;
      killerId = attackerId;
    }
  }

  return killerId;
}
