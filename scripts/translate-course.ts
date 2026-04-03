import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Batch-translate a course's content into a target language.
 *
 * Usage:
 *   npx tsx scripts/translate-course.ts <course-id> --lang <Language>
 *
 * Example:
 *   npx tsx scripts/translate-course.ts 4794 --lang Spanish
 */

import { translateCourseContent } from "../lib/translate";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

async function main() {
  const args = process.argv.slice(2);
  const courseArg = args.find((a) => !a.startsWith("--"));
  const langArg = args.find((a) => a.startsWith("--lang="));
  const langFlag = args.indexOf("--lang");
  const language =
    langArg?.split("=")[1] ??
    (langFlag !== -1 ? args[langFlag + 1] : undefined);

  if (!courseArg || !language) {
    console.error("Usage: translate-course <course-id> --lang <Language>");
    console.error("Example: translate-course 4794 --lang Spanish");
    process.exit(1);
  }

  const courseId = Number(courseArg);
  if (Number.isNaN(courseId)) {
    console.error(`Invalid course id: ${courseArg}`);
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
    console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY");
    process.exit(1);
  }

  console.log(`Translating course ${courseId} → ${language}`);
  console.log();

  const { translated, cached } = await translateCourseContent(
    SUPABASE_URL,
    SUPABASE_KEY,
    GEMINI_API_KEY,
    courseId,
    language,
    (p) => {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      process.stdout.write(`\r  [${pct}%] ${p.done}/${p.total}${p.current ? ` — ${p.current}` : ""}`);
    }
  );

  console.log();
  console.log();
  console.log(`Done. ${translated} translated, ${cached} already cached.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
