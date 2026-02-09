-- HUNGERNADS Seasons & Schadenfreude Pool
-- Every 50 battles = 1 season.
-- 3% of each battle pool accumulates in the global Schadenfreude pool.
-- At season end, top 10 bettors by profit receive proportional payout.
-- Unclaimed after 7 days -> burned.

-- ─── Seasons ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  season_number INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',  -- active | ended | burned
  started_at TEXT NOT NULL,
  ended_at TEXT,
  battle_count INTEGER NOT NULL DEFAULT 0,
  schadenfreude_pool REAL NOT NULL DEFAULT 0,
  total_distributed REAL NOT NULL DEFAULT 0,
  total_burned REAL NOT NULL DEFAULT 0,
  claim_deadline TEXT  -- 7 days after ended_at; unclaimed after this -> burned
);

-- ─── Season Leaderboard ─────────────────────────────────────────
-- Snapshot of top bettors at season end with their payout allocation.
CREATE TABLE IF NOT EXISTS season_leaderboard (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  rank INTEGER NOT NULL,
  user_address TEXT NOT NULL,
  profit REAL NOT NULL,
  total_wagered REAL NOT NULL,
  total_payout REAL NOT NULL,
  win_count INTEGER NOT NULL DEFAULT 0,
  bet_count INTEGER NOT NULL DEFAULT 0,
  schadenfreude_payout REAL NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,  -- 0 = unclaimed, 1 = claimed
  claimed_at TEXT
);

-- ─── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status);
CREATE INDEX IF NOT EXISTS idx_seasons_number ON seasons(season_number);
CREATE INDEX IF NOT EXISTS idx_season_leaderboard_season ON season_leaderboard(season_id);
CREATE INDEX IF NOT EXISTS idx_season_leaderboard_user ON season_leaderboard(user_address);
