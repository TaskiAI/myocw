# myOCW — Build Plan

A personalized learning platform that natively hosts MIT OpenCourseWare content. Users browse courses, watch lecture videos (embedded YouTube), work through interactive problem sets, and track their progress — all without leaving the app.

OCW content is licensed under CC BY-NC-SA 4.0, so we can use it freely with attribution.

**Current focus:** Polishing existing features, scaling content across courses, and adding remaining progress features (bookmarks).

---

## Progress

- [x] **Step 1** — Course catalogue ingested (2,580 courses in Supabase via MIT Learn API)
- [x] **Step 1b** — Course browser UI (`/courses` page with search, filters, pagination)
- [x] **Auth** — Email/password auth via Supabase (login, signup, session proxy)
- [x] **Step 2** — Download + extract course zips (syllabus, videos, problem sets)
- [x] **Step 4** — Individual course pages with embedded content (`/courses/[id]`)
- [x] **Step 5a** — Video progress tracking (auto-complete via YouTube IFrame API at 80% or video end)
- [x] **Step 3a** — Problem set UI (schema, types, queries, ProblemSetView + ProblemCard components)
- [x] **Step 3b** — Problem set parsing script (PDF → structured problems via Qwen/OpenAI)
- [x] **Step 5b (partial)** — Course activity tracking, recently viewed, course-level progress bars, personalized dashboard
- [x] **Step 6** — Sidebar ordering (course_sidebar_order table, customizable section order)
- [x] **Step 7** — Curricula system (tracks, enrollment, CurriculumTrackCard)
- [x] **Step 8** — User problem set drafts (ManualPsetEditor, draft CRUD)
- [x] **Step 9** — Problem editor (dev-only RLS for content curation)
- [x] **Step 11** — Scholar Track ingestion (unit/session hierarchy, `is_scholar` flag, unit-grouped UI)
- [x] **Step 12** — User profiles with language preference (LanguagePopup on login)
- [ ] **Bookmarks** — User bookmarks for courses (not yet implemented)

---

## Architecture

- **Frontend:** Next.js (App Router), Tailwind CSS, Instrument Sans font
- **Database:** Supabase (Postgres)
- **Auth:** Supabase Auth (email/password), session managed via proxy
- **Ingestion scripts:** TypeScript (`scripts/` directory)
- **Problem parsing:** Qwen (local LLM, default) + OpenAI (secondary) via `parse-problems.ts`
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
- `app/courses/[id]/ProblemSetView.tsx` — problem set container with nav strip, PDF reference
- `app/courses/[id]/ProblemCard.tsx` — single problem card (answering → reviewing → graded phases)
- `app/courses/[id]/ResourceList.tsx` — list of resources within a section
- `app/courses/[id]/VideoPlayer.tsx` — video player wrapper
- `app/components/CurriculumTrackCard.tsx` — curriculum track card with enrollment controls
- `app/components/MathText.tsx` — KaTeX math rendering (inline/display) with markdown support (client)
- `app/components/Navbar.tsx` — navigation bar
- `app/curricula/page.tsx` — curricula browser page
- `app/curricula/CurriculumEnrollToggle.tsx` — enrollment toggle component
- `app/my-courses/page.tsx` — user's courses with progress bars
- `app/account/page.tsx` — account settings
- `app/account/ManualPsetEditor.tsx` — manual problem set editor (create/edit/delete drafts)
- `lib/queries/problem-progress.ts` — client-side problem attempt helpers (getProblemAttempts, submitProblemAttempt)
- `lib/queries/course-activity.ts` — course interaction tracking (markCourseInteracted)
- `lib/queries/course-sidebar-order.ts` — sidebar section ordering queries
- `lib/queries/curricula.ts` — curriculum tracks + enrollment queries
- `lib/queries/curriculum-enrollments.ts` — user curriculum enrollment helpers
- `lib/queries/my-courses.ts` — user's courses sorted by recency with progress
- `lib/queries/user-pset-drafts.ts` — client-side pset draft CRUD
- `lib/queries/user-pset-drafts-server.ts` — server-side pset draft queries
- `lib/queries/problem-editor.ts` — problem editor queries (dev-only)
- `lib/data/curricula.ts` — static curriculum track definitions
- `lib/types/manual-pset.ts` — ManualPsetProblem, UserPsetDraft types
- `app/components/LanguagePopup.tsx` — language selection popup (shown after login if unset)
- `lib/queries/user-profile.ts` — user profile helpers (get/set language)
- `scripts/ingest-courses.ts` — MIT Learn API ingestion script
- `scripts/parse-problems.ts` — PDF → structured problems via Qwen/OpenAI
- `scripts/batch-process.ts` — batch processing orchestration
- `scripts/download-course.ts` — course zip download and extraction
- `scripts/schema-step3-problems.sql` — problems + user_problem_attempts table migration
- `scripts/schema-step5-video-progress.sql` — user_video_progress table migration
- `scripts/schema-step5b-course-activity.sql` — user_course_activity table migration
- `scripts/schema-step6-sidebar-order.sql` — course_sidebar_order table migration
- `scripts/schema-step7-curriculum-enrollments.sql` — user_curriculum_enrollments table migration
- `scripts/schema-step8-user-pset-drafts.sql` — user_pset_drafts table migration
- `scripts/schema-step9-problem-editor.sql` — problem editor RLS policies
- `scripts/schema-step11-scholar.sql` — `is_scholar` column on courses table
- `scripts/schema-batch-progress.sql` — batch progress columns on courses table
- `scripts/schema-step12-user-profiles.sql` — user_profiles table migration
- `scripts/download-scholar-course.ts` — Scholar Track course download + ingestion (unit/session hierarchy)

