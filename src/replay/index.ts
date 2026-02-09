/**
 * HUNGERNADS - Replay Module
 *
 * Barrel export for the battle replay system.
 *
 * Usage flow:
 *   1. Run a battle (ArenaManager + processEpoch loop)
 *   2. extractReplayData() to serialize battle events
 *   3. generateReplayHTML() to create a Phaser 3 page
 *   4. scripts/generate-replay.ts uses Puppeteer + FFmpeg to produce MP4
 */

export { extractReplayData } from './extract';
export { generateReplayHTML } from './html-template';
export type {
  ReplayData,
  ReplayEpochFrame,
  ReplayAgentSnapshot,
  ReplayEvent,
  ReplayEventType,
} from './types';
