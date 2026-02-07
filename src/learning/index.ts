/**
 * HUNGERNADS - Learning Module
 *
 * Agent memory system, lesson extraction, public profile generation.
 * Lessons are PUBLIC - nads can see what agents learned to inform betting.
 */

// Re-export canonical types from schemas (single source of truth)
export type { Lesson, AgentProfile, MatchupRecord } from '../agents/schemas';

// Memory
export { AgentMemory } from './memory';
export type { BattleRecord } from './memory';

// Lesson extraction
export {
  extractLessons,
  extractAllLessons,
  storeLesson,
  storeBattleLessons,
  getRecentLessons,
} from './lessons';
export type { BattleHistory, AgentInfo, LLMCall } from './lessons';

// Profile generation
export { AgentProfileBuilder, getAgentLeaderboard } from './profiles';
