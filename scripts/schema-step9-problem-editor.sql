DROP POLICY IF EXISTS "dev_editor_inserts_problems" ON problems;
DROP POLICY IF EXISTS "dev_editor_updates_problems" ON problems;
DROP POLICY IF EXISTS "dev_editor_deletes_problems" ON problems;
DROP POLICY IF EXISTS "dev_editor_updates_course_sections" ON course_sections;
DROP POLICY IF EXISTS "dev_editor_updates_resources" ON resources;

CREATE POLICY "dev_editor_inserts_problems" ON problems
  FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu');

CREATE POLICY "dev_editor_updates_problems" ON problems
  FOR UPDATE
  USING ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu')
  WITH CHECK ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu');

CREATE POLICY "dev_editor_deletes_problems" ON problems
  FOR DELETE
  USING ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu');

CREATE POLICY "dev_editor_updates_course_sections" ON course_sections
  FOR UPDATE
  USING ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu')
  WITH CHECK ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu');

CREATE POLICY "dev_editor_updates_resources" ON resources
  FOR UPDATE
  USING ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu')
  WITH CHECK ((auth.jwt() ->> 'email') = 'ardatasci@nyu.edu');
