-- Step 8: Manual user-owned pset drafts

CREATE TABLE IF NOT EXISTS user_pset_drafts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled problem set',
  source_pdf_label text,
  source_pdf_url text,
  notes text,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(problems) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_pset_drafts_user_updated_at
  ON user_pset_drafts(user_id, updated_at DESC);

DROP TRIGGER IF EXISTS user_pset_drafts_updated_at ON user_pset_drafts;
CREATE TRIGGER user_pset_drafts_updated_at
  BEFORE UPDATE ON user_pset_drafts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE user_pset_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_pset_drafts" ON user_pset_drafts;
CREATE POLICY "users_read_own_pset_drafts" ON user_pset_drafts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_pset_drafts" ON user_pset_drafts;
CREATE POLICY "users_insert_own_pset_drafts" ON user_pset_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_update_own_pset_drafts" ON user_pset_drafts;
CREATE POLICY "users_update_own_pset_drafts" ON user_pset_drafts
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_delete_own_pset_drafts" ON user_pset_drafts;
CREATE POLICY "users_delete_own_pset_drafts" ON user_pset_drafts
  FOR DELETE USING (auth.uid() = user_id);
