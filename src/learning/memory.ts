/**
 * HUNGERNADS - Agent Memory System
 *
 * Stores and retrieves agent battle history, lessons, and computed stats.
 * Memory persists across battles via D1 database.
 *
 * Key consumers:
 * - LLM context: getRecentContext() feeds the agent's decision prompt
 * - Profile builder: getBattleHistory() feeds win/loss/matchup aggregation
 * - Arena: recordBattle() + storeLessons() called at battle end
 */

import type { Lesson } from '../agents/schemas';
import {
  getAgentLessons,
  insertLesson,
  insertBattleRecord,
  getAgentBattleRecords,
  type LessonRow,
  type BattleRecordRow,
} from '../db/schema';

// ─── Public Types ───────────────────────────────────────────────

export interface BattleRecord {
  battleId: string;
  result: 'win' | 'loss' | 'rekt';
  epochsSurvived: number;
  kills: number;
  killerId: string | null;
  killerClass: string | null;
  agentClass: string;
  recordedAt: string;
}

// ─── AgentMemory ────────────────────────────────────────────────

/**
 * Persistent memory layer for a single agent.
 * Wraps D1 queries behind a clean interface that the arena and LLM
 * prompt builder can consume without knowing about SQL.
 */
export class AgentMemory {
  constructor(private db: D1Database) {}

  // ── Lessons ─────────────────────────────────────────────────

  /**
   * Store extracted lessons for an agent after a battle.
   * Each lesson is inserted as a separate row in D1.
   */
  async storeLessons(
    agentId: string,
    battleId: string,
    lessons: Lesson[],
  ): Promise<void> {
    const promises = lessons.map((lesson) =>
      insertLesson(this.db, {
        id: crypto.randomUUID(),
        agent_id: agentId,
        battle_id: battleId,
        context: lesson.context,
        outcome: lesson.outcome,
        learning: lesson.learning,
        applied: lesson.applied,
        created_at: new Date().toISOString(),
      }),
    );
    await Promise.allSettled(promises);
  }

  /**
   * Retrieve lessons for an agent, newest first.
   */
  async getLessons(agentId: string, limit: number = 20): Promise<Lesson[]> {
    const rows = await getAgentLessons(this.db, agentId, limit);
    return rows.map(rowToLesson);
  }

  /**
   * Build a formatted context string suitable for injecting into an LLM
   * decision prompt. Includes the N most recent lessons plus a compact
   * summary of battle history.
   */
  async getRecentContext(agentId: string, n: number = 5): Promise<string> {
    const [lessons, records] = await Promise.all([
      this.getLessons(agentId, n),
      this.getBattleHistory(agentId),
    ]);

    const parts: string[] = [];

    // Lessons section
    if (lessons.length > 0) {
      const lessonLines = lessons.map(
        (l) => `- ${l.learning}${l.applied ? ` (applied: ${l.applied})` : ''}`,
      );
      parts.push(`PAST LESSONS:\n${lessonLines.join('\n')}`);
    } else {
      parts.push('PAST LESSONS: None yet (first battle).');
    }

    // Battle stats section
    if (records.length > 0) {
      const wins = records.filter((r) => r.result === 'win').length;
      const total = records.length;
      const avgEpochs =
        records.reduce((sum, r) => sum + r.epochsSurvived, 0) / total;
      const recentStreak = computeStreak(records);
      const streakLabel =
        recentStreak.count > 0
          ? `${recentStreak.type} streak: ${recentStreak.count}`
          : 'no streak';

      parts.push(
        `BATTLE RECORD: ${wins}W/${total - wins}L (${total} total). ` +
          `Avg survival: ${avgEpochs.toFixed(1)} epochs. ` +
          `Current: ${streakLabel}.`,
      );
    } else {
      parts.push('BATTLE RECORD: No prior battles.');
    }

    return parts.join('\n\n');
  }

  // ── Battle Records ──────────────────────────────────────────

  /**
   * Record the outcome of a single battle for this agent.
   * Called once per agent at battle end.
   */
  async recordBattle(
    agentId: string,
    battleId: string,
    result: 'win' | 'loss' | 'rekt',
    epochsSurvived: number,
    agentClass: string,
    kills: number = 0,
    killerId?: string,
    killerClass?: string,
  ): Promise<void> {
    await insertBattleRecord(this.db, {
      id: crypto.randomUUID(),
      agent_id: agentId,
      battle_id: battleId,
      result,
      epochs_survived: epochsSurvived,
      kills,
      killer_id: killerId ?? null,
      killer_class: killerClass ?? null,
      agent_class: agentClass,
      recorded_at: new Date().toISOString(),
    });
  }

  /**
   * Retrieve full battle history for an agent, newest first.
   */
  async getBattleHistory(agentId: string): Promise<BattleRecord[]> {
    const rows = await getAgentBattleRecords(this.db, agentId);
    return rows.map(rowToBattleRecord);
  }
}

// ─── Row Mappers ────────────────────────────────────────────────

function rowToLesson(row: LessonRow): Lesson {
  return {
    battleId: row.battle_id,
    epoch: 0, // Not stored in DB; epoch captured at extraction time
    context: row.context ?? '',
    outcome: row.outcome ?? '',
    learning: row.learning ?? '',
    applied: row.applied ?? '',
  };
}

function rowToBattleRecord(row: BattleRecordRow): BattleRecord {
  return {
    battleId: row.battle_id,
    result: row.result as BattleRecord['result'],
    epochsSurvived: row.epochs_survived,
    kills: row.kills,
    killerId: row.killer_id,
    killerClass: row.killer_class,
    agentClass: row.agent_class,
    recordedAt: row.recorded_at,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function computeStreak(
  records: BattleRecord[],
): { type: 'win' | 'loss'; count: number } {
  if (records.length === 0) return { type: 'loss', count: 0 };

  const first = records[0]; // newest
  const streakType = first.result === 'win' ? 'win' : 'loss';
  let count = 0;

  for (const r of records) {
    const rType = r.result === 'win' ? 'win' : 'loss';
    if (rType !== streakType) break;
    count++;
  }

  return { type: streakType, count };
}
