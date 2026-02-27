-- Step 2: Course content tables
-- Run this in the Supabase SQL Editor

-- Add content download tracking to courses
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS content_downloaded boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS content_downloaded_at timestamptz;

-- Course sections (syllabus, lecture_videos, assignments, etc.)
CREATE TABLE IF NOT EXISTS course_sections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL,
  section_type text NOT NULL DEFAULT 'other',
  ordering int NOT NULL DEFAULT 0,
  parent_id bigint REFERENCES course_sections(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Resources (videos, PDFs, problem sets, etc.)
CREATE TABLE IF NOT EXISTS resources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_id bigint REFERENCES course_sections(id) ON DELETE SET NULL,
  title text NOT NULL,
  resource_type text NOT NULL DEFAULT 'other',
  pdf_path text,
  video_url text,
  youtube_id text,
  archive_url text,
  ordering int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_course_sections_course_id ON course_sections(course_id);
CREATE INDEX IF NOT EXISTS idx_resources_course_id ON resources(course_id);
CREATE INDEX IF NOT EXISTS idx_resources_section_id ON resources(section_id);

-- RLS: publicly readable
ALTER TABLE course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "course_sections_public_read" ON course_sections
  FOR SELECT USING (true);

CREATE POLICY "resources_public_read" ON resources
  FOR SELECT USING (true);
