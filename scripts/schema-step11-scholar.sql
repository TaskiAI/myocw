-- Step 11: Scholar course flag
-- Marks courses that use the Unit > Session hierarchy (OCW Scholar Track)

ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_scholar boolean NOT NULL DEFAULT false;
