-- Add offline_bundle_url column to courses table
ALTER TABLE courses ADD COLUMN IF NOT EXISTS offline_bundle_url text;
