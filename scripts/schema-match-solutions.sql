-- Add explanation_text column to problems table
ALTER TABLE problems ADD COLUMN IF NOT EXISTS explanation_text text;
