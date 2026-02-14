-- Add distribute_prize_tx column for tracking MON prize distribution tx hash
ALTER TABLE battles ADD COLUMN distribute_prize_tx TEXT;
