/**
 * HUNGERNADS - Agent Module
 *
 * Agent classes: Warrior, Trader, Survivor, Parasite, Gambler
 * Each agent has a personality, strategy, and learning capability.
 */

// ---------------------------------------------------------------------------
// Zod schemas + inferred types (single source of truth)
// ---------------------------------------------------------------------------
export {
  AssetSchema,
  DirectionSchema,
  AgentClassSchema,
  PredictionSchema,
  AttackSchema,
  EpochActionsSchema,
  LessonSchema,
  MatchupRecordSchema,
  AgentProfileSchema,
  MarketDataSchema,
  ArenaAgentStateSchema,
  ArenaStateSchema,
} from './schemas';

export type {
  Asset,
  Direction,
  AgentClass,
  Prediction,
  Attack,
  EpochActions,
  Lesson,
  MatchupRecord,
  AgentProfile,
  MarketData,
  ArenaAgentState,
  ArenaState,
} from './schemas';

// Backwards-compatible aliases for downstream consumers
import type { ArenaAgentState, ArenaState as ArenaStateType } from './schemas';
/** @deprecated Use ArenaAgentState instead */
export type AgentState = ArenaAgentState;
/** @deprecated Use ArenaState instead */
export type ArenaContext = ArenaStateType;

// ---------------------------------------------------------------------------
// Base agent + default actions
// ---------------------------------------------------------------------------
export { BaseAgent, getDefaultActions } from './base-agent';

// ---------------------------------------------------------------------------
// Agent class constants
// ---------------------------------------------------------------------------
export const AGENT_CLASSES: readonly ['WARRIOR', 'TRADER', 'SURVIVOR', 'PARASITE', 'GAMBLER'] = [
  'WARRIOR',
  'TRADER',
  'SURVIVOR',
  'PARASITE',
  'GAMBLER',
] as const;

// ---------------------------------------------------------------------------
// Personalities
// ---------------------------------------------------------------------------
export { PERSONALITIES, buildSystemPrompt } from './personalities';
export type { AgentPersonality, PersonalityKey } from './personalities';

// ---------------------------------------------------------------------------
// Agent subclasses
// ---------------------------------------------------------------------------
export { WarriorAgent } from './warrior';
export { TraderAgent } from './trader';
export { SurvivorAgent } from './survivor';
export { ParasiteAgent } from './parasite';
export { GamblerAgent } from './gambler';
