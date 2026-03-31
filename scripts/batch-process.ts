import { createClient } from "@supabase/supabase-js";
import { downloadCourse } from "./download-course.js";
import { CURRICULA_TRACKS } from "../lib/data/curricula.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// Parse CLI flags
const args = process.argv.slice(2);
const skipDownload = args.includes("--skip-download");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// Deduplicated set of all curricula URL paths across both tracks
const curriculaUrlPaths = new Set<string>(
  CURRICULA_TRACKS.flatMap((track) => track.courses.map((c) => c.urlPath))
);

function extractSlug(url: string): string {
  return url.replace(/\/$/, "").split("/").pop()!;
}

async function main() {
  console.log("=== Batch Process ===");
  console.log(`Curricula scope: ${curriculaUrlPaths.size} unique courses across ${CURRICULA_TRACKS.length} tracks`);
  console.log(`Options: skip-download=${skipDownload}, limit=${limit === Infinity ? "none" : limit}`);

  // Query directly for curricula courses by URL pattern
  const urlFilters = [...curriculaUrlPaths].map((p) => `url.ilike.%${p}%`).join(",");
  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, url, content_downloaded, problems_parsed, has_problem_sets, download_error")
    .or(urlFilters);

  if (error) {
    console.error("Failed to fetch courses:", error.message);
    process.exit(1);
  }

  const matchedCourses = courses ?? [];
  console.log(`Found ${matchedCourses.length} curricula courses\n`);

  let processed = 0;

  // ── Download phase ──
  if (!skipDownload) {
    const toDownload = matchedCourses.filter((c) => !c.content_downloaded && !c.download_error);
    const downloadCount = Math.min(toDownload.length, limit - processed);
    console.log(`Download phase: ${toDownload.length} courses need downloading (processing ${downloadCount})\n`);

    for (let i = 0; i < downloadCount; i++) {
      if (processed >= limit) break;
      const course = toDownload[i];
      const slug = extractSlug(course.url);
      console.log(`[${i + 1}/${downloadCount}] Downloading: ${course.title}`);

      try {
        await downloadCourse(slug);
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

  console.log(`\n=== Batch complete. Downloaded ${processed} courses. ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
