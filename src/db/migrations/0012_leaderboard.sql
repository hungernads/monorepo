-- Migration 0012: Leaderboard wallet aggregation
-- Adds prize tracking columns and wallet indexing for leaderboard queries

-- Add prize tracking columns to battle_records
ALTER TABLE battle_records ADD COLUMN prize_won_mon TEXT DEFAULT '0';
ALTER TABLE battle_records ADD COLUMN prize_won_hnads TEXT DEFAULT '0';

-- Index for wallet-based leaderboard queries (IF NOT EXISTS — 0008 may have created a simpler version)
CREATE INDEX IF NOT EXISTS idx_agents_wallet_lb ON agents(wallet_address) WHERE wallet_address IS NOT NULL;
