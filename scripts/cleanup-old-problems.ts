/**
 * cleanup-old-problems.ts
 *
 * Deletes old model problems (from parse-problems.ts / Qwen/OpenAI) that lack
 * interactive tags. These have label "N", broken LaTeX, and no interactivity.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/cleanup-old-problems.ts <course_id> [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const courseIdArg = args.find((a) => !a.startsWith("--"));

  if (!courseIdArg) {
    console.error("Usage: pnpm tsx scripts/cleanup-old-problems.ts <course_id> [--dry-run]");
    process.exit(1);
  }

  const courseId = Number(courseIdArg);
  if (Number.isNaN(courseId)) {
    console.error("course_id must be a number");
    process.exit(1);
  }

  if (dryRun) console.log("[DRY RUN] No deletions will be made.\n");

  // Count totals
  const { count: totalCount } = await supabase
    .from("problems")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);

  console.log(`Course ${courseId}: ${totalCount ?? 0} total problems`);

  // Find old problems: no interactive tags in question_text
  const { data: oldProblems, error } = await supabase
    .from("problems")
    .select("id, resource_id, problem_label, question_text, created_at")
    .eq("course_id", courseId)
    .not("question_text", "like", "%<FillInBlank %")
    .not("question_text", "like", "%<MultipleChoice %")
    .not("question_text", "like", "%<FreeResponse %");

  if (error) {
    console.error("Error fetching problems:", error.message);
    process.exit(1);
  }

  if (!oldProblems?.length) {
    console.log("No old problems found. Nothing to delete.");
    return;
  }

  console.log(`Found ${oldProblems.length} old problems (no interactive tags)\n`);

  // Group by resource for readability
  const byResource = new Map<number, typeof oldProblems>();
  for (const p of oldProblems) {
    if (!byResource.has(p.resource_id)) byResource.set(p.resource_id, []);
    byResource.get(p.resource_id)!.push(p);
  }

  for (const [resourceId, problems] of byResource) {
    console.log(`  resource_id=${resourceId}: ${problems.length} problems`);
    for (const p of problems) {
      const preview = p.question_text.slice(0, 80).replace(/\n/g, " ");
      console.log(`    [${p.id}] label="${p.problem_label}" — ${preview}…`);
    }
  }

  const keepCount = (totalCount ?? 0) - oldProblems.length;
  console.log(`\n${oldProblems.length} to delete, ${keepCount} to keep`);

  if (dryRun) {
    console.log("\nRe-run without --dry-run to delete.");
    return;
  }

  const ids = oldProblems.map((p) => p.id);
  const { error: deleteError } = await supabase
    .from("problems")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("Deletion failed:", deleteError.message);
    process.exit(1);
  }

  console.log(`\nDeleted ${ids.length} old problems.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
