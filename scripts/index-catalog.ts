import { createClient } from "@supabase/supabase-js";
import { downloadCourse } from "./download-course.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

interface CourseRow {
  id: number;
  title: string;
  url: string;
  content_downloaded: boolean | null;
}

interface CliOptions {
  limit: number;
  offset: number;
  includeDownloaded: boolean;
}

function parseCliOptions(argv: string[]): CliOptions {
  const args = [...argv];

  const getNumericFlag = (flag: string, fallback: number): number => {
    const idx = args.indexOf(flag);
    if (idx === -1) return fallback;

    const raw = args[idx + 1];
    if (!raw) {
      throw new Error(`Missing value for ${flag}`);
    }

    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid value for ${flag}: ${raw}`);
    }

    return parsed;
  };

  const limit = getNumericFlag("--limit", Number.POSITIVE_INFINITY);
  const offset = getNumericFlag("--offset", 0);
  const includeDownloaded = args.includes("--include-downloaded");

  return { limit, offset, includeDownloaded };
}

function getSlugFromUrl(url: string): string {
  return url.replace(/\/$/, "").split("/").pop() ?? "";
}

async function fetchCatalog(options: CliOptions): Promise<CourseRow[]> {
  let query = supabase
    .from("courses")
    .select("id,title,url,content_downloaded")
    .order("id", { ascending: true });

  if (!options.includeDownloaded) {
    query = query.or("content_downloaded.is.null,content_downloaded.eq.false");
  }

  if (options.offset > 0) {
    query = query.range(options.offset, options.offset + 200000);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch courses: ${error.message}`);
  }

  const rows = (data ?? []) as CourseRow[];

  if (options.limit !== Number.POSITIVE_INFINITY) {
    return rows.slice(0, options.limit);
  }

  return rows;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  console.log("=== Catalog Indexer ===");
  console.log(`include-downloaded=${options.includeDownloaded}`);
  console.log(`offset=${options.offset}`);
  console.log(`limit=${options.limit === Number.POSITIVE_INFINITY ? "none" : options.limit}`);

  const courses = await fetchCatalog(options);
  console.log(`Queued ${courses.length} course(s) for indexing`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    const slug = getSlugFromUrl(course.url);

    if (!slug) {
      console.error(`[${i + 1}/${courses.length}] SKIP: invalid course URL for id=${course.id}`);
      errorCount++;
      continue;
    }

    console.log(`\n[${i + 1}/${courses.length}] Indexing: ${course.title}`);
    console.log(`  slug=${slug} id=${course.id}`);

    try {
      await downloadCourse(slug);

      await supabase
        .from("courses")
        .update({ download_error: null })
        .eq("id", course.id);

      successCount++;
      console.log("  status=ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  status=error message=${message}`);

      await supabase
        .from("courses")
        .update({ download_error: message })
        .eq("id", course.id);

      errorCount++;
    }
  }

  console.log("\n=== Indexing Complete ===");
  console.log(`success=${successCount}`);
  console.log(`errors=${errorCount}`);
  console.log(`total=${courses.length}`);

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
