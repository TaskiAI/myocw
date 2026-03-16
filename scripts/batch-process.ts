import { createClient } from "@supabase/supabase-js";
import { downloadCourse } from "./download-course.js";
import { parseProblems } from "./parse-problems.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// Parse CLI flags
const args = process.argv.slice(2);
const skipDownload = args.includes("--skip-download");
const skipParse = args.includes("--skip-parse");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

function extractSlug(url: string): string {
  return url.replace(/\/$/, "").split("/").pop()!;
}

async function main() {
  console.log("=== Batch Process ===");
  console.log(`Options: skip-download=${skipDownload}, skip-parse=${skipParse}, limit=${limit === Infinity ? "none" : limit}`);

  // Fetch all courses with lecture videos, ordered by popularity
  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, url, content_downloaded, problems_parsed, has_problem_sets")
    .eq("has_lecture_videos", true)
    .order("views", { ascending: false });

  if (error) {
    console.error("Failed to fetch courses:", error.message);
    process.exit(1);
  }

  console.log(`Found ${courses.length} courses with lecture videos\n`);

  let processed = 0;

  // ── Download phase ──
  if (!skipDownload) {
    const toDownload = courses.filter((c) => !c.content_downloaded);
    const downloadCount = Math.min(toDownload.length, limit - processed);
    console.log(`Download phase: ${toDownload.length} courses need downloading (processing ${downloadCount})\n`);

    for (let i = 0; i < downloadCount; i++) {
      if (processed >= limit) break;
      const course = toDownload[i];
      const slug = extractSlug(course.url);
      console.log(`[${i + 1}/${downloadCount}] Downloading: ${course.title}`);

      try {
        await downloadCourse(slug);
        // Clear any previous error
        await supabase
          .from("courses")
          .update({ download_error: null })
          .eq("id", course.id);
        console.log(`  Done\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${message}\n`);
        await supabase
          .from("courses")
          .update({ download_error: message })
          .eq("id", course.id);
      }

      processed++;
    }
  }

  // ── Parse phase ──
  if (!skipParse) {
    // Re-fetch to get updated content_downloaded state
    const { data: freshCourses, error: freshError } = await supabase
      .from("courses")
      .select("id, title, url, content_downloaded, problems_parsed, has_problem_sets")
      .eq("has_lecture_videos", true)
      .eq("content_downloaded", true)
      .eq("has_problem_sets", true)
      .or("problems_parsed.is.null,problems_parsed.eq.false")
      .order("views", { ascending: false });

    if (freshError) {
      console.error("Failed to fetch courses for parsing:", freshError.message);
      process.exit(1);
    }

    const toParse = freshCourses ?? [];
    const parseCount = Math.min(toParse.length, limit - processed);
    console.log(`Parse phase: ${toParse.length} courses need parsing (processing ${parseCount})\n`);

    for (let i = 0; i < parseCount; i++) {
      if (processed >= limit) break;
      const course = toParse[i];
      const slug = extractSlug(course.url);
      console.log(`[${i + 1}/${parseCount}] Parsing: ${course.title}`);

      try {
        await parseProblems(slug);
        await supabase
          .from("courses")
          .update({
            problems_parsed: true,
            problems_parsed_at: new Date().toISOString(),
            parse_error: null,
          })
          .eq("id", course.id);
        console.log(`  Done\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${message}\n`);
        await supabase
          .from("courses")
          .update({ parse_error: message })
          .eq("id", course.id);
      }

      processed++;
    }
  }

  console.log(`\n=== Batch complete. Processed ${processed} courses. ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
