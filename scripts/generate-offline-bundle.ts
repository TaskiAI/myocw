/**
 * generate-offline-bundle.ts
 *
 * Generates a fully offline-capable HTML bundle for a single course.
 * Math pre-rendered server-side — no JS needed to view content.
 * Videos referenced as local .mp4 files (user fills videos/ folder).
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/generate-offline-bundle.ts <course_id>
 *
 * Output:
 *   ./offline-bundles/course-<id>/
 *     index.html
 *     sections/<slug>.html
 *     videos/manifest.json   ← shows which .mp4 files to place here
 *     katex/katex.min.css + fonts/
 *     README.txt
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
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

  console.log("  Copied KaTeX assets");
}

async function main() {
  const courseIdArg = process.argv[2];
  if (!courseIdArg) {
    console.error("Usage: tsx scripts/generate-offline-bundle.ts <course_id>");
    process.exit(1);
  }

  const courseId = Number(courseIdArg);
  if (Number.isNaN(courseId)) {
    console.error("course_id must be a number");
    process.exit(1);
  }

  console.log(`Fetching course ${courseId}...`);

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
  console.log(`  ${course.title}`);

  const { data: sectionsData } = await supabase
    .from("course_sections")
    .select("id,title,slug,section_type,ordering,parent_id")
    .eq("course_id", courseId)
    .order("ordering");

  const sections = (sectionsData ?? []) as BundleSection[];
  console.log(`  ${sections.length} sections`);

  const { data: resourcesData } = await supabase
    .from("resources")
    .select("id,section_id,title,resource_type,youtube_id,content_text,ordering")
    .eq("course_id", courseId)
    .order("ordering");

  const resources = (resourcesData ?? []) as BundleResource[];
  console.log(`  ${resources.length} resources`);

  const { data: problemsData } = await supabase
    .from("problems")
    .select("id,resource_id,problem_label,question_text,solution_text,ordering")
    .eq("course_id", courseId)
    .order("ordering");

  const allProblems = (problemsData ?? []) as BundleProblem[];
  console.log(`  ${allProblems.length} problems`);

  const problemsByResource = new Map<number, BundleProblem[]>();
  for (const p of allProblems) {
    if (!problemsByResource.has(p.resource_id)) problemsByResource.set(p.resource_id, []);
    problemsByResource.get(p.resource_id)!.push(p);
  }

  const bundleDir = path.join(OUTPUT_BASE, `course-${courseId}`);
  const sectionsDir = path.join(bundleDir, "sections");
  const videosDir = path.join(bundleDir, "videos");

  fs.mkdirSync(sectionsDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });

  console.log(`\nWriting to ${bundleDir}`);

  copyKatexAssets(bundleDir);

  // Generate pages for every section (top-level + children)
  // Prev/next nav is scoped to siblings (same parent)
  const sectionsByParent = new Map<number | null, BundleSection[]>();
  for (const s of sections) {
    const key = s.parent_id ?? null;
    if (!sectionsByParent.has(key)) sectionsByParent.set(key, []);
    sectionsByParent.get(key)!.push(s);
  }

  let pagesWritten = 0;
  for (const [, siblings] of sectionsByParent) {
    const sorted = siblings.sort((a, b) => a.ordering - b.ordering);
    for (let idx = 0; idx < sorted.length; idx++) {
      const section = sorted[idx];
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

  console.log(`  Wrote ${pagesWritten} section pages`);

  fs.writeFileSync(
    path.join(bundleDir, "index.html"),
    renderIndexPage(course, sections),
    "utf-8"
  );
  console.log(`  Wrote index.html`);

  const videoIds = resources.filter((r) => r.youtube_id).map((r) => r.youtube_id!);

  fs.writeFileSync(
    path.join(bundleDir, "README.txt"),
    renderReadme(course, videoIds),
    "utf-8"
  );

  if (videoIds.length > 0) {
    const manifest = {
      course_id: courseId,
      course_title: course.title,
      videos: resources
        .filter((r) => r.youtube_id)
        .map((r) => ({
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
    console.log(`  Wrote videos/manifest.json (${videoIds.length} videos)`);
  }

  console.log(`\nDone. Open: ${path.join(bundleDir, "index.html")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
