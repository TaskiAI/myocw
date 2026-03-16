# Course Scraping Pipeline Rework

## The Problem

The current `download-course.ts` pipeline produces **dud links** — assignments, exams, and other non-lecture items appear in the course sidebar but have no actual content behind them.

### Root Cause

The pipeline asks an LLM (Gemini via OpenRouter) to guess the correct ordering and filenames for course content. This breaks in two ways:

1. **Sections with no resources.** The LLM returns ordered items with empty `pdfFilenames: []`. A `course_section` row is created, but no `resources` row. The sidebar shows the item, but clicking it shows "No files available."

2. **Hallucinated filenames.** The LLM returns filenames that don't match any actually-uploaded PDF. The code falls back to constructing a storage URL (`buildStoragePublicUrl(...)`) that points to a file that doesn't exist. The resource row has a broken `pdf_path`.

Both issues stem from the same design flaw: **the LLM is the source of truth for what content exists**, when it should be the actual files.

---

## The Fix: Scrape the Zip HTML Instead of LLM Guessing

The downloaded OCW zip already contains all the HTML pages from the course website. These pages are the authoritative source for what content exists and how it's ordered.

### Key Zip Structure

```
course.zip/
├── index.html                          # Course homepage with nav sidebar
├── data.json                           # Course metadata (title, instructors, topics)
├── pages/
│   ├── resource-index/index.html       # Weekly table of ALL resources (lectures, recitations, problem sets, quizzes)
│   ├── assignments/index.html          # Assignment listing with PDF links
│   ├── calendar/index.html             # Semester schedule
│   ├── syllabus/index.html
│   └── ...
├── video_galleries/
│   └── lecture-videos/index.html       # All lecture videos with YouTube thumbnail IDs
├── resources/
│   ├── mit6_006s20_ps0-questions/
│   │   └── data.json                   # { "title": "Problem Set 0", "file": "/courses/.../hash_MIT6_006S20_ps0-questions.pdf" }
│   ├── lecture-1-algorithms-.../
│   │   └── data.json
│   └── ...  (one folder per resource)
└── static_resources/                   # Actual PDF files (hash-prefixed filenames)
```

### What Each HTML Page Gives Us

| Page | What we extract |
|------|----------------|
| `video_galleries/lecture-videos/index.html` | Ordered list of lectures with YouTube IDs (from thumbnail URLs `img.youtube.com/vi/{ID}/`) and titles |
| `pages/resource-index/index.html` | Weekly table with columns: Lectures, Recitations, Problem Sessions, Quizzes, Problem Sets — each cell links to `../../resources/{id}/index.html` |
| `resources/{id}/data.json` | Clean title, PDF file path (maps hash-prefixed filename to human-readable title), resource type |

### New Approach

1. **Parse `video_galleries/lecture-videos/index.html`** — extract ordered lectures with YouTube IDs and titles (already works, just moves from live fetch to local HTML)

2. **Parse `pages/resource-index/index.html`** — scrape the weekly table to get chronological ordering of all content. Each cell contains `<a>` tags linking to `../../resources/{resource-id}/index.html`. This gives us:
   - The week number (natural interleaving order)
   - The resource ID (folder name in `resources/`)
   - The display title (link text)
   - The column (= content type: lecture notes, recitation, problem set, quiz, etc.)

3. **Resolve each resource via `resources/{id}/data.json`** — get the actual PDF filename from the `file` field, map it to an uploaded file in `static_resources/`

4. **Only create sections/resources for items with verified content** — if a resource links to a PDF that exists in `static_resources/`, create it. Otherwise, skip it. No more dud links.

5. **Fallback for courses without resource-index** — parse individual section pages (`pages/assignments/index.html`, `pages/quizzes/index.html`, etc.) which list resources in a similar `<a href="../../resources/{id}/...">` pattern. Use the nav sidebar from `index.html` to discover which section pages exist.

### What Gets Removed

- The entire `orderCourseContent()` LLM call (OpenRouter/Gemini)
- The `fallbackOrdering()` function
- The `extractHtmlPagesContext()` function (was feeding raw text to the LLM)
- PDF type guessing from filenames (`guessPdfType()`) — resource-index columns tell us the type directly

### What Stays

- Zip download + extraction
- PDF upload to Supabase Storage (with clean rename via `resources/{id}/data.json` titles)
- Video gallery parsing (moved from live fetch to local HTML)
- Section + resource DB insertion

---

## Edge Cases to Handle

- **No resource-index page** — some courses don't have one. Fall back to parsing individual section pages from the nav sidebar.
- **Videos without YouTube IDs** — some older courses embed archive.org URLs instead. Check resource pages for these.
- **Resource links to non-PDF files** — some resources are ZIP templates (Python files, etc.). Skip or handle separately.
- **Courses with non-standard nav sections** — the nav sidebar varies by course. Parse whatever sections exist rather than hardcoding expected ones.
