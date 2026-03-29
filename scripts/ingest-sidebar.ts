import { createClient } from "@supabase/supabase-js";
import * as readline from "readline";
import fs from "fs";
import path from "path";
import { CURRICULA_TRACKS } from "../lib/data/curricula.js";

// --- Config ---

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const STORAGE_BUCKET = "mit-ocw";
const STORAGE_PREFIX = "courses";
const TMP_DIR = "/tmp/myocw-sidebar-ingest";

// --- Utilities ---

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || "item";
}

function titleToFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) + ".pdf"
  );
}

function buildStoragePublicUrl(objectPath: string): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}

function inferSectionType(title: string): string {
  const lower = title.toLowerCase();
  if (/\b(problem\s*set|pset|assignment|homework)\b/.test(lower)) return "problem_set";
  if (/\b(exam|midterm|final|quiz)\b/.test(lower)) return "exam";
  if (/\b(recitation)\b/.test(lower)) return "recitation";
  return "lecture";
}

function inferResourceType(title: string, isVideo: boolean): string {
  if (isVideo) return "video";
  const lower = title.toLowerCase();
  if (/\b(solution|answers|soln)\b/.test(lower)) return "solution";
  if (/\b(problem\s*set|pset|assignment|homework)\b/.test(lower)) return "problem_set";
  if (/\b(exam|midterm|final|quiz)\b/.test(lower)) return "exam";
  if (/\b(recitation)\b/.test(lower)) return "recitation";
  return "lecture_notes";
}

const YOUTUBE_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;

function extractYoutubeId(url: string): string | null {
  const m = url.match(YOUTUBE_RE);
  return m ? m[1] : null;
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

// --- Readline helper ---

function createAsk(rl: readline.Interface): (prompt: string) => Promise<string | null> {
  let closed = false;
  rl.on("close", () => { closed = true; });

  return (prompt: string) => {
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer));
    });
  };
}

// --- PDF download + upload ---

