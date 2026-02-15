/**
 * HUNGERNADS - Agent Durable Object
 *
 * Persistent agent state across battles. Each agent instance
 * maintains its own memory, lessons, HP, and stats.
 *
 * The AgentDO is the source of truth for an agent's identity and
 * learning history. The ArenaDO calls into AgentDO for decisions
 * each epoch and to update post-battle learnings.
 */

import type { Env } from '../index';
import type { AgentClass, AgentState, EpochActions, MarketData, ArenaContext } from '../agents';
import { agentDecision, getLLM, type LLMKeys } from '../llm';
import { PERSONALITIES } from '../agents/personalities';
import { EpochActionsSchema } from '../agents/schemas';

// ─── Types ────────────────────────────────────────────────────────

export interface Lesson {
  battleId: string;
  epoch: number;
  context: string;
  outcome: string;
  learning: string;
  applied: string;
  createdAt: string;
}

export interface AgentStats {
  battlesPlayed: number;
  battlesWon: number;
  totalKills: number;
  totalDeaths: number;
  totalEpochsSurvived: number;
  avgPlacement: number;
  matchups: Record<AgentClass, { wins: number; losses: number }>;
}

export interface AgentProfile {
  id: string;
  name: string;
  class: AgentClass;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  kills: number;
  epochsSurvived: number;
  lessons: Lesson[];
  stats: AgentStats;
  createdAt: string;
}

const DEFAULT_STATS: AgentStats = {
  battlesPlayed: 0,
  battlesWon: 0,
  totalKills: 0,
  totalDeaths: 0,
  totalEpochsSurvived: 0,
  avgPlacement: 0,
  matchups: {
    WARRIOR: { wins: 0, losses: 0 },
    TRADER: { wins: 0, losses: 0 },
    SURVIVOR: { wins: 0, losses: 0 },
    PARASITE: { wins: 0, losses: 0 },
    GAMBLER: { wins: 0, losses: 0 },
  },
};

// ─── Agent Durable Object ─────────────────────────────────────────

