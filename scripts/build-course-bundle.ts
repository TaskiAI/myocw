/**
 * build-course-bundle.ts
 *
 * Full offline bundle pipeline:
 *   1. Generate HTML bundle (reuses generate-offline-bundle logic)
 *   2. Download + compress each video via yt-dlp | ffmpeg
 *   3. Zip the bundle directory
 *   4. Upload zip to Supabase Storage: offline-bundles/course-{id}.zip
 *   5. Update courses.offline_bundle_url
 *
 * Usage:
 *   pnpm build-bundle <course_id>
 *
 * Requirements: yt-dlp and ffmpeg must be in PATH
 */

import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  renderIndexPage,
  renderSectionPage,
  renderReadme,
  type BundleCourse,
  type BundleSection,
  type BundleResource,
  type BundleProblem,
} from "../lib/offline-bundle.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const OUTPUT_BASE = path.resolve("./offline-bundles");
const KATEX_DIST = path.resolve("node_modules/katex/dist");
const STORAGE_BUCKET = "mit-ocw";

// ffmpeg compression flags (from compress_lecture.sh)
const FFMPEG_VIDEO_FLAGS = [
  "-c:v", "libx264",
  "-crf", "35",
  "-preset", "fast",
  "-vf", "scale=640:-2,fps=15",
  "-c:a", "aac",
  "-b:a", "32k",
  "-ac", "1",
];

function copyKatexAssets(destDir: string) {
  const katexDir = path.join(destDir, "katex");
  const fontsDir = path.join(katexDir, "fonts");
  fs.mkdirSync(fontsDir, { recursive: true });

  fs.copyFileSync(
    path.join(KATEX_DIST, "katex.min.css"),
    path.join(katexDir, "katex.min.css")
  );

  for (const file of fs.readdirSync(path.join(KATEX_DIST, "fonts"))) {
    if (file.endsWith(".woff2") || file.endsWith(".woff") || file.endsWith(".ttf")) {
      fs.copyFileSync(
        path.join(KATEX_DIST, "fonts", file),
        path.join(fontsDir, file)
      );
    }
  }
}

