/**
 * HUNGERNADS - Post-Battle Lesson Extraction
 *
 * After a battle ends, each agent (including dead ones) gets an LLM call
 * to extract structured lessons from their battle experience.
 *
 * Lessons are PUBLIC - bettors can read them to inform future wagers.
 * This is a core differentiator: skill-based betting, not pure gambling.
 *
 * Uses injected LLM callback (no direct provider dependency) for testability.
 */

import { z } from 'zod';
import type { EpochResult } from '../arena/epoch';
import type { Lesson } from '../agents/schemas';
import { LessonSchema } from '../agents/schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BattleHistory {
  battleId: string;
  epochs: EpochResult[];
}

export interface AgentInfo {
  id: string;
  name: string;
  class: string;
}

/**
 * Injected LLM callback signature.
 * Takes a system prompt and user prompt, returns raw text.
 */
export type LLMCall = (system: string, prompt: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Internal: Zod schema for raw LLM lesson output (before battleId/epoch are added)
// ---------------------------------------------------------------------------

const RawLessonSchema = z.object({
  context: z.string().min(1),
  outcome: z.string().min(1),
  learning: z.string().min(1),
  applied: z.string().min(1),
});

const RawLessonsArraySchema = z.array(RawLessonSchema).min(1).max(3);

// ---------------------------------------------------------------------------
// Internal: Battle stats extraction from epoch results
// ---------------------------------------------------------------------------

interface AgentBattleStats {
  totalEpochs: number;
  survived: boolean;
  deathEpoch: number | null;
  finalHp: number;
  correctPredictions: number;
  totalPredictions: number;
  attacksMade: number;
  attacksLanded: number;
  attacksReceived: number;
  attacksBlocked: number;
  timesDefended: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalBleedLost: number;
  kills: number;
  epochSummaries: string[];
}

function extractAgentStats(
  agentId: string,
  agentName: string,
  epochs: EpochResult[],
): AgentBattleStats {
  let correctPredictions = 0;
  let totalPredictions = 0;
  let attacksMade = 0;
  let attacksLanded = 0;
  let attacksReceived = 0;
  let attacksBlocked = 0;
  let timesDefended = 0;
  let totalDamageDealt = 0;
  let totalDamageTaken = 0;
  let totalBleedLost = 0;
  let kills = 0;
  let deathEpoch: number | null = null;
  let finalHp = 0;
  const epochSummaries: string[] = [];

  for (const epoch of epochs) {
    const actions = epoch.actions.get(agentId);
    const predResult = epoch.predictionResults.find(r => r.agentId === agentId);
    const agentState = epoch.agentStates.find(s => s.id === agentId);
    const died = epoch.deaths.find(d => d.agentId === agentId);

    // Track final state
    if (agentState) {
      finalHp = agentState.hp;
    }

    // Prediction stats
    if (predResult) {
      totalPredictions++;
      if (predResult.correct) correctPredictions++;
    }

    // Combat: attacks this agent made
    const attacksOut = epoch.combatResults.filter(r => r.attackerId === agentId);
    attacksMade += attacksOut.length;
    for (const atk of attacksOut) {
      if (!atk.defended) {
        attacksLanded++;
        totalDamageDealt += atk.hpTransfer;
      }
    }

    // Combat: attacks this agent received
    const attacksIn = epoch.combatResults.filter(r => r.targetId === agentId);
    attacksReceived += attacksIn.length;
    for (const atk of attacksIn) {
      if (atk.defended) {
        attacksBlocked++;
      } else {
        totalDamageTaken += atk.hpTransfer;
      }
    }

    // Defence
    if (actions?.defend) {
      timesDefended++;
    }

    // Bleed
    const bleed = epoch.bleedResults.find(r => r.agentId === agentId);
    if (bleed) {
      totalBleedLost += bleed.bleedAmount;
    }

    // Deaths this agent caused
    const killsThisEpoch = epoch.deaths.filter(d => d.killerId === agentId);
    kills += killsThisEpoch.length;

    // Death of this agent
    if (died) {
      deathEpoch = epoch.epochNumber;
    }

    // Build epoch summary line (only if agent had actions this epoch)
    if (actions) {
      const parts: string[] = [];
      parts.push(`E${epoch.epochNumber}:`);

      if (predResult) {
        const dir = actions.prediction.direction;
        const asset = actions.prediction.asset;
        const stake = actions.prediction.stake;
        const result = predResult.correct ? 'CORRECT' : 'WRONG';
        const hp = predResult.hpChange > 0 ? `+${predResult.hpChange}` : `${predResult.hpChange}`;
        parts.push(`Predicted ${asset} ${dir} (${stake}% stake) -> ${result} (${hp} HP)`);
      }

      if (actions.attack) {
        const target = actions.attack.target;
        const atkResult = attacksOut.find(r => r.targetId === target || r.targetId !== agentId);
        if (atkResult) {
          if (atkResult.defended) {
            parts.push(`Attacked ${target} -> BLOCKED (lost ${Math.abs(atkResult.hpTransfer)} HP)`);
          } else {
            parts.push(`Attacked ${target} -> HIT (stole ${atkResult.hpTransfer} HP)`);
          }
        } else {
          parts.push(`Attempted attack on ${target}`);
        }
      }

      if (actions.defend) {
        const blocked = attacksIn.filter(a => a.defended).length;
        parts.push(`Defended (blocked ${blocked} attacks)`);
      }

      if (died) {
        parts.push(`DIED (${died.cause})`);
      }

      if (agentState) {
        parts.push(`HP: ${agentState.hp}`);
      }

      epochSummaries.push(parts.join(' | '));
    }
  }

  const survived = deathEpoch === null;

  return {
    totalEpochs: epochs.length,
    survived,
    deathEpoch,
    finalHp,
    correctPredictions,
    totalPredictions,
    attacksMade,
    attacksLanded,
    attacksReceived,
    attacksBlocked,
    timesDefended,
    totalDamageDealt,
    totalDamageTaken,
    totalBleedLost,
    kills,
    epochSummaries,
  };
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildLessonPrompt(
  agent: AgentInfo,
  stats: AgentBattleStats,
): { system: string; user: string } {
  const survivalStatus = stats.survived
    ? `You SURVIVED the entire battle (${stats.totalEpochs} epochs) with ${stats.finalHp} HP remaining.`
    : `You DIED at epoch ${stats.deathEpoch} out of ${stats.totalEpochs}.`;

  const predictionAccuracy = stats.totalPredictions > 0
    ? `${stats.correctPredictions}/${stats.totalPredictions} (${Math.round((stats.correctPredictions / stats.totalPredictions) * 100)}%)`
    : 'No predictions made';

  const system = [
    `You are ${agent.name}, a ${agent.class} gladiator in the AI Colosseum.`,
    `You are reflecting on a battle that just ended.`,
    `Extract tactical lessons that would help you fight better next time.`,
    `Be specific and actionable. Vague platitudes are useless.`,
    `Write from your personality perspective as a ${agent.class}.`,
  ].join('\n');

  const user = [
    `BATTLE SUMMARY:`,
    `- ${stats.totalEpochs} epochs total`,
    `- ${survivalStatus}`,
    ``,
    `YOUR PERFORMANCE:`,
    `- Predictions: ${predictionAccuracy}`,
    `- Attacks made: ${stats.attacksMade} (${stats.attacksLanded} landed, ${stats.attacksMade - stats.attacksLanded} blocked)`,
    `- Attacks received: ${stats.attacksReceived} (${stats.attacksBlocked} blocked by defending)`,
    `- Times defended: ${stats.timesDefended}`,
    `- Damage dealt: ${stats.totalDamageDealt} HP`,
    `- Damage taken: ${stats.totalDamageTaken} HP (combat) + ${stats.totalBleedLost} HP (bleed)`,
    `- Kills: ${stats.kills}`,
    `- Final HP: ${stats.finalHp}/1000`,
    ``,
    `YOUR ACTIONS EACH EPOCH:`,
    stats.epochSummaries.length > 0
      ? stats.epochSummaries.join('\n')
      : '(No epoch data available)',
    ``,
    `Extract 1-3 lessons learned from this battle. Each lesson should be a specific,`,
    `tactical insight that changes how you fight. Bettors will read these lessons to`,
    `decide who to bet on, so make them revealing about your strategy.`,
    ``,
    `Respond with ONLY a JSON array (no markdown, no explanation):`,
    `[{`,
    `  "context": "the specific situation you were in",`,
    `  "outcome": "what happened as a result",`,
    `  "learning": "the insight or pattern you identified",`,
    `  "applied": "the concrete tactical change for your next battle"`,
    `}]`,
  ].join('\n');

  return { system, user };
}

// ---------------------------------------------------------------------------
// JSON parsing with cleanup
// ---------------------------------------------------------------------------

function cleanJsonResponse(raw: string): string {
  let cleaned = raw.trim();

  // Strip markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Strip any leading/trailing non-JSON text
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }

  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// Fallback lessons (when LLM fails)
// ---------------------------------------------------------------------------

function generateFallbackLessons(
  agent: AgentInfo,
  battleId: string,
  stats: AgentBattleStats,
): Lesson[] {
  const lessons: Lesson[] = [];

  // Always generate at least one lesson from raw stats
  if (stats.totalPredictions > 0) {
    const accuracy = Math.round(
      (stats.correctPredictions / stats.totalPredictions) * 100,
    );
    const isGood = accuracy >= 50;

    lessons.push({
      battleId,
      epoch: stats.deathEpoch ?? stats.totalEpochs,
      context: `Predicted ${stats.totalPredictions} times during the battle`,
      outcome: `${stats.correctPredictions} correct (${accuracy}% accuracy)`,
      learning: isGood
        ? 'Market reading was solid this battle'
        : 'Market predictions were unreliable',
      applied: isGood
        ? 'Maintain current prediction approach, consider raising stakes'
        : 'Reduce stake sizes until prediction accuracy improves',
    });
  }

  if (stats.attacksReceived > 0 && stats.timesDefended === 0) {
    lessons.push({
      battleId,
      epoch: stats.deathEpoch ?? stats.totalEpochs,
      context: `Received ${stats.attacksReceived} attacks without ever defending`,
      outcome: `Lost ${stats.totalDamageTaken} HP to unblocked attacks`,
      learning: 'Never defending made me an easy target for attackers',
      applied: 'Consider defending when HP drops below 40% or when targeted repeatedly',
    });
  }

  if (!stats.survived && stats.totalBleedLost > stats.totalDamageTaken) {
    lessons.push({
      battleId,
      epoch: stats.deathEpoch ?? stats.totalEpochs,
      context: 'Died with bleed as the dominant damage source',
      outcome: `Lost ${stats.totalBleedLost} HP to bleed vs ${stats.totalDamageTaken} from combat`,
      learning: 'Slow attrition from bleed killed me more than direct combat',
      applied: 'Need to win predictions more consistently to offset constant bleed drain',
    });
  }

  // Ensure at least one lesson
  if (lessons.length === 0) {
    lessons.push({
      battleId,
      epoch: stats.deathEpoch ?? stats.totalEpochs,
      context: `Fought as ${agent.class} for ${stats.totalEpochs} epochs`,
      outcome: stats.survived
        ? `Survived with ${stats.finalHp} HP`
        : `Eliminated at epoch ${stats.deathEpoch}`,
      learning: stats.survived
        ? 'Current approach was enough to survive this battle'
        : 'Need to adapt strategy to last longer',
      applied: stats.survived
        ? 'Continue with current tactical approach but stay vigilant'
        : 'Re-evaluate risk levels and defensive posture',
    });
  }

  return lessons;
}

// ---------------------------------------------------------------------------
// Core: Extract lessons for a single agent
// ---------------------------------------------------------------------------

/**
 * Extract post-battle lessons for a single agent via LLM.
 *
 * Builds a prompt summarizing the agent's full battle experience (every epoch),
 * calls the injected LLM callback, and parses the response with Zod.
 *
 * Falls back to stats-derived lessons if the LLM fails or returns invalid output.
 *
 * @param agent - Agent identity (id, name, class)
 * @param battleHistory - Full battle history with all epoch results
 * @param llmCall - Injected LLM callback: (systemPrompt, userPrompt) => rawText
 * @returns Array of 1-3 structured Lesson objects
 */
export async function extractLessons(
  agent: AgentInfo,
  battleHistory: BattleHistory,
  llmCall: LLMCall,
): Promise<Lesson[]> {
  const stats = extractAgentStats(
    agent.id,
    agent.name,
    battleHistory.epochs,
  );

  const { system, user } = buildLessonPrompt(agent, stats);

  try {
    const rawResponse = await llmCall(system, user);
    const cleaned = cleanJsonResponse(rawResponse);
    const parsed = JSON.parse(cleaned);
    const validated = RawLessonsArraySchema.parse(parsed);

    // Enrich with battleId and epoch
    const lessons: Lesson[] = validated.map((raw) =>
      LessonSchema.parse({
        battleId: battleHistory.battleId,
        epoch: stats.deathEpoch ?? stats.totalEpochs,
        context: raw.context,
        outcome: raw.outcome,
        learning: raw.learning,
        applied: raw.applied,
      }),
    );

    return lessons;
  } catch (error) {
    console.error(
      `[Lessons] LLM extraction failed for ${agent.name} (${agent.id}):`,
      error instanceof Error ? error.message : error,
    );

    return generateFallbackLessons(agent, battleHistory.battleId, stats);
  }
}

// ---------------------------------------------------------------------------
// Core: Extract lessons for ALL agents in a battle
// ---------------------------------------------------------------------------

/**
 * Extract post-battle lessons for every agent in a battle (including dead ones).
 *
 * Runs all LLM calls in parallel for speed. Each agent's extraction is
 * independent and has its own fallback, so one failure won't block others.
 *
 * @param agents - All agents that participated in the battle
 * @param battleHistory - Full battle history with all epoch results
 * @param llmCall - Injected LLM callback: (systemPrompt, userPrompt) => rawText
 * @returns Map of agentId -> Lesson[] for every agent
 */
export async function extractAllLessons(
  agents: AgentInfo[],
  battleHistory: BattleHistory,
  llmCall: LLMCall,
): Promise<Map<string, Lesson[]>> {
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      const lessons = await extractLessons(agent, battleHistory, llmCall);
      return { agentId: agent.id, lessons };
    }),
  );

  const lessonsMap = new Map<string, Lesson[]>();

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const agent = agents[i];

    if (result.status === 'fulfilled') {
      lessonsMap.set(result.value.agentId, result.value.lessons);
    } else {
      // Even Promise.allSettled rejection means something very unexpected.
      // Generate fallback lessons from raw stats.
      console.error(
        `[Lessons] Unexpected failure for ${agent.name}:`,
        result.reason,
      );
      const stats = extractAgentStats(agent.id, agent.name, battleHistory.epochs);
      lessonsMap.set(
        agent.id,
        generateFallbackLessons(agent, battleHistory.battleId, stats),
      );
    }
  }

  return lessonsMap;
}

