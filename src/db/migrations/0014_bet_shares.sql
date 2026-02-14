-- Migration 0014: Bet share tracking for prediction market
-- Adds price_at_bet and shares columns to bets table to support
-- dynamic pricing model where share prices fluctuate based on demand

ALTER TABLE bets ADD COLUMN price_at_bet REAL;
ALTER TABLE bets ADD COLUMN shares REAL;
