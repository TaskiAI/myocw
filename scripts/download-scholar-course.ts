import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { CURRICULA_TRACKS } from "../lib/data/curricula.js";

// --- Configuration ---

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const STORAGE_BUCKET = "mit-ocw";
const STORAGE_PREFIX = "courses";
const SUPABASE_PUBLIC_URL = SUPABASE_URL.replace(/\/$/, "");
const TMP_DIR = "/tmp/myocw-scholar-download";

// --- Types ---

interface ScholarUnit {
  title: string;
  overviewPagePath: string | null;
  sessions: ScholarSession[];
}

interface ScholarSession {
  title: string;
  pagePath: string;
  resources: PreparedResource[];
}

interface PreparedResource {
  title: string;
  resourceType: string;
  pdfPath: string | null;
  contentText: string | null;
  videoUrl: string | null;
  youtubeId: string | null;
  archiveUrl: string | null;
  ordering: number;
}

// --- Utilities (shared with download-course.ts) ---

function buildStoragePublicUrl(objectPath: string): string {
  return `${SUPABASE_PUBLIC_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || "item";
}

function titleToFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) + ".pdf"
  );
}

function makeUniqueSlug(base: string, used: Set<string>): string {
  const normalized = slugify(base || "item");
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  let idx = 2;
  while (used.has(`${normalized}-${idx}`)) idx++;
  const unique = `${normalized}-${idx}`;
  used.add(unique);
  return unique;
}

function isTranscriptArtifact(rawTitle: string, originalFilename: string | null): boolean {
  const title = rawTitle.toLowerCase().trim();
  const filename = (originalFilename ?? "").toLowerCase().trim();
  if (title === "3play pdf file") return true;
  if (title.includes("transcript")) return true;
  if (filename.includes("transcript")) return true;
  return false;
}

function findFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...findFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

const YOUTUBE_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;

// --- Page Content Extraction ---

/**
 * Extract the main body text and any embedded YouTube IDs from an HTML page.
 * Used for unit overviews, session overviews, and instructor insights.
 */
function parsePageContent(pagePath: string): { text: string; youtubeIds: string[] } {
  if (!fs.existsSync(pagePath)) return { text: "", youtubeIds: [] };

  const html = fs.readFileSync(pagePath, "utf-8");
  const $ = cheerio.load(html);

  // Extract YouTube IDs from the full HTML (iframes, embeds, links)
  const youtubeIds: string[] = [];
  const ytGlobal = new RegExp(YOUTUBE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = ytGlobal.exec(html)) !== null) {
    if (!youtubeIds.includes(m[1])) youtubeIds.push(m[1]);
  }

  // Remove elements we don't want in the text extraction
  $("nav, footer, script, style, noscript, header, [role=navigation]").remove();
  // Remove prev/next navigation links
  $("a").filter((_, el) => {
    const t = $(el).text().trim();
    return t === "\u00AB Previous" || t === "Next \u00BB" || t === "Previous" || t === "Next";
  }).closest("p, div, span").remove();

  // Find main content area
  let content = $("main article").first();
  if (!content.length) content = $("main").first();
  if (!content.length) content = $("article").first();
  if (!content.length) content = $("body");

  // Extract text blocks as markdown (preserving headings, bold, lists)
  const blocks: string[] = [];
  content.find("h1, h2, h3, h4, h5, h6, p, li, blockquote, table").each((_, el) => {
    // Skip if inside a nested nav
    if ($(el).closest("nav, [role=navigation]").length > 0) return;
    const tag = (el as any).tagName?.toLowerCase();
    const text = normalizeWhitespace($(el).text());
    if (text.length < 3) return;

    // Convert to markdown
    if (tag === "h1") blocks.push(`# ${text}`);
    else if (tag === "h2") blocks.push(`## ${text}`);
    else if (tag === "h3") blocks.push(`### ${text}`);
    else if (tag === "h4" || tag === "h5" || tag === "h6") blocks.push(`#### ${text}`);
    else if (tag === "li") blocks.push(`- ${text}`);
    else if (tag === "blockquote") blocks.push(`> ${text}`);
    else {
      // For paragraphs, preserve inline bold/strong
      let md = "";
      $(el).contents().each((_, child) => {
        if (child.type === "text") {
          md += normalizeWhitespace($(child).text());
        } else if (child.type === "tag") {
          const childTag = (child as any).tagName?.toLowerCase();
          const childText = normalizeWhitespace($(child).text());
          if (!childText) return;
          if (childTag === "strong" || childTag === "b") md += `**${childText}**`;
          else if (childTag === "em" || childTag === "i") md += `*${childText}*`;
          else if (childTag === "a") md += childText;
          else md += childText;
        }
      });
      const trimmed = md.trim();
      if (trimmed.length >= 3) blocks.push(trimmed);
    }
  });

  // Deduplicate consecutive identical blocks
  const deduped = blocks.filter((line, i) => i === 0 || line !== blocks[i - 1]);

  return { text: deduped.join("\n\n"), youtubeIds };
}

