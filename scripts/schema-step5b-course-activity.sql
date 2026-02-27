CREATE TABLE user_course_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  last_interacted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, course_id)
);

CREATE INDEX idx_user_course_activity_user ON user_course_activity(user_id);
CREATE INDEX idx_user_course_activity_course ON user_course_activity(course_id);
CREATE INDEX idx_user_course_activity_last ON user_course_activity(last_interacted_at);

ALTER TABLE user_course_activity ENABLE ROW LEVEL SECURITY;

-- Users can read their own course activity
CREATE POLICY "users_read_own_course_activity" ON user_course_activity
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own course activity
CREATE POLICY "users_write_own_course_activity" ON user_course_activity
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own course activity
CREATE POLICY "users_update_own_course_activity" ON user_course_activity
  FOR UPDATE USING (auth.uid() = user_id);
