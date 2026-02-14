-- Migration 0014: Prize transaction tracking
-- Stores on-chain prize distribution transaction details for each battle.
-- Tracks burn, treasury, MON withdrawal, and per-agent bonus transactions.

CREATE TABLE IF NOT EXISTS prize_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id TEXT NOT NULL,
  type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  agent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_prize_tx_battle ON prize_transactions(battle_id);
