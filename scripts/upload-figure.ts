import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const STORAGE_BUCKET = "mit-ocw";

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: upload-figure <name>");
    console.error("Example: upload-figure session1-fig3");
    console.error("\nCopy an image to clipboard (Cmd+C or screenshot), then run this.");
    process.exit(1);
  }

  // Grab clipboard image via pngpaste
  const tmpPath = `/tmp/myocw-figure-${Date.now()}.png`;
  try {
    execSync(`pngpaste "${tmpPath}"`, { stdio: "pipe" });
  } catch {
    console.error("No image found in clipboard. Copy an image first (screenshot, Cmd+C, etc).");
    process.exit(1);
  }

  const buffer = fs.readFileSync(tmpPath);
  const slug = "18-06sc-linear-algebra-fall-2011";
  const objectPath = `courses/${slug}/figures/${name}.png`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, buffer, {
      contentType: "image/png",
      upsert: true,
    });

  fs.unlinkSync(tmpPath);

  if (error) {
    console.error("Upload failed:", error.message);
    process.exit(1);
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
  console.log(`\n![${name}](${url})\n`);
}

main();