// --- PDF Title Map from resource data.json files ---

function buildPdfTitleMap(contentRoot: string): Map<string, string> {
  const titleMap = new Map<string, string>();
  const resourcesDir = path.join(contentRoot, "resources");
  if (!fs.existsSync(resourcesDir)) return titleMap;

  const dataFiles = findFiles(resourcesDir, (fp) => fp.endsWith("data.json"));
  for (const dataFile of dataFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
      const title = normalizeWhitespace(data.title ?? "");
      const filePath = typeof data.file === "string" ? data.file : null;
      const filename = filePath?.split("/").pop() ?? null;
      if (filename && title) {
        const lower = filename.toLowerCase();
        if (lower.endsWith(".pdf") || lower.endsWith(".zip")) {
          titleMap.set(filename, title);
        }
      }
    } catch {
      // skip
    }
  }

  return titleMap;
}

// --- PDF Upload ---

const MAX_PDF_SIZE = 50 * 1024 * 1024;

async function uploadStaticPdfs(
  contentRoot: string,
  slug: string,
  pdfTitleMap: Map<string, string>,
): Promise<{ pdfUrlByFilename: Map<string, string>; pdfRenameMap: Map<string, string>; uploadedCount: number }> {
  const staticDir = path.join(contentRoot, "static_resources");
  const pdfUrlByFilename = new Map<string, string>();
  const pdfRenameMap = new Map<string, string>();
  const usedFilenames = new Set<string>();
  let uploadedCount = 0;

  if (!fs.existsSync(staticDir)) {
    return { pdfUrlByFilename, pdfRenameMap, uploadedCount };
  }

  const staticFiles = fs.readdirSync(staticDir).sort((a, b) => a.localeCompare(b));

  for (const file of staticFiles) {
    if (!file.toLowerCase().endsWith(".pdf")) continue;

    const filePath = path.join(staticDir, file);
    const title = pdfTitleMap.get(file);

    if (isTranscriptArtifact(title ?? "", file)) continue;

    const fileSize = fs.statSync(filePath).size;
    if (fileSize > MAX_PDF_SIZE) {
      console.log(`  Skipping oversized PDF (${(fileSize / 1024 / 1024).toFixed(1)} MB): ${file}`);
      continue;
    }

    let newFilename = title ? titleToFilename(title) : file;
    if (usedFilenames.has(newFilename)) {
      let i = 2;
      while (usedFilenames.has(newFilename.replace(/\.pdf$/i, `-${i}.pdf`))) i++;
      newFilename = newFilename.replace(/\.pdf$/i, `-${i}.pdf`);
    }
    usedFilenames.add(newFilename);

    const objectPath = `${STORAGE_PREFIX}/${slug}/${newFilename}`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, fs.readFileSync(filePath), {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      console.error(`  Error uploading ${file}: ${uploadError.message}`);
      continue;
    }

    const url = buildStoragePublicUrl(objectPath);
    pdfUrlByFilename.set(newFilename, url);
    pdfRenameMap.set(file, newFilename);
    uploadedCount++;

    if (title) {
      console.log(`  ${file} -> ${newFilename} ("${title}")`);
    }
  }

  return { pdfUrlByFilename, pdfRenameMap, uploadedCount };
}

// --- Scholar HTML Parsing ---

interface ScholarNavResult {
  units: ScholarUnit[];
  instructorInsightsPath: string | null;
  /** Top-level standalone pages (Final Course Review, Related Resources, etc.) */
  standaloneSessions: ScholarSession[];
}

