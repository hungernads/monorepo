-- Migration 0011: Lobby Tier System with Dual-Token Economy
-- Adds tier classification and $HNADS fee tracking to battles

-- Add tier column (FREE, BRONZE, SILVER, GOLD)
ALTER TABLE battles ADD COLUMN tier TEXT NOT NULL DEFAULT 'FREE';

-- Add $HNADS fee tracking columns
ALTER TABLE battles ADD COLUMN hnads_fee_amount TEXT NOT NULL DEFAULT '0';
ALTER TABLE battles ADD COLUMN hnads_burned TEXT NOT NULL DEFAULT '0';
ALTER TABLE battles ADD COLUMN hnads_treasury TEXT NOT NULL DEFAULT '0';

-- Add max_epochs column for tier-specific battle duration
ALTER TABLE battles ADD COLUMN max_epochs INTEGER NOT NULL DEFAULT 50;

-- Index for tier filtering
CREATE INDEX idx_battles_tier ON battles(tier);

-- Index for fee queries
CREATE INDEX idx_battles_hnads_burned ON battles(hnads_burned);
