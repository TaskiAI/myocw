-- Step 6: Shared sidebar ordering (global per course, not per user)
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS course_sidebar_order (
  course_id bigint PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  section_ids bigint[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_sidebar_order_updated_at
  ON course_sidebar_order(updated_at DESC);

CREATE OR REPLACE FUNCTION public.handle_course_sidebar_order_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

DROP TRIGGER IF EXISTS course_sidebar_order_updated_at ON course_sidebar_order;
CREATE TRIGGER course_sidebar_order_updated_at
  BEFORE UPDATE ON course_sidebar_order
  FOR EACH ROW EXECUTE FUNCTION public.handle_course_sidebar_order_updated_at();

ALTER TABLE course_sidebar_order ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "course_sidebar_order_public_read" ON course_sidebar_order;
CREATE POLICY "course_sidebar_order_public_read" ON course_sidebar_order
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "course_sidebar_order_authenticated_insert" ON course_sidebar_order;
CREATE POLICY "course_sidebar_order_authenticated_insert" ON course_sidebar_order
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "course_sidebar_order_authenticated_update" ON course_sidebar_order;
CREATE POLICY "course_sidebar_order_authenticated_update" ON course_sidebar_order
  FOR UPDATE USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
