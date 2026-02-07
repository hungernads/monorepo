/**
 * HUNGERNADS - Arena Module
 *
 * Battle management, epoch processing, combat resolution, death mechanics.
 */

// Arena Manager (battle lifecycle)
export { ArenaManager, DEFAULT_BATTLE_CONFIG } from './arena';
export type {
  BattleStatus,
  BattleState,
  BattleConfig,
  BattleRecord,
  EliminationRecord,
} from './arena';

// Epoch processing
export { processEpoch } from './epoch';
export type { EpochResult } from './epoch';

// Combat resolution
export { resolveCombat, applyBleed } from './combat';
export type { CombatResult, BleedResult, DefendCostResult, CombatAgentState } from './combat';

// Death mechanics
export { checkDeaths, determineCause } from './death';
export type { DeathEvent, DeathCause, PredictionResult as DeathPredictionResult, GenerateFinalWords } from './death';

// Prediction resolution
export { resolvePredictions } from './prediction';
export type { PredictionResult, PredictionInput } from './prediction';

// Price feed
export { PriceFeed, ASSETS } from './price-feed';
export type { Asset, MarketData as PriceFeedMarketData } from './price-feed';