function downloadAndCompressVideo(youtubeId: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://youtube.com/watch?v=${youtubeId}`;

    // yt-dlp writes to stdout, ffmpeg reads from stdin (pipe:0)
    const ytdlp = spawn("yt-dlp", [
      "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4",
      "--no-playlist",
      "-o", "-",
      ytUrl,
    ]);

    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      ...FFMPEG_VIDEO_FLAGS,
      "-y",
      outputPath,
    ]);

    ytdlp.stdout.pipe(ffmpeg.stdin);

    let ytdlpErr = "";
    ytdlp.stderr.on("data", (d: Buffer) => { ytdlpErr += d.toString(); });

    let ffmpegErr = "";
    ffmpeg.stderr.on("data", (d: Buffer) => { ffmpegErr += d.toString(); });

    ytdlp.on("error", (err) => reject(new Error(`yt-dlp error: ${err.message}`)));
    ffmpeg.on("error", (err) => reject(new Error(`ffmpeg error: ${err.message}`)));

    ytdlp.on("close", (code) => {
      if (code !== 0) {
        ffmpeg.stdin.destroy();
        reject(new Error(`yt-dlp exited ${code}: ${ytdlpErr.slice(-500)}`));
      }
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${ffmpegErr.slice(-500)}`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const skipVideos = args.includes("--skip-videos");
  const courseIdArg = args.find((a) => !a.startsWith("--"));
  if (!courseIdArg) {
    console.error("Usage: pnpm build-bundle <course_id> [--skip-videos]");
    process.exit(1);
  }

  const courseId = Number(courseIdArg);
  if (Number.isNaN(courseId)) {
    console.error("course_id must be a number");
    process.exit(1);
  }

  console.log(`\n=== Building offline bundle for course ${courseId} ===\n`);

  // 1. Fetch course data
  const { data: courseData, error: courseErr } = await supabase
    .from("courses")
    .select("id,title,url,departments,topics")
    .eq("id", courseId)
    .single();

  if (courseErr || !courseData) {
    console.error("Course not found:", courseErr?.message);
    process.exit(1);
  }

  const course = courseData as BundleCourse;
  console.log(`Course: ${course.title}`);

  const [{ data: sectionsData }, { data: resourcesData }, { data: problemsData }] =
    await Promise.all([
      supabase
        .from("course_sections")
        .select("id,title,slug,section_type,ordering,parent_id")
        .eq("course_id", courseId)
        .order("ordering"),
      supabase
        .from("resources")
        .select("id,section_id,title,resource_type,youtube_id,content_text,ordering")
        .eq("course_id", courseId)
        .order("ordering"),
      supabase
        .from("problems")
        .select("id,resource_id,problem_label,question_text,solution_text,ordering")
        .eq("course_id", courseId)
        .order("ordering"),
    ]);

  const sections = (sectionsData ?? []) as BundleSection[];
  const resources = (resourcesData ?? []) as BundleResource[];
  const allProblems = (problemsData ?? []) as BundleProblem[];

  console.log(`  ${sections.length} sections, ${resources.length} resources, ${allProblems.length} problems`);

  const problemsByResource = new Map<number, BundleProblem[]>();
  for (const p of allProblems) {
    if (!problemsByResource.has(p.resource_id)) problemsByResource.set(p.resource_id, []);
    problemsByResource.get(p.resource_id)!.push(p);
  }

  // 2. Generate HTML bundle on disk
  const bundleDir = path.join(OUTPUT_BASE, `course-${courseId}`);
  const sectionsDir = path.join(bundleDir, "sections");
  const videosDir = path.join(bundleDir, "videos");

  fs.mkdirSync(sectionsDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });

  console.log(`\nGenerating HTML bundle → ${bundleDir}`);

  copyKatexAssets(bundleDir);

  const sectionsByParent = new Map<number | null, BundleSection[]>();
  for (const s of sections) {
    const key = s.parent_id ?? null;
    if (!sectionsByParent.has(key)) sectionsByParent.set(key, []);
    sectionsByParent.get(key)!.push(s);
  }

  // Skip generating pages for units (sections with children) — they are not linked
  const hasChildren = new Set(
    sections.filter((s) => sections.some((c) => c.parent_id === s.id)).map((s) => s.id)
  );

  let pagesWritten = 0;
  for (const [, siblings] of sectionsByParent) {
    const sorted = siblings.sort((a, b) => a.ordering - b.ordering);
    for (let idx = 0; idx < sorted.length; idx++) {
      const section = sorted[idx];
      if (hasChildren.has(section.id)) continue; // unit pages are not linked
      const html = renderSectionPage(
        course,
        section,
        sections,
        resources,
        problemsByResource,
        sorted[idx - 1] ?? null,
        sorted[idx + 1] ?? null
      );
      fs.writeFileSync(path.join(sectionsDir, `${section.slug}.html`), html, "utf-8");
      pagesWritten++;
    }
  }

  fs.writeFileSync(path.join(bundleDir, "index.html"), renderIndexPage(course, sections), "utf-8");

  const videoResources = resources.filter((r) => r.youtube_id);
  const videoIds = videoResources.map((r) => r.youtube_id!);

  fs.writeFileSync(path.join(bundleDir, "README.txt"), renderReadme(course, videoIds), "utf-8");

  if (videoIds.length > 0) {
    const manifest = {
      course_id: courseId,
      course_title: course.title,
      videos: videoResources.map((r) => ({
        title: r.title,
        youtube_id: r.youtube_id,
        filename: `${r.youtube_id}.mp4`,
        youtube_url: `https://youtube.com/watch?v=${r.youtube_id}`,
      })),
    };
    fs.writeFileSync(
      path.join(videosDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
  }

  console.log(`  ${pagesWritten} section pages written`);

  // 3. Download + compress videos
  if (skipVideos) {
    console.log(`\nSkipping video downloads (--skip-videos)`);
  } else if (videoResources.length > 0) {
    console.log(`\nDownloading and compressing ${videoResources.length} videos...`);

    for (let i = 0; i < videoResources.length; i++) {
      const resource = videoResources[i];
      const youtubeId = resource.youtube_id!;
      const outputPath = path.join(videosDir, `${youtubeId}.mp4`);

      if (fs.existsSync(outputPath)) {
        console.log(`  [${i + 1}/${videoResources.length}] Skipping (already exists): ${resource.title}`);
        continue;
      }

      console.log(`  [${i + 1}/${videoResources.length}] Downloading: ${resource.title}`);

      try {
        await downloadAndCompressVideo(youtubeId, outputPath);
        const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
        console.log(`    Done — ${sizeMB} MB`);
      } catch (err) {
        console.error(`    FAILED: ${err instanceof Error ? err.message : err}`);
        // Remove partial file if it exists
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }
    }
  }

  // 4. Zip the bundle directory
  console.log(`\nZipping bundle...`);
  const zip = new AdmZip();
  zip.addLocalFolder(bundleDir, `course-${courseId}`);
  const zipBuffer = zip.toBuffer();
  console.log(`  Zip size: ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // 5. Upload to Supabase Storage
  const storagePath = `offline-bundles/course-${courseId}.zip`;
  console.log(`\nUploading to Supabase Storage: ${storagePath}`);

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, zipBuffer, {
      contentType: "application/zip",
      upsert: true,
    });

  if (uploadErr) {
    console.error("Upload failed:", uploadErr.message);
    process.exit(1);
  }

  const { data: publicUrlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData.publicUrl;
  console.log(`  Uploaded: ${publicUrl}`);

  // 6. Update courses table
  const { error: updateErr } = await supabase
    .from("courses")
    .update({ offline_bundle_url: publicUrl })
    .eq("id", courseId);

  if (updateErr) {
    console.error("Failed to update courses table:", updateErr.message);
    process.exit(1);
  }

  console.log(`\n=== Done ===`);
  console.log(`Bundle URL: ${publicUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
