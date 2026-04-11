-- Run this SQL in your Supabase SQL Editor to create the required tables

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  players TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_a JSONB,
  team_b JSONB,
  questions JSONB DEFAULT '[]',
  current_question INT DEFAULT 0,
  status TEXT DEFAULT 'pending',
  elapsed_time FLOAT DEFAULT 0,
  penalties FLOAT DEFAULT 0,
  match_number INT DEFAULT 0,
  time_per_question INT DEFAULT 30,
  game_duration_minutes INT DEFAULT 15,
  question_ends_at TIMESTAMPTZ,
  paused_remaining_sec DOUBLE PRECISION,
  match_started_at TIMESTAMPTZ,
  team_skip_penalty_sec JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Existing databases created before countdown: run these once (safe no-ops if columns exist):
ALTER TABLE matches ADD COLUMN IF NOT EXISTS time_per_question INT DEFAULT 30;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS question_ends_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS paused_remaining_sec DOUBLE PRECISION;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_started_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS game_duration_minutes INT DEFAULT 15;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_skip_penalty_sec JSONB DEFAULT '{}';

-- Settings table (for questions storage)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Realtime (safe to re-run: skip if table is already in the publication)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE teams;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE settings;
  END IF;
END $$;

-- Row Level Security (allow all for now - tighten for production)
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on teams" ON teams;
CREATE POLICY "Allow all on teams" ON teams FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on matches" ON matches;
CREATE POLICY "Allow all on matches" ON matches FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on settings" ON settings;
CREATE POLICY "Allow all on settings" ON settings FOR ALL USING (true) WITH CHECK (true);

-- Per-team scoreboard for each match (player MCQ / future use)
CREATE TABLE IF NOT EXISTS match_team_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  correct_count INT NOT NULL DEFAULT 0,
  wrong_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(match_id, team_id)
);

ALTER TABLE match_team_results ADD COLUMN IF NOT EXISTS skipped_count INT NOT NULL DEFAULT 0;

ALTER TABLE match_team_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on match_team_results" ON match_team_results;
CREATE POLICY "Allow all on match_team_results" ON match_team_results FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_team_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_team_results;
  END IF;
END $$;
