/**
 * HUNGERNADS - Battle Status Type
 *
 * Single source of truth for the battle lifecycle status.
 * Shared between ArenaManager (engine) and ArenaDO (durable object).
 *
 * Lifecycle: PENDING -> LOBBY -> COUNTDOWN -> BETTING_OPEN -> ACTIVE -> COMPLETED -> SETTLED
 *            At any point before ACTIVE: -> CANCELLED
 */

export type BattleStatus =
  | 'PENDING'
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'BETTING_OPEN'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'SETTLED';
