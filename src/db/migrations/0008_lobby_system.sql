-- Migration 0008: Lobby System
--
-- Adds columns to support the lobby/join flow:
--   agents: wallet_address, image_url, battle_id (link agent to a battle lobby)
--   battles: max_players, fee_amount, countdown_ends_at, cancelled_at
--
-- D1/SQLite requires one ALTER TABLE ADD COLUMN per statement.

-- ─── Agents: wallet and image support ──────────────────────────
ALTER TABLE agents ADD COLUMN wallet_address TEXT;
ALTER TABLE agents ADD COLUMN image_url TEXT;
ALTER TABLE agents ADD COLUMN battle_id TEXT REFERENCES battles(id);

-- ─── Battles: lobby configuration fields ───────────────────────
ALTER TABLE battles ADD COLUMN max_players INTEGER DEFAULT 8;
ALTER TABLE battles ADD COLUMN fee_amount TEXT DEFAULT '0';
ALTER TABLE battles ADD COLUMN countdown_ends_at TEXT;
ALTER TABLE battles ADD COLUMN cancelled_at TEXT;

-- ─── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agents_battle ON agents(battle_id);
CREATE INDEX IF NOT EXISTS idx_agents_wallet ON agents(wallet_address);
CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status);