// ---------------------------------------------------------------------------
// DB helpers (thin wrappers over db/schema.ts)
// ---------------------------------------------------------------------------

/**
 * Store a lesson in the D1 database.
 */
export async function storeLesson(
  db: D1Database,
  agentId: string,
  lesson: Lesson,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO lessons (id, agent_id, battle_id, context, outcome, learning, applied, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      agentId,
      lesson.battleId,
      lesson.context,
      lesson.outcome,
      lesson.learning,
      lesson.applied,
      new Date().toISOString(),
    )
    .run();
}

/**
 * Store all lessons from a battle extraction to D1.
 */
export async function storeBattleLessons(
  db: D1Database,
  lessonsMap: Map<string, Lesson[]>,
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [agentId, lessons] of lessonsMap) {
    for (const lesson of lessons) {
      promises.push(storeLesson(db, agentId, lesson));
    }
  }

  await Promise.allSettled(promises);
}

/**
 * Get recent lessons for an agent from D1.
 */
export async function getRecentLessons(
  db: D1Database,
  agentId: string,
  limit: number = 10,
): Promise<Lesson[]> {
  const result = await db
    .prepare(
      'SELECT * FROM lessons WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<{
      battle_id: string;
      context: string | null;
      outcome: string | null;
      learning: string | null;
      applied: string | null;
    }>();

  return result.results.map((row) => ({
    battleId: row.battle_id,
    epoch: 0, // Not stored in DB row; epoch is captured at extraction time
    context: row.context ?? '',
    outcome: row.outcome ?? '',
    learning: row.learning ?? '',
    applied: row.applied ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Re-export internals for testing
// ---------------------------------------------------------------------------

export { extractAgentStats as _extractAgentStats };
export type { AgentBattleStats };
