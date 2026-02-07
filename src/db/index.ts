/**
 * HUNGERNADS - Database Module
 *
 * D1 schema, queries, and migrations for battle state,
 * agent profiles, betting records, and leaderboards.
 */

export const DB_VERSION = 1;

// ─── Row Types ───────────────────────────────────────────────────

export type {
  AgentRow,
  BattleRow,
  EpochRow,
  EpochActionRow,
  LessonRow,
  BetRow,
  SponsorshipRow,
} from './schema';

// ─── Query Helpers ───────────────────────────────────────────────

export {
  // Agents
  insertAgent,
  getAgent,
  getAllAgents,
  // Battles
  insertBattle,
  getBattle,
  updateBattleStatus,
  updateBattle,
  // Epochs
  insertEpoch,
  getEpoch,
  getEpochsByBattle,
  // Epoch Actions
  insertEpochAction,
  getEpochActions,
  getAgentActions,
  // Lessons
  insertLesson,
  getAgentLessons,
  getLessonsByBattle,
  // Bets
  insertBet,
  getBetsByBattle,
  getBetsByUser,
  settleBet,
  settleBattleBets,
  // Sponsorships
  insertSponsorship,
  getSponsorshipsByBattle,
  getSponsorshipsByAgent,
  acceptSponsorship,
} from './schema';
