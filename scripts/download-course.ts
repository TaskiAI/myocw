import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const TMP_DIR = "/tmp/myocw-download";

// Extract YouTube ID from various URL formats
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract archive.org video URL
function extractArchiveUrl(html: string): string | null {
  const match = html.match(/https?:\/\/archive\.org\/download\/[^\s"'<>]+\.mp4/);
  return match ? match[0] : null;
}

// Find files recursively matching a predicate
function findFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...findFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

// Extract lecture number from a title like "Lecture 1: Algorithms and Computation"
function extractLectureNumber(title: string): number | null {
  const match = title.match(/lecture\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

interface LectureEntry {
  title: string;
  slug: string;
  youtubeId: string | null;
  archiveUrl: string | null;
  lectureNumber: number | null;
}

interface PdfEntry {
  filename: string;
  title: string;
  guessedType: "problem_set" | "exam" | "solution" | "recitation" | "lecture_notes" | "other";
}

interface OrderedItem {
  type: "lecture" | "problem_set" | "exam" | "recitation" | "other";
  title: string;
  /** index into the lectures array (for type=lecture) */
  lectureIndex?: number;
  /** PDF filenames (for non-lecture types) */
  pdfFilenames?: string[];
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Extract meaningful text content from HTML pages in the zip for LLM context
function extractHtmlPagesContext(contentRoot: string): string {
  const pagesDir = path.join(contentRoot, "pages");
  if (!fs.existsSync(pagesDir)) {
    console.log("No pages/ directory found in zip");
    return "";
  }

  const htmlFiles = findFiles(pagesDir, (fp) => fp.endsWith(".html"));
  if (htmlFiles.length === 0) return "";

  // Also grab nav links from index.html to understand course structure
  const indexPath = path.join(contentRoot, "index.html");
  let navContext = "";
  if (fs.existsSync(indexPath)) {
    const indexHtml = fs.readFileSync(indexPath, "utf-8");
    const $index = cheerio.load(indexHtml);
    const navLinks: string[] = [];
    $index("nav a, .course-nav a, #course-nav a, [role=navigation] a").each((_, el) => {
      const text = $index(el).text().trim();
      if (text) navLinks.push(text);
    });
    if (navLinks.length > 0) {
      navContext = `=== COURSE NAVIGATION ===\n${navLinks.join("\n")}\n\n`;
    }
  }

  // Priority pages — these contain the most useful ordering information
  const priorityPatterns = ["calendar", "syllabus", "assignments", "resource-index", "readings", "schedule"];

  // Sort: priority pages first, then alphabetical
  const getPriority = (fp: string) => {
    const lower = fp.toLowerCase();
    const idx = priorityPatterns.findIndex((p) => lower.includes(p));
    return idx >= 0 ? idx : priorityPatterns.length;
  };
  htmlFiles.sort((a, b) => getPriority(a) - getPriority(b) || a.localeCompare(b));

  const sections: string[] = [];
  let totalLength = 0;
  const MAX_CONTEXT_CHARS = 80_000; // Keep context reasonable for the LLM

  for (const htmlFile of htmlFiles) {
    if (totalLength >= MAX_CONTEXT_CHARS) break;

    const html = fs.readFileSync(htmlFile, "utf-8");
    const $ = cheerio.load(html);

    // Remove boilerplate elements
    $("script, style, nav, header, footer, .course-nav, #course-nav, noscript, link, meta").remove();

    // Try to extract from main content area, fall back to body
    let text = "";
    const mainSelectors = ["main", "article", "#course-content", ".course-content", "#main-content", ".main-content"];
    for (const sel of mainSelectors) {
      const el = $(sel);
      if (el.length) {
        text = el.text();
        break;
      }
    }
    if (!text) {
      text = $("body").text();
    }

    // Clean up whitespace: collapse runs of whitespace, trim lines
    text = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");

    if (text.length < 20) continue; // Skip near-empty pages

    // Derive a label from the file path
    const relative = path.relative(pagesDir, htmlFile);
    const label = relative.replace(/\.html$/, "").replace(/\//g, " > ").toUpperCase();

    const section = `=== ${label} ===\n${text}`;

    // Truncate individual pages if very long
    const truncated = section.length > 15_000 ? section.slice(0, 15_000) + "\n[... truncated]" : section;
    sections.push(truncated);
    totalLength += truncated.length;
  }

  console.log(`Extracted text from ${sections.length} HTML pages (${(totalLength / 1024).toFixed(0)} KB context)`);
  return navContext + sections.join("\n\n");
}

async function orderCourseContent(
  courseTitle: string,
  lectures: LectureEntry[],
  pdfEntries: PdfEntry[],
  htmlContext: string,
): Promise<OrderedItem[]> {
  if (!OPENROUTER_API_KEY) {
    console.warn("OPENROUTER_API_KEY not set — falling back to lectures-first ordering");
    return fallbackOrdering(lectures, pdfEntries);
  }

  const hasHtmlContext = htmlContext.length > 0;

  const prompt = `You are building a course sidebar for an MIT OpenCourseWare class. The sidebar must show a SINGLE INTERLEAVED list — lectures mixed with problem sets, recitations, and exams in the order a student encounters them during the semester.

Course: "${courseTitle}"
${hasHtmlContext ? `
## Course pages (from the OCW zip archive)

These are the AUTHORITATIVE source for ordering. The calendar/syllabus pages explicitly say which lectures come before which problem sets. Use them.

${htmlContext}

---
` : ""}
## Lectures
${lectures.map((l, i) => `  [L${i}] ${l.title}`).join("\n")}

## PDF files in the archive
${pdfEntries.map((p) => `  [${p.guessedType}] ${p.filename} — "${p.title}"`).join("\n")}

## Task

Produce a flat JSON array that interleaves lectures with problem sets, recitations, and exams in CHRONOLOGICAL semester order.${hasHtmlContext ? " The calendar/syllabus pages above are your primary source — they tell you exactly which problem set is due after which lectures." : ""}

CRITICAL RULES:
1. INTERLEAVE. Do NOT list all lectures first then dump PDFs at the end. A recitation with the same number as a lecture goes RIGHT AFTER that lecture. A problem set goes after the last lecture it covers. Example: Lecture 1, Recitation 1, Lecture 2, Recitation 2, Problem Set 1, Lecture 3, Recitation 3, Lecture 4, Recitation 4, Problem Set 2, ...
2. Every lecture [L0..L${lectures.length - 1}] must appear exactly once.
3. Skip "lecture_notes" PDFs entirely — they auto-attach to their lecture.
4. Group a solution PDF with its problem set (both filenames in one item's pdfFilenames array), not as a separate item.
5. Give non-lecture items CLEAN human-readable titles like "Problem Set 1", "Quiz 1", "Recitation 3" — NOT the raw filename.
6. If a PDF doesn't clearly belong anywhere, place it near the most relevant lecture, do NOT put it at the end.
7. Output ONLY a JSON array. No markdown fences, no commentary.
8. Some problem sets will be numbered 0 to signify that they are pre-assessments. Place Titles with 0 in them first out of anything.

## Output schema

Each element:
{ "type": "lecture" | "problem_set" | "exam" | "recitation" | "other", "title": "<clean display title>", "lectureIndex": <L-number for lectures, null for others>, "pdfFilenames": ["<exact filename(s)>"] }

For lectures: lectureIndex = the L-number, pdfFilenames = [].
For non-lectures: lectureIndex = null, pdfFilenames = the exact filename(s) from the PDF list above.`;

  console.log(`Asking LLM to order course content (${hasHtmlContext ? "with" : "without"} HTML context)...`);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`OpenRouter error (${res.status}): ${text}`);
    console.warn("Falling back to lectures-first ordering");
    return fallbackOrdering(lectures, pdfEntries);
  }

  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "";

  try {
    // Strip markdown fences if the model added them despite instructions
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const items = JSON.parse(cleaned) as OrderedItem[];
    console.log(`LLM returned ${items.length} ordered items`);
    return items;
  } catch (e) {
    console.error("Failed to parse LLM response:", e);
    console.log("Raw response:", raw.slice(0, 500));
    console.warn("Falling back to lectures-first ordering");
    return fallbackOrdering(lectures, pdfEntries);
  }
}

function fallbackOrdering(lectures: LectureEntry[], pdfEntries: PdfEntry[]): OrderedItem[] {
  const items: OrderedItem[] = [];

  for (let i = 0; i < lectures.length; i++) {
    items.push({ type: "lecture", title: lectures[i].title, lectureIndex: i, pdfFilenames: [] });
  }

  // Group non-lecture-notes PDFs by type
  for (const pdf of pdfEntries) {
    if (pdf.guessedType === "lecture_notes") continue;
    const type = pdf.guessedType === "solution" ? "problem_set" : pdf.guessedType;
    items.push({
      type: type as OrderedItem["type"],
      title: pdf.title,
      lectureIndex: undefined,
      pdfFilenames: [pdf.filename],
    });
  }

  return items;
}

// Scan resources/*/data.json in the zip for PDF titles.
// Each data.json has { title, file } where file contains the hash-prefixed filename.
// Returns a map: hash-prefixed filename → clean title.
function extractPdfTitlesFromResources(contentRoot: string): Map<string, string> {
  const titleMap = new Map<string, string>();
  const resourcesDir = path.join(contentRoot, "resources");
  if (!fs.existsSync(resourcesDir)) return titleMap;

  const dataFiles = findFiles(resourcesDir, (fp) => fp.endsWith("data.json"));
  for (const dataFile of dataFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
      if (!data.file || !data.title) continue;
      // data.file is like "/courses/.../60f0a029ab..._MIT6_006S20_ps0-questions.pdf"
      const filename = data.file.split("/").pop();
      if (!filename || !filename.toLowerCase().endsWith(".pdf")) continue;
      titleMap.set(filename, data.title);
    } catch {
      // Skip malformed data.json
    }
  }

  return titleMap;
}

// Sanitize a title into a safe filename: "Problem Set 1: Graphs" → "problem-set-1-graphs.pdf"
function titleToFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) + ".pdf";
}

function guessPdfType(filename: string): PdfEntry["guessedType"] {
  const lower = filename.toLowerCase();
  if (/_lec\d+/i.test(lower) || lower.includes("lecture")) return "lecture_notes";
  if (lower.includes("sol") && (lower.includes("ps") || lower.includes("hw") || lower.includes("pset"))) return "solution";
  if (lower.includes("_ps") || lower.includes("pset") || lower.includes("homework") || lower.includes("_hw")) return "problem_set";
  if (lower.includes("final") || lower.includes("quiz") || lower.includes("exam") || lower.includes("midterm")) return "exam";
  if (/_r\d+/.test(lower) || lower.includes("recitation")) return "recitation";
  if (lower.includes("sol")) return "solution";
  return "other";
}

async function downloadCourse(slug: string) {
  console.log(`Looking up course with slug: ${slug}`);

  // Find course in Supabase by matching URL
  const { data: courses, error: lookupError } = await supabase
    .from("courses")
    .select("*")
    .ilike("url", `%${slug}%`);

  if (lookupError || !courses?.length) {
    console.error("Course not found:", lookupError?.message ?? "no match");
    process.exit(1);
  }

  const course = courses[0];
  console.log(`Found course: ${course.title} (id: ${course.id})`);
  console.log(`URL: ${course.url}`);

  // Ensure course URL ends with /
  const courseUrl = course.url.endsWith("/") ? course.url : course.url + "/";

  // Fetch the download page to find the zip link
  console.log(`Fetching download page: ${courseUrl}download`);
  const downloadPageRes = await fetch(`${courseUrl}download`);
  if (!downloadPageRes.ok) {
    console.error(`Failed to fetch download page: ${downloadPageRes.status}`);
    process.exit(1);
  }

  const downloadHtml = await downloadPageRes.text();
  const $dl = cheerio.load(downloadHtml);

  // Find the first zip download link (full course zip is always first on the page)
  let zipUrl: string | null = null;
  $dl('a[href$=".zip"]').each((_, el) => {
    if (zipUrl) return; // take only the first match
    const href = $dl(el).attr("href");
    if (href) {
      zipUrl = href.startsWith("http") ? href : new URL(href, courseUrl).toString();
    }
  });

  if (!zipUrl) {
    console.error("Could not find zip download link on the page");
    process.exit(1);
  }

  console.log(`Zip URL: ${zipUrl}`);

  // Create temp directory
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const zipPath = path.join(TMP_DIR, `${slug}.zip`);

  // Download the zip
  console.log("Downloading zip...");
  const zipRes = await fetch(zipUrl);
  if (!zipRes.ok) {
    console.error(`Failed to download zip: ${zipRes.status}`);
    process.exit(1);
  }

  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
  fs.writeFileSync(zipPath, zipBuffer);
  console.log(`Downloaded ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Extract zip
  console.log("Extracting zip...");
  const zip = new AdmZip(zipPath);
  const extractDir = path.join(TMP_DIR, slug);
  zip.extractAllTo(extractDir, true);

  // Find the root content directory (usually one level deep)
  const entries = fs.readdirSync(extractDir);
  const contentRoot = entries.length === 1
    ? path.join(extractDir, entries[0])
    : extractDir;

  console.log(`Content root: ${contentRoot}`);

  // Extract human-readable PDF titles from HTML pages (before cleanup)
  const pdfTitleMap = extractPdfTitlesFromResources(contentRoot);
  console.log(`Found HTML titles for ${pdfTitleMap.size} PDFs`);

  // Copy and rename PDFs to public/content/courses/<slug>/
  const publicDir = path.join(process.cwd(), "public", "content", "courses", slug);
  fs.mkdirSync(publicDir, { recursive: true });

  const staticDir = path.join(contentRoot, "static_resources");
  let pdfCount = 0;
  // Maps: original filename → new filename (on disk), original filename → clean title
  const pdfRenameMap = new Map<string, string>();
  const pdfFiles: string[] = []; // new filenames (after rename)
  if (fs.existsSync(staticDir)) {
    const usedFilenames = new Set<string>();
    const staticFiles = fs.readdirSync(staticDir);
    for (const file of staticFiles) {
      if (file.toLowerCase().endsWith(".pdf")) {
        const htmlTitle = pdfTitleMap.get(file);
        let newFilename: string;
        if (htmlTitle) {
          newFilename = titleToFilename(htmlTitle);
          // Deduplicate
          if (usedFilenames.has(newFilename)) {
            let i = 2;
            while (usedFilenames.has(newFilename.replace(".pdf", `-${i}.pdf`))) i++;
            newFilename = newFilename.replace(".pdf", `-${i}.pdf`);
          }
        } else {
          newFilename = file; // keep original if no HTML title found
        }
        usedFilenames.add(newFilename);
        fs.copyFileSync(path.join(staticDir, file), path.join(publicDir, newFilename));
        pdfRenameMap.set(file, newFilename);
        pdfFiles.push(newFilename);
        pdfCount++;
        if (htmlTitle) {
          console.log(`  ${file} → ${newFilename} ("${htmlTitle}")`);
        }
      }
    }
  }
  console.log(`Copied ${pdfCount} PDFs to public/content/courses/${slug}/`);

  // ── Parse sequential lectures ──
  // Strategy: check for a cached lectures.json first (from a previous run).
  // Otherwise fetch the live OCW video gallery page — the zip HTML doesn't
  // reliably contain YouTube embeds, but the live gallery has YouTube IDs
  // in thumbnail URLs (img.youtube.com/vi/{ID}/default.jpg).
  console.log("Parsing lecture structure...");

  const lectures: LectureEntry[] = [];
  const lecturesCachePath = path.join(publicDir, "lectures.json");

  if (fs.existsSync(lecturesCachePath)) {
    console.log("Using cached lectures.json");
    const cached = JSON.parse(fs.readFileSync(lecturesCachePath, "utf-8")) as LectureEntry[];
    lectures.push(...cached);
    console.log(`Loaded ${lectures.length} lectures from cache`);
  }

  if (lectures.length === 0) {
    console.log("Fetching live video gallery page...");
    const galleryUrl = `${courseUrl}video_galleries/lecture-videos/`;
    const galleryRes = await fetch(galleryUrl);

    if (galleryRes.ok) {
      const galleryHtml = await galleryRes.text();
      const $gallery = cheerio.load(galleryHtml);

      // Each lecture is an <a> containing an <img> (YouTube thumbnail) and an <h5> (title)
      // Thumbnail pattern: https://img.youtube.com/vi/{VIDEO_ID}/default.jpg
      $gallery("a").each((_, el) => {
        const $a = $gallery(el);
        const href = $a.attr("href") ?? "";
        const img = $a.find("img");
        const h5 = $a.find("h5");

        if (!h5.length) return;

        const title = h5.text().trim();
        if (!title) return;

        // Extract YouTube ID from thumbnail src
        const imgSrc = img.attr("src") ?? "";
        const ytMatch = imgSrc.match(/img\.youtube\.com\/vi\/([a-zA-Z0-9_-]{11})/);
        const youtubeId = ytMatch ? ytMatch[1] : null;

        // Extract slug from href
        const linkSlug = href.replace(/\/$/, "").split("/").pop() ?? "";

        if (!lectures.some((l) => l.slug === linkSlug)) {
          lectures.push({
            title,
            slug: linkSlug || `lecture-${lectures.length + 1}`,
            youtubeId,
            archiveUrl: null,
            lectureNumber: extractLectureNumber(title),
          });
        }
      });

      console.log(`Found ${lectures.length} lectures from live gallery`);

      // Fetch archive.org URLs from individual resource pages (rate-limited)
      for (const lecture of lectures) {
        if (!lecture.youtubeId) continue;
        const resourceUrl = `${courseUrl}resources/${lecture.slug}/`;
        try {
          const res = await fetch(resourceUrl);
          if (res.ok) {
            const html = await res.text();
            lecture.archiveUrl = extractArchiveUrl(html);
          }
        } catch {
          // Skip — archive URL is optional
        }
        // Rate limit: ~2 req/sec
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      console.log(`No video gallery found at ${galleryUrl} (${galleryRes.status}), scanning zip HTML files...`);
      // Fallback: scan all HTML files in the zip for YouTube embeds
      const allHtml = findFiles(contentRoot, (fp) => fp.endsWith(".html"));
      for (const htmlFile of allHtml) {
        const html = fs.readFileSync(htmlFile, "utf-8");
        const $page = cheerio.load(html);
        $page("iframe").each((_, el) => {
          const src = $page(el).attr("src") ?? "";
          const ytId = extractYouTubeId(src);
          if (ytId && !lectures.some((l) => l.youtubeId === ytId)) {
            const title = $page("h1").first().text().trim()
              || $page("h2").first().text().trim()
              || `Video ${lectures.length + 1}`;
            const fileSlug = path.basename(htmlFile, ".html");
            lectures.push({
              title,
              slug: fileSlug,
              youtubeId: ytId,
              archiveUrl: extractArchiveUrl(html),
              lectureNumber: extractLectureNumber(title),
            });
          }
        });
      }
    }
  }

  // Save lectures cache for future re-runs
  if (lectures.length > 0) {
    fs.writeFileSync(lecturesCachePath, JSON.stringify(lectures, null, 2));
    console.log(`Cached lecture metadata to lectures.json`);
  }

  console.log(`Parsed ${lectures.length} lectures`);

  // ── Classify PDFs ──
  // Build reverse map: new filename → original filename (for guessing type from original name)
  const reverseRenameMap = new Map<string, string>();
  for (const [orig, renamed] of pdfRenameMap) {
    reverseRenameMap.set(renamed, orig);
  }

  const pdfEntries: PdfEntry[] = pdfFiles.map((newFilename) => {
    const origFilename = reverseRenameMap.get(newFilename) ?? newFilename;
    const htmlTitle = pdfTitleMap.get(origFilename);
    // Use HTML title if available, otherwise derive from filename
    const title = htmlTitle ?? newFilename.replace(/\.pdf$/i, "").replace(/-/g, " ");
    return {
      filename: newFilename,
      title,
      // Guess type from original filename (has more structure) or HTML title
      guessedType: guessPdfType(origFilename) !== "other" ? guessPdfType(origFilename) : guessPdfType(htmlTitle ?? newFilename),
    };
  });

  // Match lecture notes PDFs by number for auto-attachment
  const lecturePdfMap = new Map<number, string[]>();
  for (const [origFilename, newFilename] of pdfRenameMap) {
    const match = origFilename.match(/_lec(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!lecturePdfMap.has(num)) lecturePdfMap.set(num, []);
      lecturePdfMap.get(num)!.push(newFilename);
    }
  }

  // ── Extract HTML page context for LLM (before cleanup) ──
  const htmlContext = extractHtmlPagesContext(contentRoot);

  // ── LLM-powered ordering ──
  const orderedItems = await orderCourseContent(course.title, lectures, pdfEntries, htmlContext);

  // ── Build sections and resources ──

  // Delete existing sections/resources for this course
  await supabase.from("resources").delete().eq("course_id", course.id);
  await supabase.from("course_sections").delete().eq("course_id", course.id);

  // Create flat sections from ordered items
  const sectionRows: {
    course_id: number;
    title: string;
    slug: string;
    section_type: string;
    ordering: number;
  }[] = [];

  for (let i = 0; i < orderedItems.length; i++) {
    const item = orderedItems[i];
    const sectionType = item.type === "lecture" ? "lecture" : item.type;
    const itemSlug =
      item.lectureIndex !== undefined && item.lectureIndex !== null
        ? lectures[item.lectureIndex]?.slug ?? `item-${i}`
        : `${item.type}-${i}`;
    sectionRows.push({
      course_id: course.id,
      title: item.title,
      slug: itemSlug,
      section_type: sectionType,
      ordering: i,
    });
  }

  // Insert sections
  const { data: insertedSections, error: sectionsError } = await supabase
    .from("course_sections")
    .insert(sectionRows)
    .select("id, slug, ordering");

  if (sectionsError) {
    console.error("Error inserting sections:", sectionsError);
    process.exit(1);
  }

  console.log(`Inserted ${insertedSections?.length ?? 0} sections (flat interleaved)`);

  // Build ordering → section ID map
  const sectionByOrdering = new Map<number, { id: number; slug: string }>();
  for (const s of insertedSections ?? []) {
    sectionByOrdering.set(s.ordering, { id: s.id, slug: s.slug });
  }

  // Build filename → clean title lookup from pdfEntries
  const pdfTitleByFilename = new Map<string, string>();
  for (const entry of pdfEntries) {
    pdfTitleByFilename.set(entry.filename, entry.title);
  }

  // Create resources
  const resources: {
    course_id: number;
    section_id: number | null;
    title: string;
    resource_type: string;
    pdf_path: string | null;
    video_url: string | null;
    youtube_id: string | null;
    archive_url: string | null;
    ordering: number;
  }[] = [];

  for (let i = 0; i < orderedItems.length; i++) {
    const item = orderedItems[i];
    const section = sectionByOrdering.get(i);
    const sectionId = section?.id ?? null;

    if (item.type === "lecture" && item.lectureIndex !== undefined && item.lectureIndex !== null) {
      const lecture = lectures[item.lectureIndex];
      if (!lecture) continue;
      let ordering = 0;

      // Video resource
      if (lecture.youtubeId || lecture.archiveUrl) {
        resources.push({
          course_id: course.id,
          section_id: sectionId,
          title: lecture.title,
          resource_type: "video",
          pdf_path: null,
          video_url: lecture.youtubeId ? `https://www.youtube.com/watch?v=${lecture.youtubeId}` : null,
          youtube_id: lecture.youtubeId,
          archive_url: lecture.archiveUrl,
          ordering: ordering++,
        });
      }

      // Matched lecture notes PDFs
      if (lecture.lectureNumber !== null) {
        const pdfs = lecturePdfMap.get(lecture.lectureNumber) ?? [];
        for (const pdf of pdfs) {
          resources.push({
            course_id: course.id,
            section_id: sectionId,
            title: pdfTitleByFilename.get(pdf) ?? pdf.replace(/\.pdf$/i, "").replace(/-/g, " "),
            resource_type: "lecture_notes",
            pdf_path: `/content/courses/${slug}/${pdf}`,
            video_url: null,
            youtube_id: null,
            archive_url: null,
            ordering: ordering++,
          });
        }
      }
    } else {
      // Non-lecture item (problem set, exam, recitation, etc.)
      const pdfFilenames = item.pdfFilenames ?? [];
      for (let j = 0; j < pdfFilenames.length; j++) {
        const pdf = pdfFilenames[j];
        const isSolution = pdf.toLowerCase().includes("sol");
        const resourceType = isSolution ? "solution" : item.type;
        resources.push({
          course_id: course.id,
          section_id: sectionId,
          title: pdfTitleByFilename.get(pdf) ?? pdf.replace(/\.pdf$/i, "").replace(/-/g, " "),
          resource_type: resourceType,
          pdf_path: `/content/courses/${slug}/${pdf}`,
          video_url: null,
          youtube_id: null,
          archive_url: null,
          ordering: j,
        });
      }
    }
  }

  console.log(`Found ${resources.length} resources (${resources.filter((r) => r.resource_type === "video").length} videos, ${resources.filter((r) => r.pdf_path).length} PDFs)`);

  // Insert resources
  if (resources.length > 0) {
    const { error: resourcesError } = await supabase
      .from("resources")
      .insert(resources);

    if (resourcesError) {
      console.error("Error inserting resources:", resourcesError);
      process.exit(1);
    }
    console.log(`Inserted ${resources.length} resources`);
  }

  // Mark course as downloaded
  const { error: updateError } = await supabase
    .from("courses")
    .update({
      content_downloaded: true,
      content_downloaded_at: new Date().toISOString(),
    })
    .eq("id", course.id);

  if (updateError) {
    console.error("Error updating course:", updateError);
  }

  // Clean up temp files
  console.log("Cleaning up temp files...");
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  console.log("Done!");
  console.log(`\nSummary:`);
  console.log(`  Course: ${course.title}`);
  console.log(`  Lectures: ${lectures.length}`);
  console.log(`  Resources: ${resources.length}`);
  console.log(`  PDFs copied: ${pdfCount}`);
}

// Main
const slug = process.argv[2];
if (!slug) {
  console.error("Usage: pnpm download-course <course-slug>");
  console.error("Example: pnpm download-course 6-006-introduction-to-algorithms-spring-2020");
  process.exit(1);
}

downloadCourse(slug).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
