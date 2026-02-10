-- Migration 0009: Agent tx_hash for fee tracking
--
-- Adds tx_hash column to agents table to store the transaction hash
-- of the participation fee payment (off-chain tracking, no on-chain verification).

ALTER TABLE agents ADD COLUMN tx_hash TEXT;