function parseScholarNav(contentRoot: string): ScholarNavResult {
  const indexPath = path.join(contentRoot, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error("No index.html found in extracted course zip.");
  }

  const indexHtml = fs.readFileSync(indexPath, "utf-8");
  const $ = cheerio.load(indexHtml);

  const units: ScholarUnit[] = [];

  // Scholar courses have nav items with expandable children.
  // Top-level nav items that have child lists are Units.
  // Their children are Sessions (or sub-topic pages).
  //
  // The nav structure in OCW Scholar zips typically looks like:
  //   <nav>
  //     <a href="pages/syllabus/index.html">Syllabus</a>  (skip)
  //     <a href="pages/unit-i-...">Unit I: ...</a>         (unit - has children)
  //       <a href="pages/the-geometry-...">The Geometry...</a>  (session)
  //       <a href="pages/an-overview-...">An Overview...</a>    (session)
  //     <a href="pages/unit-ii-...">Unit II: ...</a>
  //       ...

  // Strategy: find all nav links, identify units by title pattern or by having
  // child links underneath them.

  const navLinks: { title: string; href: string; absolutePath: string; indent: number }[] = [];
  const seenHrefs = new Set<string>();

  // Collect all nav links with their nesting level
  // OCW zips often have duplicate navs (desktop + mobile) — deduplicate by href
  $("nav a[href], .course-nav a[href], [role=navigation] a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const title = normalizeWhitespace($(el).text());
    if (!href || !title || href.startsWith("#") || href.startsWith("http")) return;
    if (seenHrefs.has(href)) return;
    seenHrefs.add(href);

    const absolutePath = path.resolve(path.dirname(indexPath), href);
    if (!fs.existsSync(absolutePath)) return;

    // Determine indent level by counting parent <ul>/<ol> elements within nav
    let indent = 0;
    let parent = $(el).parent();
    while (parent.length > 0) {
      const tagName = parent.prop("tagName")?.toLowerCase();
      if (tagName === "nav" || parent.attr("role") === "navigation") break;
      if (tagName === "ul" || tagName === "ol") indent++;
      parent = parent.parent();
    }

    navLinks.push({ title, href, absolutePath, indent });
  });

  // Skip items: Syllabus, Calendar, Resource Index, Download
  // (Instructor Insights is captured separately, not skipped)
  const skipPatterns = /\b(syllabus|calendar|resource\s+index|download|related\s+resources|meet\s+the\s+tas?)\b/i;
  const instructorInsightsPattern = /\binstructor\s+insight/i;

  // Capture instructor insights path
  let instructorInsightsPath: string | null = null;

  // Identify units: items with indent level 1 whose title starts with "Unit" or "Part"
  // or items at indent 1 that have children at indent 2
  const unitPattern = /^(Unit\s+|Part\s+|Module\s+)/i;

  let currentUnit: ScholarUnit | null = null;
  const minIndent = Math.min(...navLinks.map((l) => l.indent));

  for (const link of navLinks) {
    if (skipPatterns.test(link.title)) continue;

    // Capture instructor insights separately
    if (instructorInsightsPattern.test(link.title)) {
      instructorInsightsPath = link.absolutePath;
      continue;
    }

    const isTopLevel = link.indent === minIndent;
    const looksLikeUnit = unitPattern.test(link.title);

    if (isTopLevel && looksLikeUnit) {
      // Start a new unit
      currentUnit = {
        title: link.title,
        overviewPagePath: link.absolutePath,
        sessions: [],
      };
      units.push(currentUnit);
    } else if (currentUnit && link.indent > minIndent) {
      // This is a child of the current unit = session
      if (skipPatterns.test(link.title)) continue;
      currentUnit.sessions.push({
        title: link.title,
        pagePath: link.absolutePath,
        resources: [],
      });
    } else if (isTopLevel && !looksLikeUnit) {
      // Top-level non-unit item (e.g., "Final Exam", standalone pages)
      // If it looks like an exam, add it as a standalone unit
      if (/\b(exam|final|midterm)\b/i.test(link.title)) {
        const examUnit: ScholarUnit = {
          title: link.title,
          overviewPagePath: link.absolutePath,
          sessions: [],
        };
        // Check if it has children
        const nextLinks = navLinks.slice(navLinks.indexOf(link) + 1);
        for (const next of nextLinks) {
          if (next.indent <= minIndent) break;
          examUnit.sessions.push({
            title: next.title,
            pagePath: next.absolutePath,
            resources: [],
          });
        }
        // If no children, make the exam page itself a session
        if (examUnit.sessions.length === 0) {
          examUnit.sessions.push({
            title: link.title,
            pagePath: link.absolutePath,
            resources: [],
          });
        }
        units.push(examUnit);
        currentUnit = null;
      }
      // Otherwise skip non-unit top-level items
    }
  }

  // If no units were found, fall back: treat each top-level item as a session in one unit
  if (units.length === 0) {
    console.log("  No units detected, falling back to flat structure with a single unit.");
    const fallbackUnit: ScholarUnit = {
      title: "Course Content",
      overviewPagePath: null,
      sessions: [],
    };
    for (const link of navLinks) {
      if (skipPatterns.test(link.title)) continue;
      fallbackUnit.sessions.push({
        title: link.title,
        pagePath: link.absolutePath,
        resources: [],
      });
    }
    if (fallbackUnit.sessions.length > 0) {
      units.push(fallbackUnit);
    }
  }

  return { units, instructorInsightsPath, standaloneSessions: [] };
}

