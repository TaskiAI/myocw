/**
 * GET /api/courses/[id]/download
 *
 * Generates an offline HTML bundle for the course and returns it as a .zip file.
 * Math is pre-rendered server-side — no React or CDN needed to view the content.
 *
 * The zip contains:
 *   index.html
 *   sections/<slug>.html
 *   videos/manifest.json   (which .mp4 files to add for offline video)
 *   katex/katex.min.css + fonts/
 *   README.txt
 */

export const runtime = "nodejs";

import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import {
  renderIndexPage,
  renderSectionPage,
  renderReadme,
  type BundleCourse,
  type BundleSection,
  type BundleResource,
  type BundleProblem,
} from "@/lib/offline-bundle";
import { LANGUAGES, RTL_LANGUAGES } from "@/lib/languages";

const KATEX_DIST = path.resolve("node_modules/katex/dist");

function buildSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const courseId = Number(id);

  if (Number.isNaN(courseId)) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  const supabase = buildSupabase();

  const { data: courseData, error: courseErr } = await supabase
    .from("courses")
    .select("id,title,url,departments,topics,offline_bundle_url")
    .eq("id", courseId)
    .single();

  if (courseErr || !courseData) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // If a pre-built bundle exists, redirect to it immediately
  if ((courseData as { offline_bundle_url?: string }).offline_bundle_url) {
    return NextResponse.redirect(
      (courseData as { offline_bundle_url: string }).offline_bundle_url,
      302
    );
  }

  const course = courseData as BundleCourse;

  const [
    { data: sectionsData },
    { data: resourcesData },
    { data: problemsData },
  ] = await Promise.all([
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

  // Parse ?lang= param for translated downloads
  const url = new URL(req.url);
  const langParam = url.searchParams.get("lang");
  const isTranslated = langParam && langParam !== "English" && langParam in LANGUAGES;
  const langCode = isTranslated ? LANGUAGES[langParam] : "en";
  const dir = isTranslated && RTL_LANGUAGES.has(langParam) ? "rtl" : "ltr";

  // If a language is requested, fetch cached translations and substitute
  if (isTranslated) {
    const { data: translations } = await supabase
      .from("content_translations")
      .select("source_table, source_id, field_name, translated_text")
      .eq("language", langParam)
      .in("source_table", ["problems", "resources"]);

    const txMap = new Map<string, string>();
    for (const t of translations ?? []) {
      txMap.set(`${t.source_table}:${t.source_id}:${t.field_name}`, t.translated_text);
    }

    // Substitute problem text
    for (const p of allProblems) {
      p.question_text = txMap.get(`problems:${p.id}:question_text`) ?? p.question_text;
      p.solution_text = txMap.get(`problems:${p.id}:solution_text`) ?? p.solution_text;
    }

    // Substitute resource content_text
    for (const r of resources) {
      if (r.content_text) {
        r.content_text = txMap.get(`resources:${r.id}:content_text`) ?? r.content_text;
      }
    }
  }

  const problemsByResource = new Map<number, BundleProblem[]>();
  for (const p of allProblems) {
    if (!problemsByResource.has(p.resource_id)) problemsByResource.set(p.resource_id, []);
    problemsByResource.get(p.resource_id)!.push(p);
  }

  const videoIds = resources.filter((r) => r.youtube_id).map((r) => r.youtube_id!);

  // Build zip in memory
  const zip = new AdmZip();
  const base = `course-${courseId}`;

  // index.html
  zip.addFile(
    `${base}/index.html`,
    Buffer.from(renderIndexPage(course, sections, langCode, dir), "utf-8")
  );

  // Generate pages for every section, prev/next scoped to siblings
  const sectionsByParent = new Map<number | null, typeof sections>();
  for (const s of sections) {
    const key = s.parent_id ?? null;
    if (!sectionsByParent.has(key)) sectionsByParent.set(key, []);
    sectionsByParent.get(key)!.push(s);
  }

  // Skip generating pages for units (sections with children) — they are not linked
  const hasChildren = new Set(
    sections.filter((s) => sections.some((c) => c.parent_id === s.id)).map((s) => s.id)
  );

  for (const [, siblings] of sectionsByParent) {
    const sorted = siblings.sort((a, b) => a.ordering - b.ordering);
    for (let idx = 0; idx < sorted.length; idx++) {
      const section = sorted[idx];
      if (hasChildren.has(section.id)) continue;
      const html = renderSectionPage(
        course,
        section,
        sections,
        resources,
        problemsByResource,
        sorted[idx - 1] ?? null,
        sorted[idx + 1] ?? null,
        langCode,
        dir
      );
      zip.addFile(
        `${base}/sections/${section.slug}.html`,
        Buffer.from(html, "utf-8")
      );
    }
  }

  // KaTeX CSS
  const katexCss = fs.readFileSync(path.join(KATEX_DIST, "katex.min.css"));
  zip.addFile(`${base}/katex/katex.min.css`, katexCss);

  // KaTeX fonts
  const fontsDir = path.join(KATEX_DIST, "fonts");
  for (const file of fs.readdirSync(fontsDir)) {
    if (file.endsWith(".woff2") || file.endsWith(".woff") || file.endsWith(".ttf")) {
      zip.addFile(
        `${base}/katex/fonts/${file}`,
        fs.readFileSync(path.join(fontsDir, file))
      );
    }
  }

  // videos/manifest.json
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
    zip.addFile(
      `${base}/videos/manifest.json`,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf-8")
    );
  }

  // README.txt
  zip.addFile(
    `${base}/README.txt`,
    Buffer.from(renderReadme(course, videoIds), "utf-8")
  );

  const zipBuffer = zip.toBuffer();
  const filename = isTranslated ? `${base}-${langCode}.zip` : `${base}.zip`;

  return new Response(zipBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zipBuffer.length),
    },
  });
}