export class AgentDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ─── Agent Initialization ─────────────────────────────────────

  /**
   * Initialize agent with name and class.
   * Idempotent: only sets values if not already set.
   */
  async initialize(name: string, agentClass: AgentClass): Promise<AgentProfile> {
    const existing = await this.state.storage.get<string>('id');
    if (!existing) {
      const id = crypto.randomUUID();
      await this.state.storage.put({
        id,
        name,
        class: agentClass,
        hp: 1000,
        maxHp: 1000,
        isAlive: true,
        kills: 0,
        epochsSurvived: 0,
        lessons: [] as Lesson[],
        stats: DEFAULT_STATS,
        createdAt: new Date().toISOString(),
      });
    }
    return this.getProfile();
  }

  // ─── Decision Making ──────────────────────────────────────────

  /**
   * Make a decision for the current epoch.
   * Calls the multi-provider LLM with the agent's personality and memory.
   * Falls back to class-specific defaults if LLM is unavailable.
   */
  async decide(marketData: MarketData, arenaState: ArenaContext): Promise<EpochActions> {
    const agentClass = (await this.state.storage.get<AgentClass>('class')) ?? 'WARRIOR';
    const hp = (await this.state.storage.get<number>('hp')) ?? 1000;
    const name = (await this.state.storage.get<string>('name')) ?? 'Unknown';
    const lessons = (await this.state.storage.get<Lesson[]>('lessons')) ?? [];

    // Extract LLM keys from Cloudflare env bindings
    const llmKeys: LLMKeys = {
      groqApiKeys: this.env.GROQ_API_KEYS,
      groqApiKey: this.env.GROQ_API_KEY,
      googleApiKey: this.env.GOOGLE_API_KEY,
      openrouterApiKey: this.env.OPENROUTER_API_KEY,
    };

    // Check if any LLM keys are available
    const hasKeys = !!(llmKeys.groqApiKeys || llmKeys.groqApiKey || llmKeys.googleApiKey || llmKeys.openrouterApiKey);

    if (!hasKeys) {
      // No LLM keys configured - use class-specific defaults
      return this.getDefaultActions(agentClass, hp, arenaState);
    }

    try {
      const personality = PERSONALITIES[agentClass]?.systemPrompt ?? '';
      const otherAgents = arenaState.agents
        .filter((a: AgentState) => a.id !== (arenaState.agents.find((ag: AgentState) => ag.class === agentClass)?.id))
        .filter((a: AgentState) => a.isAlive)
        .map((a: AgentState) => ({ name: a.name, class: a.class, hp: a.hp }));

      const result = await agentDecision(
        name,
        agentClass,
        personality,
        hp,
        {
          eth: marketData.prices.ETH ?? 0,
          btc: marketData.prices.BTC ?? 0,
          sol: marketData.prices.SOL ?? 0,
          mon: marketData.prices.MON ?? 0,
        },
        otherAgents,
        lessons.slice(-3).map(l => l.learning),
        llmKeys,
      );

      // Validate with Zod schema
      const parsed = EpochActionsSchema.safeParse({
        prediction: result.prediction,
        combatStance: result.combatStance ?? 'NONE',
        combatTarget: result.combatTarget,
        combatStake: result.combatStake,
        // Legacy fields for backward compat
        attack: result.attack ?? undefined,
        defend: result.defend,
        reasoning: result.reasoning,
      });

      if (!parsed.success) {
        console.warn(`[AgentDO:${name}] Invalid LLM response, using defaults`);
        return this.getDefaultActions(agentClass, hp, arenaState);
      }

      return parsed.data;
    } catch (error) {
      console.error(`[AgentDO:${name}] LLM decision failed:`, error);
      return this.getDefaultActions(agentClass, hp, arenaState);
    }
  }

  /**
   * Fallback actions when LLM is unavailable or response is invalid.
   */
  private getDefaultActions(agentClass: AgentClass, hp: number, arenaState: ArenaContext): EpochActions {
    const stakePercent = agentClass === 'WARRIOR' ? 0.3
      : agentClass === 'GAMBLER' ? Math.random() * 0.45 + 0.05
      : agentClass === 'SURVIVOR' ? 0.05
      : 0.15;

    const stake = Math.floor(hp * stakePercent);
    const selfId = arenaState.agents.find((a: AgentState) => a.class === agentClass)?.id;

    const actions: EpochActions = {
      prediction: {
        asset: 'ETH',
        direction: Math.random() > 0.5 ? 'UP' : 'DOWN',
        stake: Math.max(stake, 1),
      },
      combatStance: 'NONE',
      reasoning: `Default ${agentClass} behavior: conservative prediction while LLM integration pending.`,
    };

    // Class-specific combat defaults (triangle system)
    if (agentClass === 'WARRIOR') {
      const targets = arenaState.agents.filter((a: AgentState) => a.isAlive && a.id !== selfId);
      const weakest = targets.sort((a: AgentState, b: AgentState) => a.hp - b.hp)[0];
      if (weakest) {
        actions.combatStance = 'ATTACK';
        actions.combatTarget = weakest.id;
        actions.combatStake = Math.floor(hp * 0.1);
      }
    }

    if (agentClass === 'SURVIVOR') {
      actions.combatStance = 'DEFEND';
    }

    if (agentClass === 'TRADER' || agentClass === 'PARASITE') {
      actions.combatStance = 'NONE';
    }

    return actions;
  }

  // ─── HP Management ────────────────────────────────────────────

  /**
   * Apply damage to agent. Returns actual damage dealt.
   */
  async takeDamage(amount: number): Promise<{ actualDamage: number; hp: number; isAlive: boolean }> {
    const hp = (await this.state.storage.get<number>('hp')) ?? 1000;
    const actualDamage = Math.min(amount, hp);
    const newHp = hp - actualDamage;
    const isAlive = newHp > 0;

    await this.state.storage.put('hp', newHp);
    await this.state.storage.put('isAlive', isAlive);

    return { actualDamage, hp: newHp, isAlive };
  }

  /**
   * Heal agent. HP is capped at maxHp (1000).
   */
  async heal(amount: number): Promise<{ actualHeal: number; hp: number }> {
    const hp = (await this.state.storage.get<number>('hp')) ?? 1000;
    const maxHp = (await this.state.storage.get<number>('maxHp')) ?? 1000;
    const actualHeal = Math.min(amount, maxHp - hp);
    const newHp = hp + actualHeal;

    await this.state.storage.put('hp', newHp);
    if (newHp > 0) {
      await this.state.storage.put('isAlive', true);
    }

    return { actualHeal, hp: newHp };
  }

  // ─── Learning System ──────────────────────────────────────────

  /**
   * Extract and store lessons from a completed battle.
   * Uses LLM to generate 2-3 specific, actionable lessons from battle history.
   * Falls back to basic outcome-based lessons if LLM is unavailable or fails.
   */
  async learn(battleHistory: {
    battleId: string;
    epochs: number;
    placement: number;
    killedBy?: string;
    kills: string[];
    /** Optional battle summary for richer LLM context. */
    battleSummary?: string;
  }): Promise<Lesson[]> {
    const lessons = (await this.state.storage.get<Lesson[]>('lessons')) ?? [];
    const stats = (await this.state.storage.get<AgentStats>('stats')) ?? { ...DEFAULT_STATS };
    const agentClass = (await this.state.storage.get<AgentClass>('class')) ?? 'WARRIOR';
    const name = (await this.state.storage.get<string>('name')) ?? 'Unknown';

    // Build basic context and outcome strings
    const context = `Battle lasted ${battleHistory.epochs} epochs. Placed #${battleHistory.placement}.`;
    const outcome = battleHistory.killedBy
      ? `Killed by ${battleHistory.killedBy}`
      : battleHistory.placement === 1
        ? 'Won the battle'
        : 'Survived but did not win';

    // Attempt LLM-generated lessons
    let newLessons: Lesson[] = [];
    const llmKeys: LLMKeys = {
      groqApiKeys: this.env.GROQ_API_KEYS,
      groqApiKey: this.env.GROQ_API_KEY,
      googleApiKey: this.env.GOOGLE_API_KEY,
      openrouterApiKey: this.env.OPENROUTER_API_KEY,
    };
    const hasKeys = !!(llmKeys.groqApiKeys || llmKeys.groqApiKey || llmKeys.googleApiKey || llmKeys.openrouterApiKey);

    if (hasKeys) {
      try {
        const llm = getLLM(llmKeys);
        const summaryBlock = battleHistory.battleSummary
          ? `\nBATTLE DETAILS:\n${battleHistory.battleSummary}`
          : '';
        const response = await llm.chat([
          {
            role: 'system',
            content: `You are analyzing a gladiator battle in the HUNGERNADS arena. Generate exactly 2-3 short, specific lessons this agent learned. Each lesson should reference actual battle events. Respond with ONLY a JSON array of objects with fields: "learning" (one sentence, specific), "applied" (how to apply this next time, one sentence).`,
          },
          {
            role: 'user',
            content: `AGENT: ${name} (${agentClass})
RESULT: Placed #${battleHistory.placement} out of 5-8 agents.
${outcome}
Kills: ${battleHistory.kills.length > 0 ? battleHistory.kills.join(', ') : 'None'}
Epochs survived: ${battleHistory.epochs}${summaryBlock}

Generate 2-3 specific lessons.`,
          },
        ], { maxTokens: 300, temperature: 0.7 });

        let jsonStr = response.content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }
        const parsed = JSON.parse(jsonStr) as Array<{ learning: string; applied: string }>;

        if (Array.isArray(parsed) && parsed.length > 0) {
          newLessons = parsed.slice(0, 3).map((l) => ({
            battleId: battleHistory.battleId,
            epoch: battleHistory.epochs,
            context,
            outcome,
            learning: l.learning || 'No lesson extracted.',
            applied: l.applied || '',
            createdAt: new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.warn(`[AgentDO:${name}] LLM lesson generation failed, using fallback:`, err);
      }
    }

    // Fallback: basic lesson if LLM failed or unavailable
    if (newLessons.length === 0) {
      newLessons = [{
        battleId: battleHistory.battleId,
        epoch: battleHistory.epochs,
        context,
        outcome,
        learning: battleHistory.placement === 1
          ? `Won the battle after ${battleHistory.epochs} epochs with ${battleHistory.kills.length} kill(s).`
          : battleHistory.killedBy
            ? `Was eliminated by ${battleHistory.killedBy} after ${battleHistory.epochs} epochs.`
            : `Survived ${battleHistory.epochs} epochs but placed #${battleHistory.placement}.`,
        applied: '',
        createdAt: new Date().toISOString(),
      }];
    }

    lessons.push(...newLessons);

    // Keep only last 50 lessons to manage storage
    const trimmedLessons = lessons.slice(-50);

    // Update stats
    stats.battlesPlayed += 1;
    if (battleHistory.placement === 1) stats.battlesWon += 1;
    stats.totalKills += battleHistory.kills.length;
    if (battleHistory.killedBy) stats.totalDeaths += 1;
    stats.totalEpochsSurvived += battleHistory.epochs;
    stats.avgPlacement = stats.battlesPlayed > 0
      ? ((stats.avgPlacement * (stats.battlesPlayed - 1)) + battleHistory.placement) / stats.battlesPlayed
      : battleHistory.placement;

    await this.state.storage.put('lessons', trimmedLessons);
    await this.state.storage.put('stats', stats);

    return newLessons;
  }

  // ─── Profile / State ──────────────────────────────────────────

  /**
   * Return public agent profile with stats and recent lessons.
   */
  async getProfile(): Promise<AgentProfile> {
    const [id, name, agentClass, hp, maxHp, isAlive, kills, epochsSurvived, lessons, stats, createdAt] =
      await Promise.all([
        this.state.storage.get<string>('id'),
        this.state.storage.get<string>('name'),
        this.state.storage.get<AgentClass>('class'),
        this.state.storage.get<number>('hp'),
        this.state.storage.get<number>('maxHp'),
        this.state.storage.get<boolean>('isAlive'),
        this.state.storage.get<number>('kills'),
        this.state.storage.get<number>('epochsSurvived'),
        this.state.storage.get<Lesson[]>('lessons'),
        this.state.storage.get<AgentStats>('stats'),
        this.state.storage.get<string>('createdAt'),
      ]);

    return {
      id: id ?? 'uninitialized',
      name: name ?? 'Unknown',
      class: agentClass ?? 'WARRIOR',
      hp: hp ?? 1000,
      maxHp: maxHp ?? 1000,
      isAlive: isAlive ?? true,
      kills: kills ?? 0,
      epochsSurvived: epochsSurvived ?? 0,
      lessons: (lessons ?? []).slice(-10), // Last 10 lessons in profile
      stats: stats ?? { ...DEFAULT_STATS },
      createdAt: createdAt ?? new Date().toISOString(),
    };
  }

  /**
   * Reset agent HP and combat state for a new battle.
   */
  async resetForBattle(): Promise<void> {
    await this.state.storage.put('hp', 1000);
    await this.state.storage.put('isAlive', true);
    await this.state.storage.put('kills', 0);
    await this.state.storage.put('epochsSurvived', 0);
  }

  // ─── HTTP Handler ─────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Get full profile
    if (url.pathname === '/profile') {
      const profile = await this.getProfile();
      return Response.json(profile);
    }

    // Initialize agent
    if (url.pathname === '/init' && request.method === 'POST') {
      const body = (await request.json()) as { name?: string; class?: AgentClass };
      if (!body.name || !body.class) {
        return Response.json({ error: 'Provide name and class' }, { status: 400 });
      }
      const profile = await this.initialize(body.name, body.class);
      return Response.json({ ok: true, agent: profile });
    }

    // Make a decision
    if (url.pathname === '/decide' && request.method === 'POST') {
      const body = (await request.json()) as { marketData: MarketData; arenaState: ArenaContext };
      const actions = await this.decide(body.marketData, body.arenaState);
      return Response.json(actions);
    }

    // Take damage
    if (url.pathname === '/damage' && request.method === 'POST') {
      const body = (await request.json()) as { amount: number };
      if (typeof body.amount !== 'number' || body.amount <= 0) {
        return Response.json({ error: 'Provide positive damage amount' }, { status: 400 });
      }
      const result = await this.takeDamage(body.amount);
      return Response.json(result);
    }

    // Heal
    if (url.pathname === '/heal' && request.method === 'POST') {
      const body = (await request.json()) as { amount: number };
      if (typeof body.amount !== 'number' || body.amount <= 0) {
        return Response.json({ error: 'Provide positive heal amount' }, { status: 400 });
      }
      const result = await this.heal(body.amount);
      return Response.json(result);
    }

    // Learn from battle
    if (url.pathname === '/learn' && request.method === 'POST') {
      const body = (await request.json()) as {
        battleId: string;
        epochs: number;
        placement: number;
        killedBy?: string;
        kills: string[];
      };
      const newLessons = await this.learn(body);
      return Response.json({ ok: true, lessons: newLessons });
    }

    // Get lessons
    if (url.pathname === '/lessons') {
      const lessons = (await this.state.storage.get<Lesson[]>('lessons')) ?? [];
      return Response.json({ lessons });
    }

    // Reset for battle
    if (url.pathname === '/reset' && request.method === 'POST') {
      await this.resetForBattle();
      return Response.json({ ok: true });
    }

    // Status (backward compat)
    if (url.pathname === '/status') {
      const hp = (await this.state.storage.get<number>('hp')) ?? 1000;
      const name = (await this.state.storage.get<string>('name')) ?? 'Unknown';
      return Response.json({ name, hp, alive: hp > 0 });
    }

    return Response.json({ error: 'Unknown agent action' }, { status: 404 });
  }
}
