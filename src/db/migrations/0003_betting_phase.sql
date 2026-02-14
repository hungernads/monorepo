-- HUNGERNADS - Betting Phase Support
-- Adds a betting_phase column to battles for phase-gated bet acceptance.
-- Phases: OPEN (accepting bets), SETTLED (payouts done).
-- Note: LOCKED phase removed - betting stays open for entire battle.

ALTER TABLE battles ADD COLUMN betting_phase TEXT NOT NULL DEFAULT 'OPEN';
