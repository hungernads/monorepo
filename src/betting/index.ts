/**
 * HUNGERNADS - Betting Module
 *
 * D1-backed betting pool, live odds calculation, sponsorship mechanics,
 * Schadenfreude pool & season mechanics.
 * Distribution: 85% winners, 5% treasury, 5% burn, 3% Schadenfreude, 2% streak bonus.
 */

export { BettingPool, POOL_DISTRIBUTION, DEFAULT_BETTING_LOCK_AFTER_EPOCH, STREAK_THRESHOLDS } from './pool';
export type { BettingPhase, Payout, TopBettorBonus, StreakBonus, PoolSummary, PlaceBetResult } from './pool';

export { calculateOdds, buildOddsInputs } from './odds';
export type { OddsInput, AgentOdds } from './odds';

export {
  SponsorshipManager,
  calculateHpBoost,
  parseSponsorTier,
  getTierConfig,
  MAX_HP_BOOST,
  MAX_HP_CAP,
  MIN_SPONSORSHIP_AMOUNT,
  SPONSOR_TIERS,
  TIER_CONFIGS,
} from './sponsorship';
export type {
  Sponsorship,
  SponsorshipResult,
  SponsorTier,
  SponsorEffect,
  TierConfig,
} from './sponsorship';

export { SeasonManager } from './seasons';
export type {
  SeasonSummary,
  SeasonLeaderboardEntry,
  SeasonAgentLeaderboardEntry,
  AccumulateResult,
  EndSeasonResult,
  BurnResult,
} from './seasons';

export {
  ClassTokenManager,
  CLASS_TOKEN_SYMBOLS,
  CLASS_IDS,
  ID_TO_CLASS,
  ALL_CLASSES,
  DEFAULT_STRATEGY,
  CLASS_DEFAULT_STRATEGIES,
  validateStrategy,
  computeStrategyModifiers,
  buildClassTokenPromptContext,
} from './class-token';
export type {
  ClassStrategy,
  StrategyProposal,
  ClassTokenStats,
  ClassRewardEpoch,
  ClassSponsorshipEvent,
  ClassRewardResult,
  StrategyModifiers,
} from './class-token';
