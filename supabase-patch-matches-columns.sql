-- Run once in Supabase → SQL Editor if you see errors like:
-- "Could not find the 'game_duration_minutes' column of 'matches' in the schema cache"

ALTER TABLE matches ADD COLUMN IF NOT EXISTS time_per_question INT DEFAULT 30;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS question_ends_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS paused_remaining_sec DOUBLE PRECISION;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_started_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS game_duration_minutes INT DEFAULT 15;
