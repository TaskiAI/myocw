# myOCW — Build Plan

A personalized learning platform that natively hosts MIT OpenCourseWare content. Users browse courses, watch lecture videos (embedded YouTube), work through interactive problem sets, and track their progress — all without leaving the app.

OCW content is licensed under CC BY-NC-SA 4.0, so we can use it freely with attribution.

**Current focus:** Courses with video lectures only. Problem set parsing and other content types come later.

---

## Progress

- [x] **Step 1** — Course catalogue ingested (2,580 courses in Supabase via MIT Learn API)
- [x] **Step 1b** — Course browser UI (`/courses` page with search, filters, pagination)
- [x] **Auth** — Email/password auth via Supabase (login, signup, session proxy)
- [x] **Step 2** — Download + extract course zips (syllabus, videos, problem sets)
- [x] **Step 4** — Individual course pages with embedded content (`/courses/[id]`)
- [x] **Step 5a** — Video progress tracking (auto-complete via YouTube IFrame API at 80% or video end)
- [x] **Step 3a** — Problem set UI (schema, types, queries, ProblemSetView + ProblemCard components)
- [ ] **Step 3b** — Problem set parsing script (PDF → structured problems via Claude API)
- [ ] **Step 5b** — Remaining progress features (bookmarks, recently viewed, course-level progress bar)

---

## Architecture

- **Frontend:** Next.js (App Router), Tailwind CSS, Instrument Sans font
- **Database:** Supabase (Postgres)
- **Auth:** Supabase Auth (email/password), session managed via proxy
- **Ingestion scripts:** Python (`scripts/` directory)
- **URL-driven state:** Course browser uses URL search params as single source of truth — server components read params, client components update them via `router.push`

### Key files
- `lib/supabase/server.ts` — server-side Supabase client
- `lib/supabase/client.ts` — browser-side Supabase client
- `lib/supabase/proxy.ts` — session refresh proxy
- `lib/queries/courses.ts` — course query builder (search, filter, paginate)
- `lib/queries/course-content.ts` — course sections + resources queries
- `lib/queries/video-progress.ts` — client-side video progress helpers (getVideoProgress, markVideoCompleted)
- `lib/types/course.ts` — `Course` type definition
- `lib/types/course-content.ts` — `CourseSection`, `Resource` types
- `app/courses/page.tsx` — course browser (server component)
- `app/courses/[id]/page.tsx` — course detail page (server component, passes data to client wrapper)
- `app/courses/[id]/CoursePageContent.tsx` — client wrapper managing overview/player mode toggle
- `app/courses/[id]/CourseHeader.tsx` — course header with "Continue Course" button
- `app/courses/[id]/CoursePlayer.tsx` — lecture player with sidebar, progress checkmarks, prev/next nav
- `app/courses/[id]/YouTubePlayer.tsx` — YouTube IFrame API wrapper with auto-completion tracking
- `app/components/CourseCard.tsx` — course card (server component)
- `app/components/CourseSearch.tsx` — search input with debounce (client)
- `app/components/CourseFilters.tsx` — department/topic/feature filters (client)
- `app/components/Pagination.tsx` — page navigation (client)
- `scripts/ingest_courses.py` — MIT Learn API ingestion script
- `app/courses/[id]/ProblemSetView.tsx` — problem set container with nav strip, PDF reference
- `app/courses/[id]/ProblemCard.tsx` — single problem card (answering → reviewing → graded phases)
- `lib/queries/problem-progress.ts` — client-side problem attempt helpers (getProblemAttempts, submitProblemAttempt)
- `scripts/schema-step3-problems.sql` — problems + user_problem_attempts table migration
- `scripts/schema-step5-video-progress.sql` — user_video_progress table migration

### Course page UX (Khan Academy-style)

Two modes on `/courses/[id]`:
1. **Overview mode** (default) — CourseHeader visible with "Continue Course" button, player inline below
2. **Player mode** (via "Continue Course" or `?lecture=N`) — header hidden, video takes full width, slim sidebar with numbered lectures + green checkmarks for completed

"Continue Course" finds the first incomplete lecture. Progress is tracked automatically — videos auto-mark as completed at 80% watched or on video end (YouTube IFrame API). No manual buttons needed.

### Database schema (current)
- `courses` — all OCW course metadata (title, url, departments, topics, runs, features, views)
  - JSONB columns: `departments`, `topics`, `runs`, `course_feature`
  - Booleans: `has_lecture_videos`, `has_problem_sets`
  - `views` column for popularity sorting
  - `content_downloaded` boolean + `content_downloaded_at` timestamp
