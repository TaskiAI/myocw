-- Step 10: Add content_text column to resources for inline text content
-- Used for text files (.txt, .py, .tex, .md) extracted from ZIP-based problem sets

ALTER TABLE resources ADD COLUMN IF NOT EXISTS content_text text;
