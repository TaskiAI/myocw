-- Step 3: Problems and user problem attempts

CREATE TABLE problems (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id bigint NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  course_id bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  problem_label text NOT NULL,
  question_text text NOT NULL,
  solution_text text,
  ordering int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_problems_resource ON problems(resource_id);
CREATE INDEX idx_problems_course ON problems(course_id);

CREATE TABLE user_problem_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  answer_text text NOT NULL,
  self_grade text NOT NULL CHECK (self_grade IN ('correct', 'partially_correct', 'incorrect', 'unsure')),
  attempted_at timestamptz DEFAULT now(),
  UNIQUE(user_id, problem_id)
);

CREATE INDEX idx_user_problem_attempts_user ON user_problem_attempts(user_id);
CREATE INDEX idx_user_problem_attempts_problem ON user_problem_attempts(problem_id);

-- RLS policies
ALTER TABLE problems ENABLE ROW LEVEL SECURITY;

-- Problems are readable by everyone (public course content)
CREATE POLICY "problems_readable_by_all" ON problems
  FOR SELECT USING (true);

ALTER TABLE user_problem_attempts ENABLE ROW LEVEL SECURITY;

-- Users can read their own attempts
CREATE POLICY "users_read_own_attempts" ON user_problem_attempts
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own attempts
CREATE POLICY "users_write_own_attempts" ON user_problem_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own attempts
CREATE POLICY "users_update_own_attempts" ON user_problem_attempts
  FOR UPDATE USING (auth.uid() = user_id);
