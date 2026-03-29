import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const STORAGE_BUCKET = "mit-ocw";
const STORAGE_PREFIX = "courses";

async function listAllStorageObjects(): Promise<string[]> {
  const allPaths: string[] = [];

  // List top-level entries under courses/ (one folder per course slug)
  const { data: topLevel, error: topError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(STORAGE_PREFIX, { limit: 1000 });

  if (topError) {
    throw new Error(`Failed to list storage top-level: ${topError.message}`);
  }

  for (const entry of topLevel ?? []) {
    if (entry.id) {
      // Direct file at courses/ level
      allPaths.push(`${STORAGE_PREFIX}/${entry.name}`);
    } else {
      // Folder — list its contents
      const folderPath = `${STORAGE_PREFIX}/${entry.name}`;
      const { data: files, error: filesError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(folderPath, { limit: 10000 });

      if (filesError) {
        console.warn(`  Warning: failed to list ${folderPath}: ${filesError.message}`);
        continue;
      }

      for (const file of files ?? []) {
        if (file.id) {
          allPaths.push(`${folderPath}/${file.name}`);
        }
      }
    }
  }

  return allPaths;
}

async function deleteInBatches(paths: string[], batchSize = 100): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(batch);
    if (error) {
      throw new Error(`Failed to delete storage batch at index ${i}: ${error.message}`);
    }
    deleted += batch.length;
    console.log(`  Deleted ${deleted}/${paths.length} objects...`);
  }
  return deleted;
}

async function main() {
  console.log("=== Wipe Content ===");
  console.log("Deletes all course content from storage and database, then resets course flags.\n");

  // Step 1: Wipe storage
  console.log("[Step 1] Listing storage objects...");
  const allPaths = await listAllStorageObjects();
  console.log(`  Found ${allPaths.length} objects`);

  if (allPaths.length > 0) {
    console.log("[Step 1] Deleting in batches of 100...");
    const deleted = await deleteInBatches(allPaths);
    console.log(`[Step 1] Deleted ${deleted} storage objects\n`);
  } else {
    console.log("[Step 1] No storage objects found — skipping\n");
  }

  // Step 2: Clear DB content rows
  console.log("[Step 2] Deleting all resources...");
  const { error: resourcesError } = await supabase
    .from("resources")
    .delete()
    .gte("id", 0);
  if (resourcesError) throw new Error(`Failed to delete resources: ${resourcesError.message}`);

  console.log("[Step 2] Deleting all course_sections...");
  const { error: sectionsError } = await supabase
    .from("course_sections")
    .delete()
    .gte("id", 0);
  if (sectionsError) throw new Error(`Failed to delete course_sections: ${sectionsError.message}`);

  console.log("[Step 2] Database content cleared\n");

  // Step 3: Reset course flags
  console.log("[Step 3] Resetting course download flags...");
  const { error: updateError } = await supabase
    .from("courses")
    .update({
      content_downloaded: false,
      content_downloaded_at: null,
      download_error: null,
    })
    .gte("id", 0);
  if (updateError) throw new Error(`Failed to reset course flags: ${updateError.message}`);

  console.log("[Step 3] Course flags reset\n");
  console.log("=== Wipe complete ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
