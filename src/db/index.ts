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
  SeasonRow,
  SeasonLeaderboardRow,
  SeasonAgentLeaderboardRow,
  // Generative Memory
  MemoryObservationRow,
  MemoryReflectionRow,
  MemoryPlanRow,
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
  // Seasons
  getActiveSeason,
  getSeason,
  getSeasonByNumber,
  insertSeason,
  updateSeason,
  getCompletedBattleCount,
  insertSeasonLeaderboardEntry,
  getSeasonLeaderboard,
  claimSeasonPayout,
  getUnclaimedSeasonEntries,
  getExpiredSeasons,
  getTopBettorsByProfit,
  getUserSeasonEntry,
  listSeasons,
  BATTLES_PER_SEASON,
  CLAIM_WINDOW_DAYS,
  SCHADENFREUDE_TOP_N,
  // Season-scoped queries
  getBattlesBySeason,
  getTopBettorsByProfitForSeason,
  getAgentStatsForSeason,
  insertSeasonAgentLeaderboardEntry,
  getSeasonAgentLeaderboard,
  getSeasonBettingStats,
  // Generative Memory
  insertMemoryObservation,
  getAgentObservations,
  getObservationsByBattle,
  getRecentMemoryObservations,
  getHighImportanceObservations,
  insertMemoryReflection,
  getAgentReflections,
  getReflectionsByAbstraction,
  insertMemoryPlan,
  getActivePlans,
  getAgentPlans,
  updatePlanStatus,
  supersedePlansByAgent,
} from './schema';
