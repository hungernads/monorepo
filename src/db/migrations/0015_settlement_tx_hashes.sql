-- Settlement TX hash tracking
-- Persists on-chain transaction hashes from battle completion (recordResult, settleBets, prize distribution).
ALTER TABLE battles ADD COLUMN record_result_tx TEXT;
ALTER TABLE battles ADD COLUMN settle_bets_tx TEXT;
ALTER TABLE battles ADD COLUMN prize_txs TEXT; -- JSON array of PayoutTx objects
