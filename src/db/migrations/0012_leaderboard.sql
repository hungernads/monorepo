-- Migration 0012: Leaderboard wallet aggregation
-- Adds prize tracking columns and wallet indexing for leaderboard queries

-- Add prize tracking columns to battle_records
ALTER TABLE battle_records ADD COLUMN prize_won_mon TEXT DEFAULT '0';
ALTER TABLE battle_records ADD COLUMN prize_won_hnads TEXT DEFAULT '0';

-- Index for wallet-based leaderboard queries
CREATE INDEX idx_agents_wallet ON agents(wallet_address) WHERE wallet_address IS NOT NULL;
