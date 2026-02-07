-- HUNGERNADS Initial Schema
-- D1 SQLite Database
-- All primary keys are TEXT (UUID) for portability and deterministic ID generation.

-- ─── Agents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  class TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ─── Battles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS battles (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  ended_at TEXT,
  winner_id TEXT,
  epoch_count INTEGER DEFAULT 0
);

-- ─── Epochs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS epochs (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL REFERENCES battles(id),
  epoch_num INTEGER NOT NULL,
  market_data_json TEXT,
  timestamp TEXT NOT NULL
);

-- ─── Epoch Actions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS epoch_actions (
  id TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL REFERENCES epochs(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  prediction_json TEXT,
  attack_json TEXT,
  defend INTEGER DEFAULT 0,
  hp_before REAL,
  hp_after REAL,
  reasoning TEXT
);

-- ─── Lessons ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  battle_id TEXT NOT NULL REFERENCES battles(id),
  context TEXT,
  outcome TEXT,
  learning TEXT,
  applied TEXT,
  created_at TEXT NOT NULL
);

-- ─── Bets ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL REFERENCES battles(id),
  user_address TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  amount REAL NOT NULL,
  placed_at TEXT NOT NULL,
  settled INTEGER DEFAULT 0,
  payout REAL DEFAULT 0
);

-- ─── Sponsorships ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsorships (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL REFERENCES battles(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  sponsor_address TEXT NOT NULL,
  amount REAL NOT NULL,
  message TEXT,
  accepted INTEGER DEFAULT 0
);

-- ─── Indexes ─────────────────────────────────────────────────────
CREATE INDEX idx_epochs_battle ON epochs(battle_id);
CREATE INDEX idx_epoch_actions_epoch ON epoch_actions(epoch_id);
CREATE INDEX idx_epoch_actions_agent ON epoch_actions(agent_id);
CREATE INDEX idx_lessons_agent ON lessons(agent_id);
CREATE INDEX idx_lessons_battle ON lessons(battle_id);
CREATE INDEX idx_bets_battle ON bets(battle_id);
CREATE INDEX idx_bets_user ON bets(user_address);
CREATE INDEX idx_bets_agent ON bets(agent_id);
CREATE INDEX idx_sponsorships_battle ON sponsorships(battle_id);
CREATE INDEX idx_sponsorships_agent ON sponsorships(agent_id);
