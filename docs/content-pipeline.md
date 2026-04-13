# Content Pipeline Documentation

How MIT OCW course content is parsed, structured, and ingested into myOCW.

---

## Table of Contents

1. [PDF Parsing Pipeline](#1-pdf-parsing-pipeline)
2. [Solutions Matching](#2-solutions-matching)
3. [Scholar Track Course Construction](#3-scholar-track-course-construction)
4. [Batch Processing](#4-batch-processing)
5. [Translation Pipeline](#5-translation-pipeline)

---

## 1. PDF Parsing Pipeline

**Script:** `scripts/parse-interactive-problems.ts`

Converts problem set PDFs into structured, interactive problems using Gemini (gemini-3-flash-preview).

### Flow

```
Problem Set PDF (base64)
    ↓
[Optional] Solution document (Markdown or PDF)
    ↓
Gemini API
    ↓
Structured JSON: label, question_text, solution_text, explanation_text
    ↓
Interactive tags embedded in question_text
    ↓
Database: `problems` table
```

### Interactive Tags

Three tag types are embedded directly into `question_text` at the natural answer point:

| Tag | Use Case | Example |
|-----|----------|---------|
| `<FillInBlank answer="VALUE" />` | Numeric values, short text, single variables | `$x$ = <FillInBlank answer="42" />` |
| `<MultipleChoice options={["A","B","C"]} answer="B" />` | True/false, yes/no, discrete choices | `<MultipleChoice options={["Invertible","Singular"]} answer="Singular" />` |
| `<FreeResponse prompt="Instruction." answer="model answer" />` | Proofs, matrices, multi-step computations | `<FreeResponse prompt="Compute AB." answer="$\\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}$" />` |

**Tag selection rules:**
- "Find x", "compute" a single number → `FillInBlank`
- Explicit choices, true/false → `MultipleChoice`
- "Show", "prove", matrix/vector, "explain", multi-step → `FreeResponse`
- When unsure → always `FreeResponse`

### Resource Pairing

Before calling Gemini, the script pairs problem sets with their solutions:

1. Fetches all resources ordered by section + ordering
2. Checks if the next resource in the same section has `resource_type="solution"`
3. For exams: matches solution files ending in `s.pdf`
4. **Solution priority:** Markdown `content_text` > Solution PDF (base64) > No solution (Gemini infers)

### LaTeX Handling

Gemini outputs LaTeX with single backslashes (`\frac`, `\bmatrix`), which are invalid JSON escapes. A custom JSON repair function (lines 56-91) doubles invalid escapes while preserving valid ones (`\"`, `\\`, `\n`, `\t`, `\uXXXX`).

**LaTeX rules in output:**
- Inline math: `$...$`
- Display math: `$$...$$` on its own line with blank lines before/after
- Matrices: `\begin{bmatrix}...\end{bmatrix}` (never `\begin{array}`)
- `answer="..."` attributes must not contain literal double-quotes

### Database Output

Each parsed problem is inserted into the `problems` table:

```
resource_id  — FK to the source PDF resource
course_id    — FK to course
problem_label — "2.1", "3a", "Problem 4"
question_text — Markdown with embedded interactive tags
solution_text — Concise final answer (nullable)
explanation_text — Full worked solution (nullable)
ordering     — Position within the problem set
```

### Frontend Tag Rendering

`app/components/interactive-problems/parse-tags.ts` parses embedded tags at render time:

1. Regex extracts all `<FillInBlank|MultipleChoice|FreeResponse ... />` tags
2. Replaces each with a Unicode placeholder (`\uE002COMP{index}\uE003`)
3. Returns cleaned text + `ComponentSlot[]` array for React rendering

### CLI

```bash
npm run parse-problems <course-id-or-slug> [--session=N] [--dry-run] [--force]
```

- `--session=N` — Only parse resources in a specific section
- `--dry-run` — Preview without writing to DB
- `--force` — Overwrite existing problems

---

## 2. Solutions Matching

**Script:** `scripts/match-solutions.ts`

Post-processing step that enriches problems with solutions from standalone solution documents that weren't paired during initial parsing.

### Flow

```
Solution Markdown resource (already in DB)
    ↓
Gemini: split into individual solutions by problem label
    ↓
Normalize labels → match to existing problems
    ↓
Update problems.solution_text & problems.explanation_text
```

### Label Normalization

Both Gemini output labels and existing problem labels are normalized before matching:

```
"Problem 2.1" → "2.1"
"Q3a)"        → "3a"
"Exercise 4"  → "4"
```

Strips prefixes (`problem`, `exercise`, `question`, `q`, `p`) and trailing punctuation (`.`, `:`, `)`, whitespace).

### Matching Algorithm

1. Query course for `problem_set → solution` resource pairs
2. For each pair, get all existing problems from the problem set
3. Call Gemini to split the solution document into `{ label, solution_text, explanation_text }[]`
4. Normalize all labels on both sides
5. Match by normalized label via Map lookup
6. Update matched problems in the database
7. Skip problems that already have solutions (unless `--force`)

### Output Logging

```
MATCH: "2.1" — updated (sol: 45, expl: 234 chars)
SKIP:  "3a"  — already has solution
MISS:  "Problem 4" — no match in Gemini output
```

### CLI

```bash
npm run match-solutions <course-slug-or-id> [--dry-run] [--force]
```

---

## 3. Scholar Track Course Construction

**Script:** `scripts/download-scholar-course.ts`

Scholar Track courses use a **Unit > Session** hierarchy instead of the flat section list used by regular courses.

### Hierarchy Structure

```
Course (is_scholar = true)
├── Instructor Insights   (section_type: "instructor_insights")
├── Unit I                (section_type: "unit", parent_id: null)
│   ├── Session 1         (section_type: "lecture", parent_id: unit.id)
│   ├── Session 2         (section_type: "exam",   parent_id: unit.id)
│   └── ...
├── Unit II               (section_type: "unit", parent_id: null)
│   └── ...
└── ...
```

Key difference: `course_sections.parent_id` creates the hierarchy. Regular courses leave `parent_id` null for all sections.

### Ingestion Pipeline (4 stages)

#### Stage 0: Download & Extract ZIP

Downloads the course ZIP from MIT OCW, extracts to `/tmp/myocw-scholar-download`.

#### Stage 1: Parse Navigation Structure

Parses `index.html` from the extracted course:

1. Extracts all `<nav>` links, deduplicates by href
2. Determines nesting level by counting parent `<ul>`/`<ol>` elements
3. **Unit detection:** title starts with "Unit", "Part", or "Module" + items at minimal indent level
4. **Session detection:** children of units at deeper indent levels
5. **Skips:** syllabus, calendar, resource index, download pages
6. **Fallback:** if no units detected, creates single "Course Content" unit with all items as sessions

#### Stage 2: Upload PDFs

1. Reads `resources/*/data.json` to build a title map for semantic filenames
2. Collects all PDFs from `static_resources/`
3. Filters out transcript artifacts (3play PDFs, files with "transcript" in name)
4. Skips PDFs > 50MB
5. Renames using extracted titles (e.g., `lec02.pdf` → `Lecture Notes on Matrix Algebra.pdf`)
6. Uploads to Supabase storage: `courses/{slug}/{filename}`

#### Stage 3: Parse Session Pages & Extract Resources

For each session HTML page:

1. Finds resource links matching `/resources/([^/]+)`
2. Reads `data.json` per resource for metadata (title, file, youtube_key, learning_resource_types)
3. **Resource type classification:**
   - Has youtube_id/archive_url + recitation pattern → `"recitation"`
   - Has youtube_id/archive_url → `"video"`
   - PDF with solution/answers in title → `"solution"`
   - PDF with problem/assignment/homework/pset in title → `"problem_set"`
   - PDF with exam/midterm/final/quiz in title → `"exam"`
   - Other PDF → `"lecture_notes"`
4. **Session overview extraction:** paragraphs > 30 chars from page content, converted to Markdown, inserted as `"reading"` resource at ordering 0
5. **Unit overview extraction:** text + embedded YouTube videos from unit overview pages

**Session type inference:**
- Has exam resources or exam-related title → `"exam"`
- Has video resources → `"lecture"`
- Otherwise → `"other"`

#### Stage 4: Database Persistence

Insert order:
1. Instructor Insights section (ordering 0) with its videos/readings
2. For each unit:
   - Unit section (`section_type: "unit"`, `parent_id: null`)
   - Unit Overview reading resource (if text extracted)
   - For each session:
     - Session section (`parent_id: unit.id`)
     - All session resources
3. Mark course: `content_downloaded = true`, `is_scholar = true`

### Scholar vs. Regular Courses

| Aspect | Regular | Scholar |
|--------|---------|---------|
| Section structure | Flat (no parent_id) | Hierarchical (units → sessions) |
| Section types | lecture, exam, recitation, other | + "unit", "instructor_insights" |
| Sidebar | Flat numbered list, custom ordering via `course_sidebar_order` | Expandable unit cards grouping sessions |
| Player component | `CoursePlayer` | `ScholarSessionPlayer` |
| Content extraction | No overview text | Unit + session overviews as reading resources |
| Resume logic | First incomplete lecture | First session with incomplete completable resources |

### CLI

```bash
# Single course
pnpm tsx scripts/download-scholar-course.ts 18-06sc-linear-algebra-fall-2011

# Batch all Scholar courses from curricula
pnpm tsx scripts/download-scholar-course.ts --batch
```

---

## 4. Batch Processing

**Script:** `scripts/batch-process.ts`

Orchestrates downloading and parsing across all curricula track courses.

### Workflow

1. Loads course URLs from `CURRICULA_TRACKS` (defined in `lib/data/curricula.ts`)
2. Queries DB for matching courses where `content_downloaded = false` and `download_error` is null
3. Downloads each course via the appropriate script (regular or Scholar)
4. Updates `download_error` status on failure
5. Reports: X downloaded, Y skipped, Z errors

### Status Columns on `courses` Table

| Column | Purpose |
|--------|---------|
| `content_downloaded` | ZIP extracted and sections/resources created |
| `content_downloaded_at` | Timestamp of download |
| `download_error` | Error message if download failed (null = no error) |
| `problems_parsed` | Problems extracted via LLM |
| `problems_parsed_at` | Timestamp of parsing |
| `parse_error` | Error message if parsing failed |

### CLI

```bash
npm run batch-process                   # Full run
npm run batch-process --skip-download   # Report status only
npm run batch-process --limit=5         # Process only 5 courses
```

---

## Full Pipeline Example

Process a single course end-to-end:

```bash
# 1. Download course content (ZIP → sections + resources in DB, PDFs in Supabase storage)
npm run download-course 6-006-introduction-to-algorithms-spring-2020

# 2. Parse problem set PDFs into interactive problems
npm run parse-problems 6-006-introduction-to-algorithms-spring-2020

# 3. Match standalone solutions to parsed problems
npm run match-solutions 6-006-introduction-to-algorithms-spring-2020
```

For Scholar Track courses, replace step 1:

```bash
pnpm tsx scripts/download-scholar-course.ts 18-06sc-linear-algebra-fall-2011
```

---

## 5. Translation Pipeline

**Core:** `lib/translate.ts` | **API:** `app/api/courses/[id]/translate/route.ts` | **Languages:** `lib/languages.ts`

Gemini-based (gemini-3-flash-preview) translation system that translates course problems and resources into 15 languages, with database caching and placeholder preservation for LaTeX/interactive tags.

### Supported Languages

English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Arabic (RTL), Hindi, Russian, Turkish, Italian, Dutch, Polish.

Defined in `lib/languages.ts` with display name → ISO 639-1 code mapping.

### Placeholder Preservation

Before sending text to Gemini, `extractPlaceholders()` replaces interactive tags with placeholders:

| Content | Placeholder | Example |
|---------|-------------|---------|
| Interactive tags | `<<COMP_0>>` | `<FillInBlank answer="42" />` → `<<COMP_0>>` |

After translation, `restorePlaceholders()` swaps them back.

**LaTeX handling:** Math spans (`$...$`, `$$...$$`, `\[...\]`, `\(...\)`) are kept in the text and sent to Gemini. The prompt instructs the model to preserve all LaTeX notation but translate `\text{...}` content inside math expressions. This ensures terms like `$\text{velocity}$` get properly translated.

### Caching

**Table:** `content_translations`

| Column | Purpose |
|--------|---------|
| `source_table` | `problems` or `resources` |
| `source_id` | ID of the source row |
| `field_name` | `question_text`, `solution_text`, `explanation_text`, `content_text`, `title` |
| `language` | Target language (e.g., "Spanish") |
| `translated_text` | The translation |
| `source_hash` | MD5 of original text — cache invalidation when source changes |

Unique constraint on `(source_table, source_id, field_name, language)`. If the source text changes (hash mismatch), the translation is re-generated on next request.

### Translation Trigger Flow

**Two entry points:**

1. **API route** (user-facing) — `POST /api/courses/[id]/translate` with `{ "language": "Spanish" }`
   - Returns streaming NDJSON with progress updates: `{ status, done, total }`
   - Triggered by DownloadButton when user requests a translated download

2. **CLI script** — `npx tsx scripts/translate-course.ts <course-id> --lang <Language>`
   - Outputs progress to stdout: `[50%] 21/42 — problems:123:question_text`

Both call `translateCourseContent()` which:
1. Fetches all problems (question_text, solution_text, explanation_text) and resources (title, content_text) for the course
2. For each translatable field, calls `translateWithCache()`:
   - Check cache → if hash matches, return cached → else call Gemini → upsert to cache
3. 1.5s delay between API calls for rate limiting
4. Reports progress via callback

### Applying Translations at Render Time

In `app/courses/[id]/page.tsx` (server component):

```
1. Fetch course content (sections, resources, problems)
2. getUserLanguageServer() → user's language from user_profiles
3. applyTranslations(courseId, language, problems, resources)
   - Skip if English or "Other"
   - Fetch all translations from content_translations
   - Build lookup map: "{table}:{id}:{field}" → translated_text
   - Substitute into problem/resource objects
   - Fall back to English if no translation found
4. Pass translated content to CoursePageContent
```

### Translation Coverage Check

`getTranslationCoverage(courseId, language)` returns `{ translated, total }` — counts translatable fields vs. actual translations in the cache. Used to show completion status.

### Offline Bundle with Translation

`GET /api/courses/[id]/download?lang=Spanish`:
1. Fetches translations from cache
2. Substitutes into problems and resources
3. Sets `content-language` header and text direction (RTL for Arabic)
4. Renders translated HTML pages with KaTeX CSS
5. Returns ZIP bundle

The DownloadButton shows a dropdown for non-English users:
- "Download in English" — direct download
- "Download in {Language}" — triggers translation via API, streams progress, then downloads

### User Language Preference

**Setting:** `<LanguagePopup />` auto-opens on first login if no language set. Selection saved to `user_profiles.language` via `setUserLanguage()`. Dispatches `language-changed` custom event.

**Reading:** `getUserLanguage()` (client) / `getUserLanguageServer()` (server) queries `user_profiles`.

**Account page:** `<LanguageButton />` shows current language, opens popup to change.

### Environment Variables

- `GEMINI_API_KEY` — Gemini API key for translation calls
- `SUPABASE_SECRET_KEY` — Service role key (for writing translations via CLI script)
