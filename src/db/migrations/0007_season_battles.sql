-- HUNGERNADS Season-Battle Linkage & Agent Season Leaderboard
-- Links battles to their season for season-scoped leaderboards.
-- Adds agent performance tracking per season.

-- ─── Battle -> Season FK ──────────────────────────────────────────
ALTER TABLE battles ADD COLUMN season_id TEXT REFERENCES seasons(id);

-- ─── Agent Season Leaderboard ─────────────────────────────────────
-- Snapshot of agent performance at season end.
CREATE TABLE IF NOT EXISTS season_agent_leaderboard (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  rank INTEGER NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  agent_class TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  total_battles INTEGER NOT NULL DEFAULT 0,
  avg_epochs_survived REAL NOT NULL DEFAULT 0,
  win_rate REAL NOT NULL DEFAULT 0
);

-- ─── Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_battles_season ON battles(season_id);
CREATE INDEX IF NOT EXISTS idx_season_agent_lb_season ON season_agent_leaderboard(season_id);
CREATE INDEX IF NOT EXISTS idx_season_agent_lb_agent ON season_agent_leaderboard(agent_id);
