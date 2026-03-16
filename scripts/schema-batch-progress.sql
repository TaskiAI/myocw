-- Batch processing tracking columns
-- Run this migration in Supabase SQL editor

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS problems_parsed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS problems_parsed_at timestamptz,
  ADD COLUMN IF NOT EXISTS download_error text,
  ADD COLUMN IF NOT EXISTS parse_error text;
