import { createClient } from "@supabase/supabase-js";
import { parseProblems } from "./parse-problems.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

interface CourseRow {
  id: number;
  title: string;
  url: string;
  content_downloaded: boolean | null;
  has_problem_sets: boolean | null;
  problems_parsed: boolean | null;
}

interface CliOptions {
  limit: number;
  offset: number;
  includeParsed: boolean;
  forceReparse: boolean;
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

  return {
    limit: getNumericFlag("--limit", Number.POSITIVE_INFINITY),
    offset: getNumericFlag("--offset", 0),
    includeParsed: args.includes("--include-parsed"),
    forceReparse: args.includes("--force-reparse"),
  };
}

function slugFromUrl(url: string): string {
  return url.replace(/\/$/, "").split("/").pop() ?? "";
}

async function fetchCourses(options: CliOptions): Promise<CourseRow[]> {
  let query = supabase
    .from("courses")
    .select("id,title,url,content_downloaded,has_problem_sets,problems_parsed")
    .eq("content_downloaded", true)
    .eq("has_problem_sets", true)
    .order("id", { ascending: true });

  if (!options.includeParsed) {
    query = query.or("problems_parsed.is.null,problems_parsed.eq.false");
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

  console.log("=== Problem Catalog Parser ===");
  console.log(`include-parsed=${options.includeParsed}`);
  console.log(`force-reparse=${options.forceReparse}`);
  console.log(`offset=${options.offset}`);
  console.log(`limit=${options.limit === Number.POSITIVE_INFINITY ? "none" : options.limit}`);

  const courses = await fetchCourses(options);
  console.log(`Queued ${courses.length} course(s)`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    const slug = slugFromUrl(course.url);

    if (!slug) {
      console.error(`[${i + 1}/${courses.length}] SKIP: invalid URL for id=${course.id}`);
      errorCount++;
      continue;
    }

    console.log(`\n[${i + 1}/${courses.length}] Parsing: ${course.title}`);
    console.log(`  id=${course.id} slug=${slug}`);

    try {
      await parseProblems(slug, { forceReparse: options.forceReparse });

      await supabase
        .from("courses")
        .update({
          problems_parsed: true,
          problems_parsed_at: new Date().toISOString(),
          parse_error: null,
        })
        .eq("id", course.id);

      successCount++;
      console.log("  status=ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  status=error message=${message}`);

      await supabase
        .from("courses")
        .update({ parse_error: message })
        .eq("id", course.id);

      errorCount++;
    }
  }

  console.log("\n=== Problem Parsing Complete ===");
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