### Routes
- `/` — landing page (unauthenticated) or personalized dashboard (authenticated)
- `/courses` — course browser with search, filters, pagination
- `/courses/[id]` — course detail with overview/player modes
- `/my-courses` — user's recent courses with progress (redirects to login if unauthenticated)
- `/curricula` — browse and enroll in curriculum tracks
- `/account` — account settings, ManualPsetEditor
- `/login` — email/password auth

### Course page UX (Khan Academy-style)

Two modes on `/courses/[id]`:
1. **Overview mode** (default) — CourseHeader visible with "Continue Course" button, player inline below
2. **Player mode** (via "Continue Course" or `?lecture=N`) — header hidden, video takes full width, slim sidebar with numbered lectures + green checkmarks for completed

"Continue Course" finds the first incomplete lecture. Progress is tracked automatically — videos auto-mark as completed at 80% watched or on video end (YouTube IFrame API). No manual buttons needed.

### Database schema (current)
- `courses` — all OCW course metadata (title, url, departments, topics, runs, features, views)
  - JSONB columns: `departments`, `topics`, `runs`, `course_feature`
  - Booleans: `has_lecture_videos`, `has_problem_sets`, `content_downloaded`, `problems_parsed`
  - `views` column for popularity sorting
  - `content_downloaded_at`, `problems_parsed_at` timestamps
  - `download_error`, `parse_error` for batch processing status
  - `is_scholar` boolean for Scholar Track courses (unit/session hierarchy)
- `course_sections` — sections within a course (title, slug, section_type, ordering, parent_id)
  - section_type: `lecture`, `assignments`, `exams`, `recitations`, `unit` (Scholar parent container), etc.
- `resources` — files/videos within sections (title, resource_type, pdf_path, youtube_id, archive_url, ordering)
  - resource_type: `video`, `problem_set`, `exam`, `lecture_notes`, `reading`, `solution`, `recitation`
- `user_video_progress` — per-user video completion tracking (user_id, resource_id, completed, completed_at)
  - RLS: users can only read/write their own rows
  - Unique constraint on (user_id, resource_id)
- `problems` — parsed problem content (resource_id, course_id, problem_label, question_text, solution_text, ordering)
  - Readable by all (public course content); dev-only write via RLS
- `user_problem_attempts` — per-user self-graded answers (user_id, problem_id, answer_text, self_grade, attempted_at)
  - self_grade: `correct`, `partially_correct`, `incorrect`, `unsure`
  - RLS: users can only read/write their own rows
  - Unique constraint on (user_id, problem_id)
- `user_course_activity` — per-user course interaction tracking (user_id, course_id, last_interacted_at)
  - Used for "recently viewed" and dashboard ordering
- `course_sidebar_order` — global per-course section ordering (course_id, section_id, position)
  - Customizable sidebar section order in course player
- `user_curriculum_enrollments` — user enrollment in curriculum tracks (user_id, curriculum_id, enrolled_at)
  - RLS: users can only manage their own enrollments
- `user_pset_drafts` — user-created problem set drafts (user_id, course_id, title, problems JSONB, updated_at)
  - Used by ManualPsetEditor for custom problem creation
- `user_profiles` — user preferences (user_id, language, created_at, updated_at)
  - RLS: users can only read/write their own profile

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

## Step 3 — Problem Set Parsing (Interactive Questions) — DONE

**Goal:** Turn problem set PDFs into structured, interactive question formats users can answer in-app.

**Implemented approach:**
1. PDF → LLM (Qwen or OpenAI) via `scripts/parse-problems.ts`
2. LLM extracts individual problems with question text, solution text, and labels
3. Stored in `problems` table, rendered via ProblemSetView + ProblemCard
4. MathText component renders KaTeX math notation inline
5. Batch processing via `scripts/batch-process.ts` for scaling across courses
6. ManualPsetEditor in `/account` for manual problem creation/editing

---

## Step 5b — Progress Features (partially done)

**Done:**
- Course activity tracking (`user_course_activity` table)
- Recently viewed courses on `/my-courses` and homepage dashboard
- Course-level video progress bars on course cards
- Problem set completion stats on course headers

**Not yet done:**
- User bookmarks (`user_bookmarks` table not yet created)

---

## Order of Operations (updated)

1. ~~Get Step 1 running and verify the API returns clean data~~ Done
2. ~~Build the Next.js course browser UI against the Step 1 data~~ Done
3. ~~Add user auth~~ Done
4. ~~Download + extract course zips for top courses~~ Done — Step 2
5. ~~Build individual course page with embedded YouTube player~~ Done — Step 4
6. ~~Add video progress auto-tracking~~ Done — Step 5a
7. ~~Tackle problem set parsing for a single course end-to-end~~ Done — Step 3
8. ~~Recently viewed, progress bars, dashboard~~ Done (partial) — Step 5b
9. ~~Curricula system with enrollment~~ Done — Step 7
10. ~~Problem set drafts and editor~~ Done — Steps 8-9
11. ~~Batch processing across courses~~ Done
12. Bookmarks feature — remaining from Step 5b