function parseSessionPage(
  sessionPagePath: string,
  contentRoot: string,
  pdfRenameMap: Map<string, string>,
  pdfUrlByFilename: Map<string, string>,
): PreparedResource[] {
  if (!fs.existsSync(sessionPagePath)) return [];

  const html = fs.readFileSync(sessionPagePath, "utf-8");
  const $ = cheerio.load(html);
  const resources: PreparedResource[] = [];
  let ordering = 0;

  const seenResourceSlugs = new Set<string>();

  // Find all resource links on the page
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const resourceMatch = href.match(/resources\/([^/]+)/);
    if (!resourceMatch) return;

    const resourceSlug = resourceMatch[1];
    if (seenResourceSlugs.has(resourceSlug)) return;

    // Read data.json for this resource
    const dataJsonPath = path.join(contentRoot, "resources", resourceSlug, "data.json");
    if (!fs.existsSync(dataJsonPath)) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(dataJsonPath, "utf-8"));
    } catch {
      return;
    }

    const title = normalizeWhitespace((data.title as string) ?? resourceSlug.replace(/-/g, " "));
    const filePath = typeof data.file === "string" ? data.file : null;
    const originalFilename = filePath ? filePath.split("/").pop() ?? null : null;

    if (isTranscriptArtifact(title, originalFilename)) return;

    const youtubeId = typeof data.youtube_key === "string" ? data.youtube_key : null;
    const archiveUrl = typeof data.archive_url === "string" ? data.archive_url : null;

    // Determine resource type from learning_resource_types
    const lrt = Array.isArray(data.learning_resource_types)
      ? (data.learning_resource_types as string[]).map((s) => s.toLowerCase())
      : [];

    let resourceType = "other";
    if (youtubeId || archiveUrl) {
      // Check if it's a recitation/problem-solving video vs lecture video
      if (lrt.some((t) => t.includes("recitation")) || /recitation/i.test(title)) {
        resourceType = "recitation";
      } else {
        resourceType = "video";
      }
    } else if (originalFilename?.toLowerCase().endsWith(".pdf")) {
      const lower = title.toLowerCase();
      if (/\b(solution|answers|soln)\b/.test(lower)) {
        resourceType = "solution";
      } else if (/\b(problem|assignment|homework|pset|check yourself)\b/.test(lower) || lrt.some((t) => t.includes("problem") || t.includes("assignment"))) {
        resourceType = "problem_set";
      } else if (/\b(exam|midterm|final|quiz)\b/.test(lower) || lrt.some((t) => t.includes("exam"))) {
        resourceType = "exam";
      } else {
        resourceType = "lecture_notes";
      }
    } else {
      // No video and no PDF — skip
      if (!youtubeId && !archiveUrl) return;
    }

    seenResourceSlugs.add(resourceSlug);

    // Resolve PDF URL
    let pdfUrl: string | null = null;
    if (originalFilename?.toLowerCase().endsWith(".pdf")) {
      const renamedFile = pdfRenameMap.get(originalFilename);
      if (renamedFile) {
        pdfUrl = pdfUrlByFilename.get(renamedFile) ?? null;
      }
    }

    // Skip PDF resources where the file wasn't uploaded
    if (resourceType !== "video" && resourceType !== "recitation" && !pdfUrl && !youtubeId && !archiveUrl) {
      return;
    }

    resources.push({
      title,
      resourceType,
      pdfPath: pdfUrl,
      contentText: null,
      videoUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
      youtubeId,
      archiveUrl,
      ordering: ordering++,
    });
  });

  // --- Extract session overview text + suggested reading ---
  // Remove nav/footer, then look for substantive text on the page
  $("nav, footer, script, style, noscript, [role=navigation]").remove();

  let mainContent = $("main article").first();
  if (!mainContent.length) mainContent = $("main").first();
  if (!mainContent.length) mainContent = $("body");

  // Collect overview paragraphs: skip short labels and resource instructions
  const skipTextPatterns = /^(watch |download |view video|3play |recitation video|lecture video|check yourself|problems? and solutions?|problem solving video|\u00AB previous|next \u00BB)/i;
  const overviewParagraphs: string[] = [];

  mainContent.find("p").each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (text.length < 30) return;
    if (skipTextPatterns.test(text)) return;
    // Skip lines that are just PDF/resource link labels
    if (/^\(.*(PDF|MB|KB)\)/.test(text)) return;
    overviewParagraphs.push(text);
  });

  // Also capture "Suggested Reading" or "Related Readings" sections
  mainContent.find("h2, h3").each((_, el) => {
    const heading = normalizeWhitespace($(el).text()).toLowerCase();
    if (/\b(suggested reading|related reading|reading)\b/.test(heading)) {
      // Grab the next sibling paragraphs/lists
      let next = $(el).next();
      while (next.length > 0 && !["h2", "h3"].includes(next.prop("tagName")?.toLowerCase() ?? "")) {
        const text = normalizeWhitespace(next.text());
        if (text.length > 10) {
          overviewParagraphs.push(text);
        }
        next = next.next();
      }
    }
  });

  if (overviewParagraphs.length > 0) {
    const overviewText = overviewParagraphs.join("\n\n");
    // Prepend as a "reading" resource at ordering -1 so it appears first
    resources.unshift({
      title: "Session Overview",
      resourceType: "reading",
      pdfPath: null,
      contentText: overviewText,
      videoUrl: null,
      youtubeId: null,
      archiveUrl: null,
      ordering: -1,
    });

    // Re-number ordering so it's clean: 0, 1, 2, ...
    resources.forEach((r, i) => { r.ordering = i; });
  }

  return resources;
}

