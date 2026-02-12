-- Battle events persistence for replay and late-joining spectators
CREATE TABLE battle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (battle_id) REFERENCES battles(id)
);
CREATE INDEX idx_battle_events_battle ON battle_events(battle_id, epoch);
