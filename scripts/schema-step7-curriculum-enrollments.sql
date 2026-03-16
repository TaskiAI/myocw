CREATE TABLE user_curriculum_enrollments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id text NOT NULL,
  enrolled_at timestamptz DEFAULT now(),
  UNIQUE(user_id, curriculum_id)
);

CREATE INDEX idx_user_curriculum_enrollments_user
  ON user_curriculum_enrollments(user_id);

CREATE INDEX idx_user_curriculum_enrollments_curriculum
  ON user_curriculum_enrollments(curriculum_id);

ALTER TABLE user_curriculum_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_curriculum_enrollments"
  ON user_curriculum_enrollments
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_write_own_curriculum_enrollments"
  ON user_curriculum_enrollments
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_delete_own_curriculum_enrollments"
  ON user_curriculum_enrollments
  FOR DELETE
  USING (auth.uid() = user_id);
