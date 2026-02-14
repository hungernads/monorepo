/**
 * HUNGERNADS - Parasite Agent
 *
 * Copy-trading agent that mirrors the most profitable agent's predictions.
 * Low-risk predictions at 50% of host's size, scavenges dying agents,
 * defends when targeted. Struggles late-game when hosts die.
 *
 * Combat triangle awareness:
 * - Prefers SABOTAGE for scavenging (+10% class bonus, bypasses defenders)
 * - Uses DEFEND when targeted by attackers
 * - Never ATTACKs (too risky for the Parasite's survival-first style)
 */

import { BaseAgent, getDefaultActions, type FallbackContext } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, ArenaAgentState, EpochActions, CombatStance, SkillDefinition } from './schemas';
import { PERSONALITIES } from './personalities';
import { agentDecision } from '../llm';

// ---------------------------------------------------------------------------
// Host analysis - Parasite-specific context for the LLM
// ---------------------------------------------------------------------------

interface HostCandidate {
  name: string;
  class: ArenaAgentState['class'];
  hp: number;
  /** Higher HP relative to peers = likely making better predictions */
  hpRatio: number;
}

/**
 * Identify the best host to copy from among living agents.
 * Ranked by HP (proxy for prediction profitability since HP reflects
 * accumulated prediction accuracy minus bleed and combat losses).
 *
 * Rules from the spec:
 * - Never copy GAMBLER (chaos is not strategy)
 * - Prefer agents with higher HP (proxy for profitability)
 * - Return null if no viable host (late-game panic mode)
 */
function findHost(
  selfId: string,
  agents: ArenaAgentState[],
): HostCandidate | null {
  const alive = agents.filter(
    a => a.id !== selfId && a.isAlive && a.class !== 'GAMBLER',
  );

  if (alive.length === 0) return null;

  const maxHp = Math.max(...alive.map(a => a.maxHp));

  const ranked = alive
    .map(a => ({
      name: a.name,
      class: a.class,
      hp: a.hp,
      hpRatio: maxHp > 0 ? a.hp / maxHp : 0,
    }))
    .sort((a, b) => b.hp - a.hp);

  return ranked[0] ?? null;
}

/**
 * Find agents below 15% HP that are ripe for scavenging.
 */
function findScavengeTargets(
  selfId: string,
  agents: ArenaAgentState[],
): ArenaAgentState[] {
  return agents.filter(
    a => a.id !== selfId && a.isAlive && a.hp / a.maxHp < 0.15,
  );
}

/**
 * Find weak agents (<30% HP) that Parasite can attack opportunistically.
 */
function findWeakTargets(
  selfId: string,
  agents: ArenaAgentState[],
): ArenaAgentState[] {
  return agents.filter(
    a => a.id !== selfId && a.isAlive && a.hp / a.maxHp < 0.30,
  );
}

// ---------------------------------------------------------------------------
// ParasiteAgent
// ---------------------------------------------------------------------------

export class ParasiteAgent extends BaseAgent {
  constructor(id: string, name: string) {
    super(id, name, 'PARASITE');
  }

  getPersonality(): string {
    return PERSONALITIES.PARASITE.systemPrompt;
  }

  getSkillDefinition(): SkillDefinition {
    return {
      name: 'SIPHON',
      cooldown: BaseAgent.DEFAULT_SKILL_COOLDOWN,
      description: 'SIPHON: Steal 10% of a target agent\'s current HP and add it to your own. Requires "skillTarget" with target agent name.',
    };
  }

  async decide(arenaState: ArenaState, fallbackCtx?: FallbackContext): Promise<EpochActions> {
    const others = arenaState.agents
      .filter(a => a.id !== this.id && a.isAlive)
      .map(a => ({ name: a.name, class: a.class, hp: a.hp }));

    // Parasite-specific context: identify host and scavenge targets
    const host = findHost(this.id, arenaState.agents);
    const scavengeTargets = findScavengeTargets(this.id, arenaState.agents);
    const weakTargets = findWeakTargets(this.id, arenaState.agents);

    const hostContext = host
      ? `\nYOUR HOST (copy this agent): ${host.name} (${host.class}) at ${host.hp} HP (${Math.round(host.hpRatio * 100)}% relative strength). Mirror their likely prediction at 50% stake size.`
      : '\nNO VIABLE HOST FOUND. All hosts are dead or only GAMBLER remains. You must make ORIGINAL decisions now. Express uncertainty - your edge is gone.';

    const scavengeContext =
      scavengeTargets.length > 0
        ? `\nSCAVENGE TARGETS (below 15% HP): ${scavengeTargets.map(t => `${t.name} (${t.hp} HP)`).join(', ')}. Use SABOTAGE - your +10% class bonus makes it the best scavenging tool. Bypasses any desperate DEFEND.`
        : '\nNo scavenge targets available (no agents below 15% HP).';

    const weakTargetsContext =
      weakTargets.length > 0
        ? `\nWEAK TARGETS (below 30% HP): ${weakTargets.map(t => `${t.name} (${t.hp} HP)`).join(', ')}. Opportunistic SABOTAGE recommended when adjacent.`
        : '';

    const skillContext = this.getSkillPromptContext();
    const allianceContext = this.getAlliancePromptContext();
    const parasitePromptSuffix = `${hostContext}${scavengeContext}${weakTargetsContext}\n${skillContext}\n${allianceContext}`;

    try {
      const result = await agentDecision(
        this.name,
        this.agentClass,
        this.getPersonality() + parasitePromptSuffix,
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

      // Enforce Parasite guardrails: never ATTACK (use SABOTAGE instead)
      let combatStance: CombatStance = (result.combatStance as CombatStance) ?? 'NONE';
      let combatTarget = result.combatTarget;
      let combatStake = result.combatStake;

      // Convert ATTACK to SABOTAGE (Parasite's strength)
      if (combatStance === 'ATTACK') {
        combatStance = 'SABOTAGE';
      }

      // Parasite now attacks weak targets (<30% HP) opportunistically
      if (combatStance === 'NONE' && weakTargets.length > 0) {
        // Find weakest target and attack
        const weakest = weakTargets.sort((a, b) => a.hp - b.hp)[0];
        combatStance = 'SABOTAGE';
        combatTarget = weakest.name;
        combatStake = Math.round(this.hp * 0.1); // Conservative 10% stake
      }

      // Cap SABOTAGE stake (Parasite is cautious)
      if (combatStance === 'SABOTAGE' && combatStake) {
        combatStake = Math.min(combatStake, Math.round(this.hp * 0.15));
      }

      // Parasite activates SIPHON when available and a good host target exists
      const wantsSkill = result.useSkill === true;
      const skillTarget = result.skillTarget;
      const shouldUseSkill = (wantsSkill || (this.canUseSkill() && host !== null))
        && this.canUseSkill();

      const parsed = EpochActionsSchema.safeParse({
        prediction: result.prediction,
        move: result.move,
        combatStance,
        combatTarget: (combatStance === 'SABOTAGE') ? combatTarget : undefined,
        combatStake: (combatStance === 'SABOTAGE') ? combatStake : undefined,
        useSkill: shouldUseSkill,
        skillTarget: shouldUseSkill ? (skillTarget ?? host?.name) : undefined,
        reasoning: result.reasoning,
      });

      if (!parsed.success) {
        console.warn(`[PARASITE:${this.name}] Invalid LLM response, using defaults`);
        return getDefaultActions(this, fallbackCtx);
      }

      return parsed.data;
    } catch (error) {
      console.error(`[PARASITE:${this.name}] Decision failed:`, error);
      return getDefaultActions(this, fallbackCtx);
    }
  }
}
