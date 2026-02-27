CREATE TABLE user_video_progress (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_id bigint NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  completed boolean DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, resource_id)
);

CREATE INDEX idx_user_video_progress_user ON user_video_progress(user_id);
CREATE INDEX idx_user_video_progress_resource ON user_video_progress(resource_id);

ALTER TABLE user_video_progress ENABLE ROW LEVEL SECURITY;

-- Users can read their own progress
CREATE POLICY "users_read_own_progress" ON user_video_progress
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own progress
CREATE POLICY "users_write_own_progress" ON user_video_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own progress
CREATE POLICY "users_update_own_progress" ON user_video_progress
  FOR UPDATE USING (auth.uid() = user_id);