- `course_sections` — sections within a course (title, slug, section_type, ordering, parent_id)
  - section_type: `lecture`, `assignments`, `exams`, `recitations`, etc.
- `resources` — files/videos within sections (title, resource_type, pdf_path, youtube_id, archive_url, ordering)
  - resource_type: `video`, `problem_set`, `exam`, `lecture_notes`, `reading`, `solution`, `recitation`
- `user_video_progress` — per-user video completion tracking (user_id, resource_id, completed, completed_at)
  - RLS: users can only read/write their own rows
  - Unique constraint on (user_id, resource_id)
- `problems` — parsed problem content (resource_id, course_id, problem_label, question_text, solution_text, ordering)
  - Readable by all (public course content)
- `user_problem_attempts` — per-user self-graded answers (user_id, problem_id, answer_text, self_grade, attempted_at)
  - self_grade: `correct`, `partially_correct`, `incorrect`, `unsure`
  - RLS: users can only read/write their own rows
  - Unique constraint on (user_id, problem_id)

---

## Step 2 — Course Content via Zip Downloads

**Goal:** Download and extract OCW course zip files to get all course materials (HTML structure, PDFs, resource files) for native hosting.

**Why zip instead of scraping:** Each OCW course has a downloadable zip file containing the full offline version. This is faster, more reliable, and avoids HTML parsing fragility.

### Zip download details

**Download page:** `{course_url}download` — the full-course zip link is always the **first** `.zip` link on the page. Other `.zip` links further down are individual resource files (problem set templates, etc.).

**Zip URL pattern:** `{course_url}{course_number_with_dots}-{semester}-{year}.zip`
- e.g. `https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/6.006-spring-2020.zip`

**Zip contents:**
- `index.html` — course homepage
- HTML files replicating full course structure (syllabus, sections, pages)
- `static_resources/` — all downloadable files (problem set PDFs, exam PDFs, lecture notes, solutions, code, data)
- `imsmanifest.xml` — packaging metadata (can ignore)

**Videos are NOT in the zip.** They're hosted on YouTube / archive.org. YouTube URLs are embedded in the course HTML pages and can be extracted during parsing.

### Approach
1. Python script to download zips for courses with `has_lecture_videos` or `has_problem_sets`
2. Extract and parse HTML locally to build course structure (sections, resources)
3. Extract YouTube URLs from video pages
4. Catalog all PDFs from `static_resources/`
5. Store everything in child tables: `course_sections`, `resources`
6. Rate-limit downloads to ~1 req/sec

---

## Step 3 — Problem Set Parsing (Interactive Questions)

**Goal:** Turn problem set PDFs into structured, interactive question formats users can answer in-app.

**Approach:**
1. Extract text from PDFs using `pdfplumber` or `pymupdf`
2. Use Claude API to identify individual problems, sub-parts, and expected answer types
3. Store structured questions in a `problems` table
4. Build the UI — render problems one at a time, accept user answers, store attempts

**Schema extension:**
```
resources → problems (question_text, part_label, answer_type, solution_text)
           → user_attempts (user_id, problem_id, answer, is_correct, attempted_at)
```

**Caveats:**
- Some problem sets include diagrams/figures — flag for manual review or skip
- Solutions sometimes in separate PDFs — link them but don't show until user submits
- Start with text-heavy courses (math, econ, CS) before physics/engineering with heavy notation

---

## Step 5b — Remaining Progress Features (future)

**Schema (not yet created):**
```
user_bookmarks (user_id, course_id, created_at)
recently_viewed (user_id, course_id, viewed_at)
```

**Features:**
- "Recently viewed" section on homepage
- Course-level progress bar (% of videos watched, % of problems attempted)
- Bookmarked courses list

---

## Order of Operations (updated)

1. ~~Get Step 1 running and verify the API returns clean data~~ Done
2. ~~Build the Next.js course browser UI against the Step 1 data~~ Done
3. ~~Add user auth~~ Done
4. ~~Download + extract course zips for top courses~~ Done — Step 2
5. ~~Build individual course page with embedded YouTube player~~ Done — Step 4
6. ~~Add video progress auto-tracking~~ Done — Step 5a
7. Tackle problem set parsing for a single course end-to-end — Step 3
8. Remaining progress features (bookmarks, recently viewed, progress bars) — Step 5b
9. Scale across all courses with relevant content
