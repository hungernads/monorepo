/**
 * HUNGERNADS - Replay Data Types
 *
 * Serializable data structures for battle replay rendering.
 * These types capture the essential information from EpochResult[]
 * needed to reconstruct a visual battle replay in Phaser 3.
 *
 * The data is embedded into an HTML template and rendered by
 * Puppeteer for MP4 export.
 */

// ---------------------------------------------------------------------------
// Agent Snapshot - Per-epoch agent state
// ---------------------------------------------------------------------------

export interface ReplayAgentSnapshot {
  id: string;
  name: string;
  class: string;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  /** Axial hex position (q, r). */
  position: { q: number; r: number } | null;
}

// ---------------------------------------------------------------------------
// Events - Key things that happened in an epoch
// ---------------------------------------------------------------------------

export type ReplayEventType =
  | 'prediction_correct'
  | 'prediction_wrong'
  | 'attack'
  | 'attack_blocked'
  | 'defend'
  | 'death'
  | 'skill_activation'
  | 'alliance_formed'
  | 'alliance_broken'
  | 'betrayal'
  | 'move';

export interface ReplayEvent {
  type: ReplayEventType;
  agentId: string;
  targetId?: string;
  /** Human-readable description for the event ticker. */
  text: string;
  /** HP change associated with this event (if any). */
  hpDelta?: number;
}

// ---------------------------------------------------------------------------
// Epoch Frame - All data for rendering one epoch
// ---------------------------------------------------------------------------

export interface ReplayEpochFrame {
  epochNumber: number;
  /** Market prices snapshot. */
  market: {
    ETH: number;
    BTC: number;
    SOL: number;
    MON: number;
  };
  /** Agent states at the END of this epoch (post-resolution). */
  agents: ReplayAgentSnapshot[];
  /** Notable events in this epoch (sorted by drama). */
  events: ReplayEvent[];
}

// ---------------------------------------------------------------------------
// Full Replay Data
// ---------------------------------------------------------------------------

export interface ReplayData {
  battleId: string;
  /** Initial agent roster (before epoch 1). */
  roster: ReplayAgentSnapshot[];
  /** Per-epoch frames. */
  epochs: ReplayEpochFrame[];
  /** Winner info (null if mutual annihilation). */
  winner: {
    id: string;
    name: string;
    class: string;
  } | null;
  /** Battle duration metadata. */
  totalEpochs: number;
  /** ISO timestamp of battle start. */
  startedAt: string;
}