// --- Download + Extract Zip ---

async function downloadAndExtractZip(slug: string, courseUrl: string): Promise<string> {
  const normalizedUrl = courseUrl.endsWith("/") ? courseUrl : `${courseUrl}/`;

  console.log(`[Stage 0] Fetching download page: ${normalizedUrl}download`);
  const downloadPageRes = await fetch(`${normalizedUrl}download`);
  if (!downloadPageRes.ok) {
    throw new Error(`Failed to fetch download page: ${downloadPageRes.status}`);
  }

  const downloadHtml = await downloadPageRes.text();
  const $dl = cheerio.load(downloadHtml);

  let zipUrl: string | null = null;
  $dl('a[href$=".zip"]').each((_, el) => {
    if (zipUrl) return;
    const href = $dl(el).attr("href");
    if (!href) return;
    zipUrl = href.startsWith("http") ? href : new URL(href, normalizedUrl).toString();
  });

  if (!zipUrl) {
    throw new Error("Could not find zip download link on the download page.");
  }

  console.log(`[Stage 0] Zip URL: ${zipUrl}`);

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const zipPath = path.join(TMP_DIR, `${slug}.zip`);

  console.log("[Stage 0] Downloading zip...");
  const zipRes = await fetch(zipUrl);
  if (!zipRes.ok) {
    throw new Error(`Failed to download zip: ${zipRes.status}`);
  }

  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
  fs.writeFileSync(zipPath, zipBuffer);
  console.log(`[Stage 0] Downloaded ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  console.log("[Stage 0] Extracting zip...");
  const zip = new AdmZip(zipPath);
  const extractDir = path.join(TMP_DIR, slug);
  zip.extractAllTo(extractDir, true);

  const rootEntries = fs.readdirSync(extractDir, { withFileTypes: true })
    .filter((entry) => entry.name !== "__MACOSX");

  const contentRoot = rootEntries.length === 1 && rootEntries[0].isDirectory()
    ? path.join(extractDir, rootEntries[0].name)
    : extractDir;

  console.log(`[Stage 0] Content root: ${contentRoot}`);
  return contentRoot;
}

// --- Main Pipeline ---

export async function downloadScholarCourse(slug: string) {
  console.log(`\nLooking up Scholar course with slug: ${slug}`);

  const { data: courses, error: lookupError } = await supabase
    .from("courses")
    .select("*")
    .ilike("url", `%${slug}%`);

  if (lookupError || !courses?.length) {
    throw new Error(`Course not found: ${lookupError?.message ?? "no match"}`);
  }

  const course = courses[0];
  console.log(`Found course: ${course.title} (id: ${course.id})`);
  console.log(`URL: ${course.url}`);

  // Stage 0: Download + extract ZIP
  const contentRoot = await downloadAndExtractZip(slug, course.url);

  // Stage 1: Parse Scholar nav structure (Units > Sessions)
  console.log("\n[Stage 1] Parsing Scholar nav structure...");
  const navResult = parseScholarNav(contentRoot);
  const { units, instructorInsightsPath } = navResult;

  console.log(`[Stage 1] Found ${units.length} units:`);
  for (const unit of units) {
    console.log(`  ${unit.title} (${unit.sessions.length} sessions)`);
    for (const session of unit.sessions) {
      console.log(`    - ${session.title}`);
    }
  }
  if (instructorInsightsPath) {
    console.log(`[Stage 1] Instructor Insights page found.`);
  }

  if (units.length === 0 || units.every((u) => u.sessions.length === 0)) {
    throw new Error("No units/sessions found in Scholar nav.");
  }

  // Stage 2: Upload static PDFs
  console.log("\n[Stage 2] Building PDF title map...");
  const pdfTitleMap = buildPdfTitleMap(contentRoot);
  console.log(`[Stage 2] ${pdfTitleMap.size} PDF titles from data.json`);

  console.log("[Stage 2] Uploading static_resources files...");
  const upload = await uploadStaticPdfs(contentRoot, slug, pdfTitleMap);
  console.log(`[Stage 2] Uploaded ${upload.uploadedCount} PDFs`);

  // Stage 3: Parse session pages to extract resources
  console.log("\n[Stage 3] Parsing session pages...");
  for (const unit of units) {
    for (const session of unit.sessions) {
      session.resources = parseSessionPage(
        session.pagePath,
        contentRoot,
        upload.pdfRenameMap,
        upload.pdfUrlByFilename,
      );
      const videoCount = session.resources.filter((r) => r.resourceType === "video").length;
      const pdfCount = session.resources.filter((r) => r.pdfPath).length;
      console.log(`  ${session.title}: ${session.resources.length} resources (${videoCount} videos, ${pdfCount} PDFs)`);
    }
  }

  // Stage 3b: Extract unit overview text
  console.log("\n[Stage 3b] Extracting unit & page overviews...");
  const unitOverviews = new Map<string, string>(); // unit title → overview text
  for (const unit of units) {
    if (!unit.overviewPagePath) continue;
    const { text } = parsePageContent(unit.overviewPagePath);
    if (text.length > 30) {
      unitOverviews.set(unit.title, text);
      console.log(`  ${unit.title}: ${text.length} chars of overview text`);
    }
  }

  // Stage 3c: Parse Instructor Insights page
  let instructorInsightsResources: PreparedResource[] = [];
  if (instructorInsightsPath) {
    console.log("\n[Stage 3c] Parsing Instructor Insights...");
    const { text, youtubeIds } = parsePageContent(instructorInsightsPath);

    let ordering = 0;

    // Add video resource(s) from the Instructor Insights page
    for (const ytId of youtubeIds) {
      instructorInsightsResources.push({
        title: "Instructor Insights",
        resourceType: "video",
        pdfPath: null,
        contentText: null,
        videoUrl: `https://www.youtube.com/watch?v=${ytId}`,
        youtubeId: ytId,
        archiveUrl: null,
        ordering: ordering++,
      });
      console.log(`  Video: ${ytId}`);
    }

    // Add text content (curriculum info, etc.)
    if (text.length > 30) {
      instructorInsightsResources.push({
        title: "Curriculum Information",
        resourceType: "reading",
        pdfPath: null,
        contentText: text,
        videoUrl: null,
        youtubeId: null,
        archiveUrl: null,
        ordering: ordering++,
      });
      console.log(`  Text: ${text.length} chars`);
    }

    // Also extract any PDFs linked on the Instructor Insights page
    const insightsHtml = fs.readFileSync(instructorInsightsPath, "utf-8");
    const $insights = cheerio.load(insightsHtml);
    $insights("a[href]").each((_, el) => {
      const href = $insights(el).attr("href") ?? "";
      const resourceMatch = href.match(/resources\/([^/]+)/);
      if (!resourceMatch) return;
      const resourceSlug = resourceMatch[1];
      const dataJsonPath = path.join(contentRoot, "resources", resourceSlug, "data.json");
      if (!fs.existsSync(dataJsonPath)) return;
      try {
        const data = JSON.parse(fs.readFileSync(dataJsonPath, "utf-8"));
        const filePath = typeof data.file === "string" ? data.file : null;
        const originalFilename = filePath?.split("/").pop() ?? null;
        if (originalFilename?.toLowerCase().endsWith(".pdf")) {
          const renamedFile = upload.pdfRenameMap.get(originalFilename);
          const pdfUrl = renamedFile ? upload.pdfUrlByFilename.get(renamedFile) ?? null : null;
          if (pdfUrl) {
            const title = normalizeWhitespace((data.title as string) ?? "Document");
            if (!isTranscriptArtifact(title, originalFilename)) {
              instructorInsightsResources.push({
                title,
                resourceType: "lecture_notes",
                pdfPath: pdfUrl,
                contentText: null,
                videoUrl: null,
                youtubeId: null,
                archiveUrl: null,
                ordering: ordering++,
              });
              console.log(`  PDF: ${title}`);
            }
          }
        }
      } catch { /* skip */ }
    });
  }

  // Stage 4: Persist to database
  console.log("\n[Stage 4] Persisting to database...");

  // Clear existing content
  await supabase.from("resources").delete().eq("course_id", course.id);
  await supabase.from("course_sections").delete().eq("course_id", course.id);

  const usedSlugs = new Set<string>();
  let globalOrdering = 0;

  // Insert Instructor Insights section (before units, so it appears at top)
  if (instructorInsightsResources.length > 0) {
    const insightsSlug = makeUniqueSlug("instructor-insights", usedSlugs);
    const { data: insightsSection, error: insightsError } = await supabase
      .from("course_sections")
      .insert({
        course_id: course.id,
        title: "Instructor Insights",
        slug: insightsSlug,
        section_type: "instructor_insights",
        ordering: globalOrdering++,
        parent_id: null,
      })
      .select("id")
      .single();

    if (insightsSection && !insightsError) {
      const insightRows = instructorInsightsResources.map((r) => ({
        course_id: course.id,
        section_id: insightsSection.id,
        title: r.title,
        resource_type: r.resourceType,
        pdf_path: r.pdfPath,
        content_text: r.contentText,
        video_url: r.videoUrl,
        youtube_id: r.youtubeId,
        archive_url: r.archiveUrl,
        ordering: r.ordering,
      }));
      const { error: resError } = await supabase.from("resources").insert(insightRows);
      if (resError) {
        console.error(`  Failed to insert Instructor Insights resources: ${resError.message}`);
      } else {
        console.log(`  Inserted Instructor Insights section with ${insightRows.length} resources`);
      }
    } else {
      console.error(`  Failed to insert Instructor Insights section: ${insightsError?.message}`);
    }
  }

  for (const unit of units) {
    // Insert unit section (parent)
    const unitSlug = makeUniqueSlug(unit.title, usedSlugs);
    const { data: insertedUnit, error: unitError } = await supabase
      .from("course_sections")
      .insert({
        course_id: course.id,
        title: unit.title,
        slug: unitSlug,
        section_type: "unit",
        ordering: globalOrdering++,
        parent_id: null,
      })
      .select("id")
      .single();

    if (unitError || !insertedUnit) {
      console.error(`  Failed to insert unit "${unit.title}": ${unitError?.message}`);
      continue;
    }

    const unitId = insertedUnit.id;

    // Insert unit overview as a reading resource (if we extracted overview text)
    const unitOverviewText = unitOverviews.get(unit.title);
    if (unitOverviewText) {
      const { error: overviewError } = await supabase.from("resources").insert({
        course_id: course.id,
        section_id: unitId,
        title: "Unit Overview",
        resource_type: "reading",
        pdf_path: null,
        content_text: unitOverviewText,
        video_url: null,
        youtube_id: null,
        archive_url: null,
        ordering: 0,
      });
      if (overviewError) {
        console.error(`  Failed to insert unit overview for "${unit.title}": ${overviewError.message}`);
      }
    }

    // Insert session sections (children of this unit)
    for (const session of unit.sessions) {
      const sessionSlug = makeUniqueSlug(session.title, usedSlugs);

      // Determine section type based on session content
      const hasVideo = session.resources.some((r) => r.resourceType === "video");
      const hasExam = session.resources.some((r) => r.resourceType === "exam") ||
        /\b(exam|midterm|final|quiz)\b/i.test(session.title);
      const sectionType = hasExam ? "exam" : hasVideo ? "lecture" : "other";

      const { data: insertedSession, error: sessionError } = await supabase
        .from("course_sections")
        .insert({
          course_id: course.id,
          title: session.title,
          slug: sessionSlug,
          section_type: sectionType,
          ordering: globalOrdering++,
          parent_id: unitId,
        })
        .select("id")
        .single();

      if (sessionError || !insertedSession) {
        console.error(`  Failed to insert session "${session.title}": ${sessionError?.message}`);
        continue;
      }

      // Insert resources for this session
      if (session.resources.length > 0) {
        const resourceRows = session.resources.map((r) => ({
          course_id: course.id,
          section_id: insertedSession.id,
          title: r.title,
          resource_type: r.resourceType,
          pdf_path: r.pdfPath,
          content_text: r.contentText,
          video_url: r.videoUrl,
          youtube_id: r.youtubeId,
          archive_url: r.archiveUrl,
          ordering: r.ordering,
        }));

        const { error: resError } = await supabase.from("resources").insert(resourceRows);
        if (resError) {
          console.error(`  Failed to insert resources for "${session.title}": ${resError.message}`);
        }
      }
    }
  }

  // Mark course as Scholar + content downloaded
  const { error: updateError } = await supabase
    .from("courses")
    .update({
      content_downloaded: true,
      content_downloaded_at: new Date().toISOString(),
      is_scholar: true,
    })
    .eq("id", course.id);

  if (updateError) {
    console.error("Error updating course:", updateError.message);
  }

  // Count totals
  const totalSessions = units.reduce((sum, u) => sum + u.sessions.length, 0);
  const totalResources = units.reduce(
    (sum, u) => sum + u.sessions.reduce((s, sess) => s + sess.resources.length, 0),
    0,
  );

  // Cleanup
  const keepTmp = process.env.MYOCW_KEEP_TMP === "1";
  if (keepTmp) {
    console.log(`\nSkipping temp cleanup (MYOCW_KEEP_TMP=1): ${TMP_DIR}`);
  } else {
    console.log("\nCleaning up temp files...");
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log("\nDone!");
  console.log(`  Course: ${course.title}`);
  console.log(`  Units: ${units.length}`);
  console.log(`  Sessions: ${totalSessions}`);
  console.log(`  Resources: ${totalResources}`);
  console.log(`  PDFs uploaded: ${upload.uploadedCount}`);
}

