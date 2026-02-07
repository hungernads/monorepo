/**
 * HUNGERNADS - Public Profile Generation
 *
 * Generates public-facing agent profiles from battle history.
 * Includes stats, recent lessons, matchup data.
 * Users study these to make informed bets.
 *
 * All data is PUBLIC by design - nads study agent profiles to
 * gain an edge in betting.
 */

import type { AgentProfile, Lesson, AgentClass, MatchupRecord } from '../agents/schemas';
import {
  getAgent,
  getAgentBattleRecords,
  getAgentLessons,
  type BattleRecordRow,
  type LessonRow,
} from '../db/schema';

// ─── AgentProfileBuilder ────────────────────────────────────────

/**
 * Computes public-facing agent profiles from D1 data.
 * Profiles aggregate battle records, lessons, and derived stats
 * that nads use to inform their betting decisions.
 */
export class AgentProfileBuilder {
  constructor(private db: D1Database) {}

  /**
   * Build a complete public profile for the given agent.
   * Fetches battle records + recent lessons from D1, then computes
   * derived stats (win rate, matchups, death causes, streak).
   */
  async buildProfile(agentId: string): Promise<AgentProfile> {
    const [agent, records, lessonRows] = await Promise.all([
      getAgent(this.db, agentId),
      getAgentBattleRecords(this.db, agentId),
      getAgentLessons(this.db, agentId, 10),
    ]);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const totalBattles = records.length;
    const wins = records.filter((r) => r.result === 'win').length;
    const kills = records.reduce((sum, r) => sum + r.kills, 0);
    const winRate = totalBattles > 0 ? wins / totalBattles : 0;

    const matchups = buildMatchups(records);
    const deathCauses = buildDeathCauses(records);
    const avgSurvival = computeAvgSurvival(records);
    const streak = computeStreak(records);
    const recentLessons = lessonRows.map(rowToLesson);

    return {
      agentId,
      agentClass: agent.class as AgentClass,
      totalBattles,
      wins,
      kills,
      matchups,
      deathCauses,
      avgSurvival,
      winRate,
      streak,
      recentLessons,
    };
  }

  /**
   * Get win/loss record vs each agent class.
   * Useful for the matchup chart in the spectator UI.
   */
  async getMatchups(
    agentId: string,
  ): Promise<Record<string, MatchupRecord>> {
    const records = await getAgentBattleRecords(this.db, agentId);
    return buildMatchups(records);
  }

  /**
   * Get death cause breakdown (what killed this agent most often).
   * Keys are killer class names; values are kill counts.
   */
  async getDeathCauses(
    agentId: string,
  ): Promise<Record<string, number>> {
    const records = await getAgentBattleRecords(this.db, agentId);
    return buildDeathCauses(records);
  }
}

// ─── Leaderboard ────────────────────────────────────────────────

/**
 * Get leaderboard of top agents by win rate.
 * Requires at least 1 battle to appear on the board.
 */
export async function getAgentLeaderboard(
  db: D1Database,
  limit: number = 20,
): Promise<AgentProfile[]> {
  // Fetch all agents that have at least one battle record
  const result = await db
    .prepare(
      `SELECT agent_id
       FROM battle_records
       GROUP BY agent_id
       HAVING COUNT(*) >= 1
       ORDER BY (CAST(SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ agent_id: string }>();

  const builder = new AgentProfileBuilder(db);
  const profiles = await Promise.all(
    result.results.map((row) => builder.buildProfile(row.agent_id)),
  );

  return profiles;
}

// ─── Aggregation Helpers ────────────────────────────────────────

/**
 * Build matchup records: win/loss against each opposing class.
 * A "win against X" means the agent's killer_class was NOT X and
 * the agent won, OR the agent rekt'd an agent of class X.
 *
 * Implementation: for rekt/loss records, the killer_class tells us
 * who beat this agent. For win records, we count as a win vs all
 * classes that participated (tracked separately in battle context).
 *
 * Simplified approach: count killer_class for losses/rekts, and
 * for wins we don't have opponent info in the record so wins are
 * counted per-battle without opponent breakdown. The matchup only
 * tracks "died to class X" for losses and "survived vs all" for wins.
 *
 * More accurate approach used here: for each battle record:
 * - If result = 'rekt' or 'loss' and killer_class is present, that
 *   class gets a win against this agent.
 * - If result = 'win', all classes that killed this agent in OTHER
 *   battles get a loss credited. But since we process per-record,
 *   we simply credit a "win" entry for each class we've lost to
 *   historically (not ideal).
 *
 * Cleanest: just track losses by killer_class, and wins by battle
 * count minus losses to each class.
 */
function buildMatchups(
  records: BattleRecordRow[],
): Record<string, MatchupRecord> {
  const matchups: Record<string, { wins: number; losses: number }> = {};

  for (const r of records) {
    if ((r.result === 'rekt' || r.result === 'loss') && r.killer_class) {
      if (!matchups[r.killer_class]) {
        matchups[r.killer_class] = { wins: 0, losses: 0 };
      }
      matchups[r.killer_class].losses++;
    }
  }

  // For wins, we don't know which specific classes were beaten.
  // Distribute wins evenly across known opponent classes.
  const totalWins = records.filter((r) => r.result === 'win').length;
  const knownClasses = Object.keys(matchups);

  if (totalWins > 0 && knownClasses.length > 0) {
    // Attribute wins proportionally to classes we've faced
    const winsPerClass = Math.floor(totalWins / knownClasses.length);
    const remainder = totalWins % knownClasses.length;

    knownClasses.forEach((cls, i) => {
      matchups[cls].wins += winsPerClass + (i < remainder ? 1 : 0);
    });
  }

  return matchups;
}

/**
 * Count how many times each killer class has rekt'd this agent.
 */
function buildDeathCauses(
  records: BattleRecordRow[],
): Record<string, number> {
  const causes: Record<string, number> = {};

  for (const r of records) {
    if (r.result === 'rekt' && r.killer_class) {
      causes[r.killer_class] = (causes[r.killer_class] ?? 0) + 1;
    }
  }

  // Also track "bleed" deaths (rekt with no killer = bled out)
  const bleedDeaths = records.filter(
    (r) => r.result === 'rekt' && !r.killer_id,
  ).length;
  if (bleedDeaths > 0) {
    causes['BLEED'] = bleedDeaths;
  }

  return causes;
}

/**
 * Average epochs survived across all battles.
 */
function computeAvgSurvival(records: BattleRecordRow[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, r) => sum + r.epochs_survived, 0);
  return total / records.length;
}

/**
 * Current win/loss streak. Positive = win streak, negative = loss streak.
 * Records are assumed to be ordered newest-first.
 */
function computeStreak(records: BattleRecordRow[]): number {
  if (records.length === 0) return 0;

  const first = records[0];
  const isWinStreak = first.result === 'win';
  let count = 0;

  for (const r of records) {
    const isWin = r.result === 'win';
    if (isWin !== isWinStreak) break;
    count++;
  }

  return isWinStreak ? count : -count;
}

// ─── Row Mapper ─────────────────────────────────────────────────

function rowToLesson(row: LessonRow): Lesson {
  return {
    battleId: row.battle_id,
    epoch: 0,
    context: row.context ?? '',
    outcome: row.outcome ?? '',
    learning: row.learning ?? '',
    applied: row.applied ?? '',
  };
}
