/**
 * HUNGERNADS - Combat Resolution
 *
 * Pure functions for resolving attack/defend actions and bleed between agents.
 * No side effects - the caller is responsible for applying HP changes to agents.
 *
 * Combat rules:
 * - Attack vs undefended target: attacker STEALS stake HP from target
 * - Attack vs defended target: attacker LOSES stake HP to defender
 * - Defend cost: 5% of current HP (paid regardless of whether attacked)
 * - Multiple attackers vs same target: each resolved independently
 * - Attack on dead agent: no effect (skip)
 * - Bleed: every alive agent loses 2% HP per epoch (applied after combat)
 */

import type { EpochActions } from '../agents/schemas';

// ─── Types ───────────────────────────────────────────────────────────

export interface CombatResult {
  attackerId: string;
  targetId: string;
  attackStake: number;
  defended: boolean;
  /** Positive = attacker gains HP, negative = attacker loses HP */
  hpTransfer: number;
}

export interface BleedResult {
  agentId: string;
  bleedAmount: number;
  hpBefore: number;
  hpAfter: number;
}

export interface DefendCostResult {
  agentId: string;
  cost: number;
  hpBefore: number;
  hpAfter: number;
}

/** Minimal agent state needed for combat resolution. */
export interface CombatAgentState {
  hp: number;
  isAlive: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFEND_COST_PERCENT = 0.05; // 5% of current HP
const BLEED_PERCENT = 0.02; // 2% HP per epoch

// ─── Combat Resolution ──────────────────────────────────────────────

/**
 * Resolve all combat actions for an epoch.
 *
 * This is a pure function: it reads agent state and actions, and returns
 * a list of CombatResults describing what happened. The caller must apply
 * the HP changes to the actual agent objects.
 *
 * Resolution order:
 * 1. Identify all defenders (agents with defend === true)
 * 2. Apply defend costs (5% HP)
 * 3. Resolve each attack independently:
 *    - Skip if attacker is dead
 *    - Skip if target is dead
 *    - If target is defending: attacker loses stake, defender gains stake
 *    - If target is not defending: attacker steals stake from target
 */
export function resolveCombat(
  actions: Map<string, EpochActions>,
  agents: Map<string, CombatAgentState>,
): { combatResults: CombatResult[]; defendCosts: DefendCostResult[] } {
  const combatResults: CombatResult[] = [];
  const defendCosts: DefendCostResult[] = [];

  // Build a set of defending agents
  const defenders = new Set<string>();
  for (const [agentId, action] of actions) {
    const agent = agents.get(agentId);
    if (!agent || !agent.isAlive) continue;

    if (action.defend) {
      defenders.add(agentId);

      // Defend costs 5% of current HP, paid regardless of attacks
      const cost = Math.floor(agent.hp * DEFEND_COST_PERCENT);
      const hpBefore = agent.hp;
      defendCosts.push({
        agentId,
        cost,
        hpBefore,
        hpAfter: hpBefore - cost,
      });
    }
  }

  // Resolve each attack independently
  for (const [attackerId, action] of actions) {
    if (!action.attack) continue;

    const attacker = agents.get(attackerId);
    if (!attacker || !attacker.isAlive) continue;

    const { target: targetId, stake: attackStake } = action.attack;

    const target = agents.get(targetId);
    if (!target || !target.isAlive) continue;

    // Clamp stake to attacker's current HP (can't stake more than you have)
    const effectiveStake = Math.min(attackStake, attacker.hp);
    if (effectiveStake <= 0) continue;

    const defended = defenders.has(targetId);

    if (defended) {
      // Attack vs defended target: attacker LOSES stake HP to defender
      combatResults.push({
        attackerId,
        targetId,
        attackStake: effectiveStake,
        defended: true,
        hpTransfer: -effectiveStake, // negative = attacker loses
      });
    } else {
      // Attack vs undefended target: attacker STEALS stake HP from target
      // Clamp to target's actual HP (can't steal more than they have)
      const effectiveTransfer = Math.min(effectiveStake, target.hp);
      combatResults.push({
        attackerId,
        targetId,
        attackStake: effectiveStake,
        defended: false,
        hpTransfer: effectiveTransfer, // positive = attacker gains
      });
    }
  }

  return { combatResults, defendCosts };
}

// ─── Bleed ───────────────────────────────────────────────────────────

/**
 * Apply bleed to all alive agents. Each alive agent loses 2% HP per epoch.
 *
 * Pure function: returns BleedResults for the caller to apply.
 * Bleed minimum is 1 HP (so agents always lose at least 1 HP per epoch).
 */
export function applyBleed(
  agents: Map<string, CombatAgentState>,
): BleedResult[] {
  const results: BleedResult[] = [];

  for (const [agentId, agent] of agents) {
    if (!agent.isAlive) continue;
    if (agent.hp <= 0) continue;

    const bleedAmount = Math.max(1, Math.floor(agent.hp * BLEED_PERCENT));
    const hpBefore = agent.hp;
    const hpAfter = Math.max(0, hpBefore - bleedAmount);

    results.push({
      agentId,
      bleedAmount,
      hpBefore,
      hpAfter,
    });
  }

  return results;
}