// --- Batch mode ---

async function batchDownloadScholar() {
  const scholarTrack = CURRICULA_TRACKS.find((t) => t.id === "ocw-scholar");
  if (!scholarTrack) {
    throw new Error("Scholar track not found in curricula data.");
  }

  console.log(`\nBatch downloading ${scholarTrack.courses.length} Scholar courses...\n`);

  for (let i = 0; i < scholarTrack.courses.length; i++) {
    const entry = scholarTrack.courses[i];
    const slug = entry.urlPath.replace(/^\/courses\//, "");

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${i + 1}/${scholarTrack.courses.length}] ${entry.title} (${entry.courseNumber})`);
    console.log(`${"=".repeat(60)}`);

    // Check if already downloaded as Scholar
    const { data: existing } = await supabase
      .from("courses")
      .select("id, is_scholar, content_downloaded")
      .ilike("url", `%${slug}%`)
      .single();

    if (existing?.is_scholar && existing?.content_downloaded) {
      console.log("  Already downloaded as Scholar, skipping.");
      continue;
    }

    try {
      await downloadScholarCourse(slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${msg}`);
      // Continue with next course
    }

    // Rate limit between courses
    if (i < scholarTrack.courses.length - 1) {
      console.log("\n  Waiting 2s before next course...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log("\n\nBatch complete!");
}

// --- CLI Entry ---

const __isMain = process.argv[1]?.includes("download-scholar-course");
if (__isMain) {
  const arg = process.argv[2];

  if (arg === "--batch" || arg === "-b") {
    batchDownloadScholar().catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
  } else if (arg) {
    downloadScholarCourse(arg).catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
  } else {
    console.error("Usage:");
    console.error("  pnpm tsx scripts/download-scholar-course.ts <course-slug>");
    console.error("  pnpm tsx scripts/download-scholar-course.ts --batch");
    console.error("\nExample:");
    console.error("  pnpm tsx scripts/download-scholar-course.ts 18-06sc-linear-algebra-fall-2011");
    process.exit(1);
  }
}
