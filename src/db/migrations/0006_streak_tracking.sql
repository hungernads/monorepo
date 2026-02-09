-- HUNGERNADS - Streak Tracking Schema
-- Tracks consecutive correct bets per wallet for streak bonus rewards.
-- 3-win streak = 10% bonus from streak pool, 5-win streak = 25% bonus.

-- ─── Streak Tracking ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS streak_tracking (
  wallet_address TEXT NOT NULL PRIMARY KEY,
  current_streak INTEGER NOT NULL DEFAULT 0,
  max_streak INTEGER NOT NULL DEFAULT 0,
  last_bet_battle_id TEXT,
  total_streak_bonus REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- ─── Streak Pool (singleton) ────────────────────────────────────
-- Accumulates 2% of each battle's pool. Paid out as streak bonuses.
CREATE TABLE IF NOT EXISTS streak_pool (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  amount REAL NOT NULL DEFAULT 0
);

-- ─── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_streak_tracking_streak ON streak_tracking(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_streak_tracking_max ON streak_tracking(max_streak DESC);