async function downloadAndUploadPdf(
  pdfUrl: string,
  title: string,
  courseSlug: string,
): Promise<string> {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const filename = titleToFilename(title);
  const tmpPath = path.join(TMP_DIR, filename);

  // Download
  const resp = await fetch(pdfUrl);
  if (!resp.ok) throw new Error(`Failed to download PDF: ${resp.status} ${resp.statusText}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(tmpPath, buffer);

  // Upload to Supabase storage
  const objectPath = `${STORAGE_PREFIX}/${courseSlug}/${filename}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, fs.readFileSync(tmpPath), {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  // Cleanup
  fs.unlinkSync(tmpPath);

  return buildStoragePublicUrl(objectPath);
}

// --- Build deduplicated course list ---

interface CourseEntry {
  slug: string;
  courseNumber: string;
  title: string;
}

function buildCourseList(): CourseEntry[] {
  const seen = new Set<string>();
  const courses: CourseEntry[] = [];

  for (const track of CURRICULA_TRACKS) {
    for (const c of track.courses) {
      const slug = c.urlPath.replace(/^\/courses\//, "");
      if (seen.has(slug)) continue;
      seen.add(slug);
      courses.push({ slug, courseNumber: c.courseNumber, title: c.title });
    }
  }

  return courses;
}

// --- Collected item types ---

interface CollectedItem {
  title: string;
  isVideo: boolean;
  youtubeId: string | null;
  pdfUrl: string | null;
}

// --- Main ---

async function main() {
  const courses = buildCourseList();
  const total = courses.length;

  console.log(`\nManual sidebar ingestion for ${total} courses.\n`);
  console.log(`For each course, provide YouTube or PDF links. Type "DONE" to finish a course.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = createAsk(rl);

  for (let i = 0; i < courses.length; i++) {
    const entry = courses[i];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Course ${i + 1}/${total}: ${entry.title} (${entry.courseNumber})`);
    console.log(`${"=".repeat(60)}`);

    // Look up course in DB
    const { data: course, error: lookupErr } = await supabase
      .from("courses")
      .select("id, title, url")
      .ilike("url", `%${entry.slug}%`)
      .single();

    if (lookupErr || !course) {
      console.log(`  ⚠ Course not found in DB, skipping.`);
      continue;
    }

    // Check existing content
    const { count: existingCount } = await supabase
      .from("course_sections")
      .select("*", { count: "exact", head: true })
      .eq("course_id", course.id);

    let startOrdering = 0;

    if (existingCount && existingCount > 0) {
      console.log(`  Has ${existingCount} existing sections.`);
      const action = await ask("  [S]kip / [R]e-do / [A]ppend? ");
      if (action === null) { rl.close(); return; }

      const choice = action.trim().toLowerCase();
      if (choice === "s" || choice === "skip") {
        console.log("  Skipped.");
        continue;
      } else if (choice === "r" || choice === "re-do" || choice === "redo") {
        await supabase.from("resources").delete().eq("course_id", course.id);
        await supabase.from("course_sections").delete().eq("course_id", course.id);
        console.log("  Cleared existing content.");
      } else if (choice === "a" || choice === "append") {
        const { data: maxRow } = await supabase
          .from("course_sections")
          .select("ordering")
          .eq("course_id", course.id)
          .order("ordering", { ascending: false })
          .limit(1)
          .single();
        startOrdering = (maxRow?.ordering ?? 0) + 1;
        console.log(`  Appending from position ${startOrdering}.`);
      } else {
        console.log("  Unrecognized, skipping.");
        continue;
      }
    }

    // Collect links
    const items: CollectedItem[] = [];
    let linkNum = 1;

    while (true) {
      const link = await ask(`  Link ${linkNum}: `);
      if (link === null) break; // Ctrl-D

      const trimmed = link.trim();
      if (!trimmed || trimmed.toUpperCase() === "DONE") break;

      // Detect type
      const youtubeId = extractYoutubeId(trimmed);
      const isPdf = isPdfUrl(trimmed);

      if (!youtubeId && !isPdf) {
        console.log("    ⚠ Not a YouTube or PDF link. Try again.");
        continue;
      }

      // Ask for title
      const titleInput = await ask("  Title: ");
      if (titleInput === null) break;
      const title = titleInput.trim();
      if (!title) {
        console.log("    ⚠ Title required. Skipping this link.");
        continue;
      }

      if (youtubeId) {
        items.push({ title, isVideo: true, youtubeId, pdfUrl: null });
        console.log(`    ✓ Video: ${title}`);
      } else {
        try {
          const pdfUrl = await downloadAndUploadPdf(trimmed, title, entry.slug);
          items.push({ title, isVideo: false, youtubeId: null, pdfUrl });
          console.log(`    ✓ PDF uploaded: ${title}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`    ✗ PDF failed: ${msg}`);
          continue;
        }
      }

      linkNum++;
    }

    if (items.length === 0) {
      console.log("  No links provided, moving on.");
      continue;
    }

    // Persist to DB
    const sectionRows = items.map((item, idx) => ({
      course_id: course.id,
      title: item.title,
      slug: slugify(item.title),
      section_type: item.isVideo ? "lecture" : inferSectionType(item.title),
      ordering: startOrdering + idx,
    }));

    const { data: insertedSections, error: secErr } = await supabase
      .from("course_sections")
      .insert(sectionRows)
      .select("id, ordering");

    if (secErr || !insertedSections) {
      console.log(`  ✗ Failed to insert sections: ${secErr?.message}`);
      continue;
    }

    const sectionIdByOrdering = new Map<number, number>();
    for (const row of insertedSections) {
      sectionIdByOrdering.set(row.ordering, row.id);
    }

    const resourceRows = items.map((item, idx) => ({
      course_id: course.id,
      section_id: sectionIdByOrdering.get(startOrdering + idx) ?? null,
      title: item.title,
      resource_type: inferResourceType(item.title, item.isVideo),
      pdf_path: item.pdfUrl,
      video_url: item.youtubeId ? `https://www.youtube.com/watch?v=${item.youtubeId}` : null,
      youtube_id: item.youtubeId,
      archive_url: null,
      content_text: null,
      ordering: 0,
    }));

    const { error: resErr } = await supabase.from("resources").insert(resourceRows);

    if (resErr) {
      console.log(`  ✗ Failed to insert resources: ${resErr.message}`);
    } else {
      console.log(`  ✓ Saved ${items.length} sections and ${items.length} resources.`);
    }
  }

  rl.close();

  // Cleanup tmp dir
  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
