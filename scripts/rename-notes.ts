import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function main() {
  const { data: resources, error } = await supabase
    .from("resources")
    .select("id, title, resource_type, course_id")
    .eq("resource_type", "lecture_notes");

  if (error) {
    console.error("Failed to fetch resources:", error);
    process.exit(1);
  }

  const toRename = resources.filter((r) => r.title !== "Lecture Notes");

  console.log(`Found ${resources.length} lecture_notes resources, ${toRename.length} need renaming`);

  if (toRename.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Show a sample
  for (const r of toRename.slice(0, 10)) {
    console.log(`  [${r.id}] "${r.title}" → "Lecture Notes"`);
  }
  if (toRename.length > 10) {
    console.log(`  ... and ${toRename.length - 10} more`);
  }

  const ids = toRename.map((r) => r.id);
  const { error: updateError, count } = await supabase
    .from("resources")
    .update({ title: "Lecture Notes" }, { count: "exact" })
    .in("id", ids);

  if (updateError) {
    console.error("Update failed:", updateError);
    process.exit(1);
  }

  console.log(`Renamed ${count} resources to "Lecture Notes".`);
}

main();
