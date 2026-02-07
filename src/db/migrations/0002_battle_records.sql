-- HUNGERNADS - Battle Records
-- Per-agent battle outcome tracking for memory & profile systems.

CREATE TABLE IF NOT EXISTS battle_records (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  battle_id TEXT NOT NULL REFERENCES battles(id),
  result TEXT NOT NULL,          -- 'win' | 'loss' | 'rekt'
  epochs_survived INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  killer_id TEXT,                -- NULL if agent won or timed out
  killer_class TEXT,             -- Denormalised for fast matchup queries
  agent_class TEXT NOT NULL,     -- Denormalised for fast matchup queries
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_battle_records_agent ON battle_records(agent_id);
CREATE INDEX idx_battle_records_battle ON battle_records(battle_id);
CREATE INDEX idx_battle_records_result ON battle_records(agent_id, result);
