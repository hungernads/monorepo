/**
 * HUNGERNADS - Zod Schemas
 *
 * Runtime validation schemas for all agent-related data structures.
 * These enforce correctness at the boundary between LLM outputs and game logic.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums / Primitives
// ---------------------------------------------------------------------------

export const AssetSchema = z.enum(['ETH', 'BTC', 'SOL', 'MON']);
export type Asset = z.infer<typeof AssetSchema>;

export const DirectionSchema = z.enum(['UP', 'DOWN']);
export type Direction = z.infer<typeof DirectionSchema>;

export const AgentClassSchema = z.enum([
  'WARRIOR',
  'TRADER',
  'SURVIVOR',
  'PARASITE',
  'GAMBLER',
]);
export type AgentClass = z.infer<typeof AgentClassSchema>;

// ---------------------------------------------------------------------------
// EpochActions - What an agent does each epoch
// ---------------------------------------------------------------------------

export const PredictionSchema = z.object({
  asset: AssetSchema,
  direction: DirectionSchema,
  stake: z.number().min(5).max(50),
});
export type Prediction = z.infer<typeof PredictionSchema>;

export const AttackSchema = z.object({
  target: z.string().min(1),
  stake: z.number().positive(),
});
export type Attack = z.infer<typeof AttackSchema>;

export const EpochActionsSchema = z.object({
  prediction: PredictionSchema,
  attack: AttackSchema.optional(),
  defend: z.boolean().optional(),
  reasoning: z.string(),
});
export type EpochActions = z.infer<typeof EpochActionsSchema>;

// ---------------------------------------------------------------------------
// Lesson - What an agent learned from an outcome
// ---------------------------------------------------------------------------

export const LessonSchema = z.object({
  battleId: z.string(),
  epoch: z.number().int().nonnegative(),
  context: z.string(),
  outcome: z.string(),
  learning: z.string(),
  applied: z.string(),
});
export type Lesson = z.infer<typeof LessonSchema>;

// ---------------------------------------------------------------------------
// AgentProfile - Public-facing stats, shown to bettors
// ---------------------------------------------------------------------------

export const MatchupRecordSchema = z.object({
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});
export type MatchupRecord = z.infer<typeof MatchupRecordSchema>;

export const AgentProfileSchema = z.object({
  agentId: z.string(),
  agentClass: AgentClassSchema,
  totalBattles: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  kills: z.number().int().nonnegative(),
  matchups: z.record(AgentClassSchema, MatchupRecordSchema),
  deathCauses: z.record(z.string(), z.number().int().nonnegative()),
  avgSurvival: z.number().nonnegative(),
  winRate: z.number().min(0).max(1),
  streak: z.number().int(), // positive = win streak, negative = loss streak
  recentLessons: z.array(LessonSchema),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

// ---------------------------------------------------------------------------
// MarketData - Price feeds passed to agents each epoch
// ---------------------------------------------------------------------------

export const MarketDataSchema = z.object({
  prices: z.record(AssetSchema, z.number().nonnegative()),
  changes: z.record(AssetSchema, z.number()), // % change, can be negative
  timestamp: z.number().int().positive(),
});
export type MarketData = z.infer<typeof MarketDataSchema>;

// ---------------------------------------------------------------------------
// ArenaState - The arena context visible to each agent
// ---------------------------------------------------------------------------

export const ArenaAgentStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  class: AgentClassSchema,
  hp: z.number().nonnegative(),
  maxHp: z.number().positive(),
  isAlive: z.boolean(),
  kills: z.number().int().nonnegative(),
  epochsSurvived: z.number().int().nonnegative(),
});
export type ArenaAgentState = z.infer<typeof ArenaAgentStateSchema>;

export const ArenaStateSchema = z.object({
  battleId: z.string(),
  epoch: z.number().int().nonnegative(),
  agents: z.array(ArenaAgentStateSchema),
  marketData: MarketDataSchema,
});
export type ArenaState = z.infer<typeof ArenaStateSchema>;
