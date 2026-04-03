-- Cache translated course content (problems, resources) per language.
-- Translations are written server-side (service role) and readable by all.

CREATE TABLE content_translations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL CHECK (source_table IN ('problems', 'resources')),
  source_id bigint NOT NULL,
  field_name text NOT NULL CHECK (field_name IN ('question_text', 'solution_text', 'explanation_text', 'content_text', 'title')),
  language text NOT NULL,
  translated_text text NOT NULL,
  source_hash text NOT NULL,  -- md5 of original text, for cache invalidation
  created_at timestamptz DEFAULT now(),
  UNIQUE(source_table, source_id, field_name, language)
);

CREATE INDEX idx_translations_lookup
  ON content_translations(source_table, source_id, language);

ALTER TABLE content_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "translations_readable_by_all"
  ON content_translations FOR SELECT USING (true);
