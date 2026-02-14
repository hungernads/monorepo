-- Migration 0013: Sponsorship tx_hash for on-chain burn tracking
-- Adds tx_hash column to sponsorships table to store the transaction hash
-- from the ERC20 token burn (transfer to 0xdEaD)

ALTER TABLE sponsorships ADD COLUMN tx_hash TEXT DEFAULT NULL;

-- Index for efficient lookup by tx hash
CREATE INDEX IF NOT EXISTS idx_sponsorships_tx_hash ON sponsorships(tx_hash);
