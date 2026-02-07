/**
 * HUNGERNADS - Parasite Agent
 *
 * Copy-trading agent that mirrors the most profitable agent's predictions.
 * Low-risk predictions at 50% of host's size, scavenges dying agents,
 * defends when targeted. Struggles late-game when hosts die.
 */

import { BaseAgent, getDefaultActions } from './base-agent';
import { EpochActionsSchema } from './schemas';
import type { ArenaState, ArenaAgentState, EpochActions } from './schemas';
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

  async decide(arenaState: ArenaState): Promise<EpochActions> {
    const others = arenaState.agents
      .filter(a => a.id !== this.id && a.isAlive)
      .map(a => ({ name: a.name, class: a.class, hp: a.hp }));

    // Parasite-specific context: identify host and scavenge targets
    const host = findHost(this.id, arenaState.agents);
    const scavengeTargets = findScavengeTargets(this.id, arenaState.agents);

    const hostContext = host
      ? `\nYOUR HOST (copy this agent): ${host.name} (${host.class}) at ${host.hp} HP (${Math.round(host.hpRatio * 100)}% relative strength). Mirror their likely prediction at 50% stake size.`
      : '\nNO VIABLE HOST FOUND. All hosts are dead or only GAMBLER remains. You must make ORIGINAL decisions now. Express uncertainty - your edge is gone.';

    const scavengeContext =
      scavengeTargets.length > 0
        ? `\nSCAVENGE TARGETS (below 15% HP): ${scavengeTargets.map(t => `${t.name} (${t.hp} HP)`).join(', ')}. Easy pickings - small attack stakes to finish them.`
        : '\nNo scavenge targets available (no agents below 15% HP).';

    const parasitePromptSuffix = `${hostContext}${scavengeContext}`;

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
      );

      const parsed = EpochActionsSchema.safeParse({
        prediction: result.prediction,
        attack: result.attack ?? undefined,
        defend: result.defend,
        reasoning: result.reasoning,
      });

      if (!parsed.success) {
        console.warn(`[PARASITE:${this.name}] Invalid LLM response, using defaults`);
        return getDefaultActions(this);
      }

      return parsed.data;
    } catch (error) {
      console.error(`[PARASITE:${this.name}] Decision failed:`, error);
      return getDefaultActions(this);
    }
  }
}
