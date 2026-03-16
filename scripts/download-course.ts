import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const STORAGE_BUCKET = "mit-ocw";
const STORAGE_PREFIX = "courses";
const SUPABASE_PUBLIC_URL = SUPABASE_URL.replace(/\/$/, "");
const TMP_DIR = "/tmp/myocw-download";

type SectionType = "lecture" | "problem_set" | "exam" | "recitation" | "other";
type NonVideoResourceType = "problem_set" | "exam" | "solution" | "recitation" | "lecture_notes" | "other";
type ResourceType = "video" | NonVideoResourceType;
type CheerioTarget = Parameters<cheerio.CheerioAPI>[0];

interface CrawledPage {
  relativePath: string;
  absolutePath: string;
  title: string;
  order: number;
  sourcePriority: number;
}

interface ResourceOccurrence {
  resourceId: string;
  linkText: string;
  pagePath: string;
  pageOrder: number;
  linkOrder: number;
  sourcePriority: number;
  weekHint: number | null;
  numberHint: number | null;
  inferredResourceType: NonVideoResourceType;
  rowHeader: string | null;
  columnHeader: string | null;
}

interface LectureEntry {
  title: string;
  slug: string;
  resourceId: string | null;
  youtubeId: string | null;
  archiveUrl: string | null;
  lectureNumber: number | null;
  sourcePriority: number;
  pageOrder: number;
  linkOrder: number;
}

interface RawResourceMetadata {
  id: string;
  title: string;
  filePath: string | null;
  originalFilename: string | null;
  inferredResourceType: NonVideoResourceType;
  sectionTypeHint: SectionType;
  numberHint: number | null;
}

interface VerifiedResource {
  id: string;
  title: string;
  uploadedFilename: string;
  pdfUrl: string;
  resourceType: NonVideoResourceType;
  sectionType: SectionType;
  numberHint: number | null;
  weekHint: number | null;
  sourcePriority: number;
  pageOrder: number;
  linkOrder: number;
}

function isTranscriptArtifact(rawTitle: string, originalFilename: string | null): boolean {
  const title = rawTitle.toLowerCase().trim();
  const filename = (originalFilename ?? "").toLowerCase().trim();

  if (title === "3play pdf file") return true;
  if (title.includes("transcript")) return true;
  if (filename.includes("transcript")) return true;

  return false;
}

interface PreparedResource {
  title: string;
  resourceType: ResourceType;
  pdfPath: string | null;
  videoUrl: string | null;
  youtubeId: string | null;
  archiveUrl: string | null;
}

interface PreparedSection {
  key: string;
  title: string;
  slugBase: string;
  sectionType: SectionType;
  resources: PreparedResource[];
  weekHint: number | null;
  sourcePriority: number;
  pageOrder: number;
  linkOrder: number;
  orderSeed: number;
}

interface UploadResult {
  uploadedPdfCount: number;
  pdfUrlByFilename: Map<string, string>;
  pdfRenameMap: Map<string, string>;
}

function buildStoragePublicUrl(objectPath: string): string {
  return `${SUPABASE_PUBLIC_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isBlockedSidebarTitle(value: string): boolean {
  return normalizeWhitespace(value).toLowerCase() === "download file";
}

function stripDownloadArtifacts(value: string): string {
  const cleaned = value
    .replace(/\(\s*download\s+(?:file|video)\s*\)/gi, " ")
    .replace(/\[\s*download\s+(?:file|video)\s*\]/gi, " ")
    .replace(/\s*-\s*download\s+(?:file|video)\b/gi, " ")
    .replace(/\bdownload\s+(?:file|video)\b/gi, " ")
    .replace(/\(\s*\)/g, " ");

  return normalizeWhitespace(cleaned);
}

function isGenericDownloadLabel(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;
  if (normalized === "download" || normalized === "file" || normalized === "video") return true;
  if (/^download(\s+(file|video|mp4))?$/.test(normalized)) return true;
  return false;
}

function deriveTitleFromMediaUrl(url: string): string | null {
  let filename = "";
  try {
    const parsed = new URL(url);
    filename = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
  } catch {
    filename = decodeURIComponent(url.split("/").pop() ?? "");
  }

  const stem = filename.replace(/\.[a-z0-9]+$/i, "");
  if (!stem) return null;

  const taggedMatch = (tags: string): RegExpMatchArray | null =>
    stem.match(new RegExp(`(?:^|[^a-z])(?:${tags})[\\s._-]*0*(\\d{1,3})([a-z])?`, "i"));

  const lectureMatch = taggedMatch("lec|lecture|l");
  if (lectureMatch) {
    const suffix = lectureMatch[2] ? lectureMatch[2].toUpperCase() : "";
    return `Lecture ${lectureMatch[1]}${suffix}`;
  }

  const recitationMatch = taggedMatch("rec|recitation");
  if (recitationMatch) {
    const suffix = recitationMatch[2] ? recitationMatch[2].toUpperCase() : "";
    return `Recitation ${recitationMatch[1]}${suffix}`;
  }

  const sessionMatch = taggedMatch("ses|session");
  if (sessionMatch) {
    const suffix = sessionMatch[2] ? sessionMatch[2].toUpperCase() : "";
    return `Session ${sessionMatch[1]}${suffix}`;
  }

  const trackMatch = taggedMatch("track");
  if (trackMatch) {
    const suffix = trackMatch[2] ? trackMatch[2].toUpperCase() : "";
    return `Track ${trackMatch[1]}${suffix}`;
  }

  const episodeMatch = taggedMatch("ep|episode");
  if (episodeMatch) return `Episode ${episodeMatch[1]}`;

  return null;
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

function extractYouTubeId(value: string): string | null {
  const patterns = [
    /img\.youtube\.com\/vi\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function extractArchiveUrl(html: string): string | null {
  const match = html.match(/https?:\/\/archive\.org\/download\/[^\s"'<>]+\.mp4/);
  return match ? match[0] : null;
}

function extractLectureNumber(text: string): number | null {
  const match = text.match(/lecture\s*#?\s*0*(\d+)/i);
  if (!match) return null;

  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractWeekNumber(text: string): number | null {
  const weekMatch = text.match(/\bweek\s*#?\s*0*(\d{1,2})\b/i);
  if (weekMatch) {
    const parsed = parseInt(weekMatch[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const moduleMatch = text.match(/\bmodule\s*#?\s*0*(\d{1,2})\b/i);
  if (moduleMatch) {
    const parsed = parseInt(moduleMatch[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const lectureMatch = text.match(/\blecture\b\s*:?\s*#?\s*0*(\d{1,3})\b/i);
  if (lectureMatch) {
    const parsed = parseInt(lectureMatch[1], 10);
    if (Number.isFinite(parsed) && parsed <= 150) return parsed;
  }

  return null;
}

function extractNumberHint(text: string): number | null {
  const pattern = /\b(?:lecture|lec|week|problem\s*set|pset|assignment|homework|quiz|exam|midterm|final|recitation|session)\s*#?\s*0*(\d{1,3})\b/i;
  const match = text.match(pattern);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed <= 150) return parsed;
  }

  const leading = text.match(/^\s*0*(\d{1,3})\b/);
  if (leading) {
    const parsed = parseInt(leading[1], 10);
    if (Number.isFinite(parsed) && parsed <= 150) return parsed;
  }

  return null;
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

function stripSolutionWords(title: string): string {
  const cleaned = title
    .replace(/\b(solution|solutions|answer key|answers|soln?)\b/gi, "")
    .replace(/[-:\s]+$/g, "");
  return normalizeWhitespace(cleaned);
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

function inferResourceType(text: string): NonVideoResourceType {
  const lower = text.toLowerCase();

  if (/\b(solution|solutions|answer key|answers|soln?|sol)\b/.test(lower)) return "solution";
  if (/\b(recitation|tutorial|problem session)\b/.test(lower)) return "recitation";
  if (/\b(quiz|midterm|final|exam|test)\b/.test(lower)) return "exam";
  if (/\b(problem\s*set|pset|assignment|homework|hw)\b/.test(lower)) return "problem_set";
  if (/\b(lecture|notes?)\b/.test(lower)) return "lecture_notes";

  return "other";
}

function sectionTypeForResource(resourceType: NonVideoResourceType, contextText: string): SectionType {
  if (resourceType === "problem_set") return "problem_set";
  if (resourceType === "exam") return "exam";
  if (resourceType === "recitation") return "recitation";

  if (resourceType === "solution") {
    return /\b(quiz|midterm|final|exam|test)\b/i.test(contextText) ? "exam" : "problem_set";
  }

  if (resourceType === "lecture_notes") return "lecture";
  return "other";
}

function sourcePriorityForPage(relativePath: string): number {
  const lower = relativePath.toLowerCase();

  if (
    lower.includes("pages/resource-index")
    || lower.includes("pages/calendar")
    || lower.includes("pages/syllabus")
    || lower.includes("pages/schedule")
  ) {
    return 0;
  }

  if (lower.includes("video_galleries")) return 1;

  if (
    lower.includes("pages/assignments")
    || lower.includes("pages/quizzes")
    || lower.includes("pages/exams")
    || lower.includes("pages/recitations")
    || lower.includes("pages/problem")
    || lower.includes("pages/readings")
  ) {
    return 2;
  }

  return 3;
}

function parseHrefPath(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return "";
    }
  }

  return decodeURIComponent(trimmed.split("#")[0].split("?")[0]);
}

function extractResourceIdFromHref(href: string): string | null {
  const parsed = parseHrefPath(href);
  if (!parsed) return null;

  const segments = parsed.split("/").filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === "resources") {
      return segments[i + 1] || null;
    }
  }

  return null;
}

function slugFromHref(href: string): string | null {
  const parsed = parseHrefPath(href);
  if (!parsed) return null;

  const segments = parsed.split("/").filter(Boolean);
  if (!segments.length) return null;

  return segments[segments.length - 1] ?? null;
}

function extractAnchorDisplayText($: cheerio.CheerioAPI, el: CheerioTarget): string {
  const $a = $(el);
  const heading = stripDownloadArtifacts(
    normalizeWhitespace($a.find("h1,h2,h3,h4,h5,h6,strong").first().text()),
  );
  if (heading) return heading;

  const aria = stripDownloadArtifacts(normalizeWhitespace($a.attr("aria-label") ?? ""));
  if (aria) return aria;

  const titleAttr = stripDownloadArtifacts(normalizeWhitespace($a.attr("title") ?? ""));
  if (titleAttr) return titleAttr;

  const text = stripDownloadArtifacts(normalizeWhitespace($a.text()));
  if (text) return text;

  return normalizeWhitespace($a.text());
}

function extractTableRowHeader($: cheerio.CheerioAPI, el: CheerioTarget): string | null {
  const $row = $(el).closest("tr");
  if (!$row.length) return null;

  const th = normalizeWhitespace($row.children("th").first().text());
  if (th) return th;

  const firstCell = normalizeWhitespace($row.children("td").first().text());
  return firstCell || null;
}

function extractTableColumnHeader($: cheerio.CheerioAPI, el: CheerioTarget): string | null {
  const $cell = $(el).closest("th,td");
  if (!$cell.length) return null;

  const $row = $cell.parent();
  const cellIndex = $row.children("th,td").index($cell);
  if (cellIndex < 0) return null;

  const $table = $cell.closest("table");
  if (!$table.length) return null;

  const headerFromHead = normalizeWhitespace(
    $table.find("thead tr").first().children("th,td").eq(cellIndex).text(),
  );
  if (headerFromHead) return headerFromHead;

  const headerFromFirstRow = normalizeWhitespace(
    $table.find("tr").first().children("th,td").eq(cellIndex).text(),
  );
  if (headerFromFirstRow) return headerFromFirstRow;

  return null;
}

function toHtmlCandidates(rawPath: string): string[] {
  const normalized = path.posix.normalize(rawPath).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("..")) return [];

  const candidates = new Set<string>();
  candidates.add(normalized);

  if (normalized.endsWith("/")) {
    candidates.add(`${normalized}index.html`);
  }

  if (!normalized.endsWith(".html")) {
    candidates.add(`${normalized}.html`);
    candidates.add(path.posix.join(normalized, "index.html"));
  }

  if (normalized.endsWith("/index")) {
    candidates.add(`${normalized}.html`);
  }

  return Array.from(candidates).map((entry) => entry.replace(/^\//, ""));
}

function resolveLocalHtmlPath(href: string, currentPath: string, htmlSet: Set<string>): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("mailto:")) return null;
  if (trimmed.startsWith("tel:")) return null;
  if (trimmed.startsWith("javascript:")) return null;

  const tryCandidates = (rawPath: string): string | null => {
    for (const candidate of toHtmlCandidates(rawPath)) {
      if (htmlSet.has(candidate)) return candidate;
    }
    return null;
  };

  const rawPath = parseHrefPath(trimmed);
  if (!rawPath) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    const direct = tryCandidates(rawPath.replace(/^\//, ""));
    if (direct) return direct;

    for (const marker of ["/pages/", "/resources/", "/video_galleries/"]) {
      const idx = rawPath.indexOf(marker);
      if (idx >= 0) {
        const candidate = tryCandidates(rawPath.slice(idx + 1));
        if (candidate) return candidate;
      }
    }

    return null;
  }

  if (rawPath.startsWith("/")) {
    return tryCandidates(rawPath.replace(/^\//, ""));
  }

  const fromCurrentDir = path.posix.join(path.posix.dirname(currentPath), rawPath);
  const relativeMatch = tryCandidates(fromCurrentDir);
  if (relativeMatch) return relativeMatch;

  const rootMatch = tryCandidates(rawPath);
  if (rootMatch) return rootMatch;

  for (const marker of ["pages/", "resources/", "video_galleries/"]) {
    const idx = rawPath.indexOf(marker);
    if (idx >= 0) {
      const candidate = tryCandidates(rawPath.slice(idx));
      if (candidate) return candidate;
    }
  }

  return null;
}

function compareHintTuple(
  aSource: number,
  aPage: number,
  aLink: number,
  bSource: number,
  bPage: number,
  bLink: number,
): number {
  if (aSource !== bSource) return aSource - bSource;
  if (aPage !== bPage) return aPage - bPage;
  return aLink - bLink;
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

function loadResourceMetadata(contentRoot: string): {
  resourceMap: Map<string, RawResourceMetadata>;
  pdfTitleMap: Map<string, string>;
} {
  const resourcesDir = path.join(contentRoot, "resources");
  const resourceMap = new Map<string, RawResourceMetadata>();
  const pdfTitleMap = new Map<string, string>();

  if (!fs.existsSync(resourcesDir)) {
    return { resourceMap, pdfTitleMap };
  }

  const dataFiles = findFiles(resourcesDir, (fp) => fp.endsWith("data.json"));
  for (const dataFile of dataFiles) {
    const resourceId = path.basename(path.dirname(dataFile));

    try {
      const data = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
      const rawTitle = typeof data.title === "string" ? normalizeWhitespace(data.title) : "";
      const cleanedTitle = stripDownloadArtifacts(rawTitle);
      const title = rawTitle || normalizeWhitespace(resourceId.replace(/-/g, " "));
      const resolvedTitle = cleanedTitle || title;

      const filePath = typeof data.file === "string" ? data.file : null;
      const originalFilename = filePath ? filePath.split("/").pop() ?? null : null;

      if (originalFilename?.toLowerCase().endsWith(".pdf")) {
        pdfTitleMap.set(originalFilename, resolvedTitle);
      }

      const contextText = `${resolvedTitle} ${originalFilename ?? ""}`;
      const inferredResourceType = inferResourceType(contextText);

      resourceMap.set(resourceId, {
        id: resourceId,
        title: resolvedTitle,
        filePath,
        originalFilename,
        inferredResourceType,
        sectionTypeHint: sectionTypeForResource(inferredResourceType, contextText),
        numberHint: extractNumberHint(contextText),
      });
    } catch {
      // Ignore malformed resource metadata files
    }
  }

  return { resourceMap, pdfTitleMap };
}

async function uploadStaticPdfs(
  contentRoot: string,
  slug: string,
  pdfTitleMap: Map<string, string>,
): Promise<UploadResult> {
  const staticDir = path.join(contentRoot, "static_resources");
  const pdfUrlByFilename = new Map<string, string>();
  const pdfRenameMap = new Map<string, string>();

  if (!fs.existsSync(staticDir)) {
    return {
      uploadedPdfCount: 0,
      pdfUrlByFilename,
      pdfRenameMap,
    };
  }

  const usedFilenames = new Set<string>();
  let uploadedPdfCount = 0;

  const staticFiles = fs.readdirSync(staticDir).sort((a, b) => a.localeCompare(b));
  for (const file of staticFiles) {
    if (!file.toLowerCase().endsWith(".pdf")) continue;

    const htmlTitle = pdfTitleMap.get(file);
    if (isTranscriptArtifact(htmlTitle ?? "", file)) {
      continue;
    }
    let newFilename = htmlTitle ? titleToFilename(htmlTitle) : file;

    if (usedFilenames.has(newFilename)) {
      let i = 2;
      while (usedFilenames.has(newFilename.replace(/\.pdf$/i, `-${i}.pdf`))) i++;
      newFilename = newFilename.replace(/\.pdf$/i, `-${i}.pdf`);
    }

    usedFilenames.add(newFilename);

    const filePath = path.join(staticDir, file);
    const objectPath = `${STORAGE_PREFIX}/${slug}/${newFilename}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, fs.readFileSync(filePath), {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Error uploading PDF ${file}: ${uploadError.message}`);
    }

    const url = buildStoragePublicUrl(objectPath);
    pdfUrlByFilename.set(newFilename, url);
    pdfRenameMap.set(file, newFilename);
    uploadedPdfCount++;

    if (htmlTitle) {
      console.log(`  ${file} -> ${newFilename} ("${htmlTitle}")`);
    }
  }

  return {
    uploadedPdfCount,
    pdfUrlByFilename,
    pdfRenameMap,
  };
}

function crawlCourseSite(contentRoot: string): CrawledPage[] {
  const htmlAbsolutePaths = findFiles(contentRoot, (fp) => fp.endsWith(".html"));
  const absoluteByRelative = new Map<string, string>();

  for (const absolutePath of htmlAbsolutePaths) {
    const relativePath = toPosixPath(path.relative(contentRoot, absolutePath));
    absoluteByRelative.set(relativePath, absolutePath);
  }

  const htmlRelativePaths = Array.from(absoluteByRelative.keys()).sort((a, b) => a.localeCompare(b));

  if (!htmlRelativePaths.length) {
    throw new Error("No HTML files found in extracted course zip.");
  }

  const htmlSet = new Set(htmlRelativePaths);
  const queue: string[] = [];
  const queued = new Set<string>();
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];

  const enqueue = (relativePath: string | null) => {
    if (!relativePath) return;
    if (!htmlSet.has(relativePath)) return;
    if (visited.has(relativePath) || queued.has(relativePath)) return;
    queue.push(relativePath);
    queued.add(relativePath);
  };

  const seed = htmlSet.has("index.html") ? "index.html" : htmlRelativePaths[0];
  enqueue(seed);

  if (htmlSet.has("index.html")) {
    const indexAbsolutePath = absoluteByRelative.get("index.html");
    if (indexAbsolutePath) {
      const indexHtml = fs.readFileSync(indexAbsolutePath, "utf-8");
      const $index = cheerio.load(indexHtml);
      $index("nav a[href], .course-nav a[href], #course-nav a[href], [role=navigation] a[href], .sidenav a[href]").each((_, el) => {
        const href = $index(el).attr("href") ?? "";
        const resolved = resolveLocalHtmlPath(href, "index.html", htmlSet);
        enqueue(resolved);
      });
    }
  }

  const processQueuedPage = (relativePath: string) => {
    const absolutePath = absoluteByRelative.get(relativePath);
    if (!absolutePath) return;

    const html = fs.readFileSync(absolutePath, "utf-8");
    const $ = cheerio.load(html);

    const title = normalizeWhitespace($("title").first().text())
      || normalizeWhitespace($("h1").first().text())
      || relativePath;

    pages.push({
      relativePath,
      absolutePath,
      title,
      order: pages.length,
      sourcePriority: sourcePriorityForPage(relativePath),
    });

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const resolved = resolveLocalHtmlPath(href, relativePath, htmlSet);
      enqueue(resolved);
    });
  };

  while (queue.length > 0) {
    const relativePath = queue.shift()!;
    queued.delete(relativePath);
    if (visited.has(relativePath)) continue;

    visited.add(relativePath);
    processQueuedPage(relativePath);
  }

  for (const relativePath of htmlRelativePaths) {
    enqueue(relativePath);
  }

  while (queue.length > 0) {
    const relativePath = queue.shift()!;
    queued.delete(relativePath);
    if (visited.has(relativePath)) continue;

    visited.add(relativePath);
    processQueuedPage(relativePath);
  }

  return pages;
}

function extractResourceOccurrences(crawledPages: CrawledPage[]): ResourceOccurrence[] {
  const occurrences: ResourceOccurrence[] = [];

  for (const page of crawledPages) {
    const html = fs.readFileSync(page.absolutePath, "utf-8");
    const $ = cheerio.load(html);

    const anchors = $("a[href]").toArray();
    anchors.forEach((el, idx) => {
      const href = $(el).attr("href") ?? "";
      const resourceId = extractResourceIdFromHref(href);
      if (!resourceId) return;

      const linkText = extractAnchorDisplayText($, el);
      const rowHeader = extractTableRowHeader($, el);
      const columnHeader = extractTableColumnHeader($, el);

      const contextText = [linkText, rowHeader ?? "", columnHeader ?? "", page.relativePath, page.title]
        .join(" ")
        .trim();

      const weekHint = extractWeekNumber(contextText);
      const numberHint = extractNumberHint(contextText);

      occurrences.push({
        resourceId,
        linkText,
        pagePath: page.relativePath,
        pageOrder: page.order,
        linkOrder: idx,
        sourcePriority: page.sourcePriority,
        weekHint,
        numberHint,
        inferredResourceType: inferResourceType(contextText),
        rowHeader,
        columnHeader,
      });
    });
  }

  return occurrences;
}

function extractVideoMetadataFromHtml(html: string): { youtubeId: string | null; archiveUrl: string | null } {
  const youtubeId = extractYouTubeId(html);
  const archiveUrl = extractArchiveUrl(html);
  return { youtubeId, archiveUrl };
}

function extractLectures(
  contentRoot: string,
  crawledPages: CrawledPage[],
  rawResourceMap: Map<string, RawResourceMetadata>,
): LectureEntry[] {
  const lectureByKey = new Map<string, LectureEntry>();

  const upsertLecture = (candidate: LectureEntry) => {
    const key = candidate.resourceId
      ? `res:${candidate.resourceId}`
      : candidate.youtubeId
        ? `yt:${candidate.youtubeId}`
        : candidate.archiveUrl
          ? `arch:${candidate.archiveUrl.replace(/^http:\/\//i, "https://")}`
          : candidate.lectureNumber !== null
            ? `num:${candidate.lectureNumber}`
            : `title:${slugify(candidate.title)}:${candidate.slug}`;
    const existing = lectureByKey.get(key);
    if (!existing) {
      lectureByKey.set(key, candidate);
      return;
    }

    if (!existing.youtubeId && candidate.youtubeId) existing.youtubeId = candidate.youtubeId;
    if (!existing.archiveUrl && candidate.archiveUrl) existing.archiveUrl = candidate.archiveUrl;
    if (!existing.resourceId && candidate.resourceId) existing.resourceId = candidate.resourceId;
    if (existing.lectureNumber === null && candidate.lectureNumber !== null) {
      existing.lectureNumber = candidate.lectureNumber;
    }

    const currentTuple = [existing.sourcePriority, existing.pageOrder, existing.linkOrder] as const;
    const candidateTuple = [candidate.sourcePriority, candidate.pageOrder, candidate.linkOrder] as const;
    if (compareHintTuple(...candidateTuple, ...currentTuple) < 0) {
      existing.sourcePriority = candidate.sourcePriority;
      existing.pageOrder = candidate.pageOrder;
      existing.linkOrder = candidate.linkOrder;
    }

    if (isGenericDownloadLabel(existing.title) && !isGenericDownloadLabel(candidate.title)) {
      existing.title = candidate.title;
    } else if (existing.title.length < candidate.title.length) {
      existing.title = candidate.title;
    }
  };

  for (const page of crawledPages) {
    const html = fs.readFileSync(page.absolutePath, "utf-8");
    const $ = cheerio.load(html);
    const isVideoGalleryPage = page.relativePath.toLowerCase().includes("video_galleries");

    const anchors = $("a[href]").toArray();
    anchors.forEach((el, idx) => {
      const $a = $(el);
      const href = $a.attr("href") ?? "";
      const imgSrc = $a.find("img").attr("src") ?? "";
      const resourceId = extractResourceIdFromHref(href);

      const anchorTitle = extractAnchorDisplayText($, el);
      const metadataTitle = resourceId ? rawResourceMap.get(resourceId)?.title ?? "" : "";
      const headingFallback = normalizeWhitespace($("h1").first().text());
      const fallbackTitle = headingFallback || `Lecture ${lectureByKey.size + 1}`;
      const candidateTitle = isGenericDownloadLabel(anchorTitle) && metadataTitle
        ? metadataTitle
        : anchorTitle;
      let title = stripDownloadArtifacts(candidateTitle || metadataTitle || fallbackTitle);

      const youtubeId = extractYouTubeId(href) ?? extractYouTubeId(imgSrc);
      const archiveUrl = /archive\.org\/download\/.+\.mp4/i.test(href) ? href : null;
      if (archiveUrl && isGenericDownloadLabel(title)) {
        const derivedTitle = deriveTitleFromMediaUrl(archiveUrl);
        if (derivedTitle) title = derivedTitle;
      }
      const looksLikeLecture = /\blecture\b/i.test(`${title} ${page.relativePath}`);
      const hrefHasVideoSignal = /\b(video|watch)\b|youtube|youtu\.be|archive\.org|video_galleries/i.test(href);
      const hasVideoSignal = Boolean(
        youtubeId
        || archiveUrl
        || (isVideoGalleryPage && resourceId)
        || (resourceId && looksLikeLecture && hrefHasVideoSignal),
      );

      if (!hasVideoSignal) return;

      const slug = resourceId
        ?? slugFromHref(href)
        ?? `${path.basename(page.relativePath, ".html")}-${idx + 1}`;

      upsertLecture({
        title,
        slug,
        resourceId,
        youtubeId,
        archiveUrl,
        lectureNumber: extractLectureNumber(title),
        sourcePriority: page.sourcePriority,
        pageOrder: page.order,
        linkOrder: idx,
      });
    });

    const iframes = $("iframe[src]").toArray();
    iframes.forEach((el, idx) => {
      const src = $(el).attr("src") ?? "";
      const youtubeId = extractYouTubeId(src);
      const archiveUrl = /archive\.org\/download\/.+\.mp4/i.test(src) ? src : null;
      if (!youtubeId && !archiveUrl) return;

      let title = stripDownloadArtifacts(
        normalizeWhitespace($("h1").first().text())
          || normalizeWhitespace($("h2").first().text())
          || normalizeWhitespace($("title").first().text())
          || `Lecture ${lectureByKey.size + 1}`,
      );
      if (archiveUrl && isGenericDownloadLabel(title)) {
        const derivedTitle = deriveTitleFromMediaUrl(archiveUrl);
        if (derivedTitle) title = derivedTitle;
      }

      upsertLecture({
        title,
        slug: `${path.basename(page.relativePath, ".html")}-iframe-${idx + 1}`,
        resourceId: null,
        youtubeId,
        archiveUrl,
        lectureNumber: extractLectureNumber(title),
        sourcePriority: page.sourcePriority,
        pageOrder: page.order,
        linkOrder: anchors.length + idx,
      });
    });
  }

  for (const lecture of lectureByKey.values()) {
    if (!lecture.resourceId) continue;

    const metadata = rawResourceMap.get(lecture.resourceId);
    if (metadata && isGenericDownloadLabel(lecture.title)) {
      lecture.title = metadata.title;
    }

    const resourcePagePath = path.join(contentRoot, "resources", lecture.resourceId, "index.html");
    if (!fs.existsSync(resourcePagePath)) continue;

    const html = fs.readFileSync(resourcePagePath, "utf-8");
    const metadataFromPage = extractVideoMetadataFromHtml(html);

    if (!lecture.youtubeId && metadataFromPage.youtubeId) {
      lecture.youtubeId = metadataFromPage.youtubeId;
    }

    if (!lecture.archiveUrl && metadataFromPage.archiveUrl) {
      lecture.archiveUrl = metadataFromPage.archiveUrl;
    }

    if (lecture.lectureNumber === null) {
      lecture.lectureNumber = extractLectureNumber(lecture.title);
    }
  }

  const sorted = Array.from(lectureByKey.values()).sort((a, b) => {
    if (a.lectureNumber !== null && b.lectureNumber !== null && a.lectureNumber !== b.lectureNumber) {
      return a.lectureNumber - b.lectureNumber;
    }

    if (a.lectureNumber !== null && b.lectureNumber === null) return -1;
    if (a.lectureNumber === null && b.lectureNumber !== null) return 1;

    if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
    if (a.pageOrder !== b.pageOrder) return a.pageOrder - b.pageOrder;
    return a.linkOrder - b.linkOrder;
  });

  const seenKeys = new Set<string>();
  const deduped: LectureEntry[] = [];

  for (const lecture of sorted) {
    const key = lecture.resourceId
      ? `res:${lecture.resourceId}`
      : lecture.youtubeId
        ? `yt:${lecture.youtubeId}`
        : lecture.archiveUrl
          ? `arch:${lecture.archiveUrl.replace(/^http:\/\//i, "https://")}`
          : lecture.lectureNumber !== null
            ? `num:${lecture.lectureNumber}`
            : `title:${slugify(lecture.title)}`;

    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(lecture);
  }

  return deduped;
}

function groupOccurrencesByResourceId(occurrences: ResourceOccurrence[]): Map<string, ResourceOccurrence[]> {
  const grouped = new Map<string, ResourceOccurrence[]>();

  for (const occurrence of occurrences) {
    if (!grouped.has(occurrence.resourceId)) grouped.set(occurrence.resourceId, []);
    grouped.get(occurrence.resourceId)!.push(occurrence);
  }

  for (const entry of grouped.values()) {
    entry.sort((a, b) => compareHintTuple(a.sourcePriority, a.pageOrder, a.linkOrder, b.sourcePriority, b.pageOrder, b.linkOrder));
  }

  return grouped;
}

function resolveVerifiedResources(
  rawResourceMap: Map<string, RawResourceMetadata>,
  occurrencesByResourceId: Map<string, ResourceOccurrence[]>,
  pdfRenameMap: Map<string, string>,
  pdfUrlByFilename: Map<string, string>,
): Map<string, VerifiedResource> {
  const verified = new Map<string, VerifiedResource>();

  for (const raw of rawResourceMap.values()) {
    const occurrenceEntries = occurrencesByResourceId.get(raw.id) ?? [];
    const occurrence = occurrenceEntries[0] ?? null;

    // Only keep resources explicitly referenced by crawled course pages.
    if (!occurrence) continue;

    if (!raw.originalFilename || !raw.originalFilename.toLowerCase().endsWith(".pdf")) continue;
    if (isTranscriptArtifact(raw.title, raw.originalFilename)) continue;

    const uploadedFilename = pdfRenameMap.get(raw.originalFilename);
    if (!uploadedFilename) continue;

    const pdfUrl = pdfUrlByFilename.get(uploadedFilename);
    if (!pdfUrl) continue;

    const occurrenceText = occurrence
      ? `${occurrence.linkText} ${occurrence.columnHeader ?? ""} ${occurrence.rowHeader ?? ""}`
      : "";

    const inferredFromOccurrence = occurrence?.inferredResourceType ?? "other";
    const resourceType = inferredFromOccurrence !== "other" ? inferredFromOccurrence : raw.inferredResourceType;

    const contextText = `${raw.title} ${occurrenceText} ${raw.originalFilename ?? ""}`;
    const sectionType = sectionTypeForResource(resourceType, contextText);

    verified.set(raw.id, {
      id: raw.id,
      title: raw.title,
      uploadedFilename,
      pdfUrl,
      resourceType,
      sectionType,
      numberHint: occurrence?.numberHint ?? raw.numberHint,
      weekHint: occurrence?.weekHint ?? extractWeekNumber(contextText),
      sourcePriority: occurrence?.sourcePriority ?? 9,
      pageOrder: occurrence?.pageOrder ?? Number.MAX_SAFE_INTEGER,
      linkOrder: occurrence?.linkOrder ?? Number.MAX_SAFE_INTEGER,
    });
  }

  return verified;
}

function defaultSectionTitle(sectionType: SectionType, numberHint: number | null, fallbackTitle: string): string {
  const cleanedFallback = normalizeWhitespace(stripSolutionWords(fallbackTitle));
  if (cleanedFallback && !isBlockedSidebarTitle(cleanedFallback)) return cleanedFallback;

  if (numberHint !== null) {
    if (sectionType === "problem_set") return `Problem Set ${numberHint}`;
    if (sectionType === "exam") return `Exam ${numberHint}`;
    if (sectionType === "recitation") return `Recitation ${numberHint}`;
    if (sectionType === "lecture") return `Lecture ${numberHint}`;
  }

  if (sectionType === "problem_set") return "Problem Set";
  if (sectionType === "exam") return "Exam";
  if (sectionType === "recitation") return "Recitation";
  if (sectionType === "lecture") return "Lecture";
  return "Resource";
}

function sectionTypePriority(type: SectionType): number {
  if (type === "lecture") return 0;
  if (type === "recitation") return 1;
  if (type === "other") return 2;
  if (type === "problem_set") return 3;
  if (type === "exam") return 4;
  return 5;
}

function resourceTypePriority(type: NonVideoResourceType): number {
  if (type === "problem_set" || type === "exam" || type === "recitation") return 0;
  if (type === "other" || type === "lecture_notes") return 1;
  if (type === "solution") return 2;
  return 3;
}

function findBestLectureHint(
  lecture: LectureEntry,
  allOccurrences: ResourceOccurrence[],
  occurrencesByResourceId: Map<string, ResourceOccurrence[]>,
): ResourceOccurrence | null {
  if (lecture.resourceId) {
    const byResource = occurrencesByResourceId.get(lecture.resourceId);
    if (byResource?.length) return byResource[0];
  }

  if (lecture.lectureNumber === null) return null;

  let best: ResourceOccurrence | null = null;
  for (const occurrence of allOccurrences) {
    if (occurrence.numberHint !== lecture.lectureNumber) continue;

    const looksLikeLecture = occurrence.inferredResourceType === "lecture_notes"
      || /\blecture\b/i.test(occurrence.linkText)
      || /\blecture\b/i.test(occurrence.columnHeader ?? "");

    if (!looksLikeLecture) continue;

    if (!best) {
      best = occurrence;
      continue;
    }

    const cmp = compareHintTuple(
      occurrence.sourcePriority,
      occurrence.pageOrder,
      occurrence.linkOrder,
      best.sourcePriority,
      best.pageOrder,
      best.linkOrder,
    );

    if (cmp < 0) best = occurrence;
  }

  return best;
}

function deriveResourceGroupKey(resource: VerifiedResource): string {
  if (resource.sectionType === "problem_set" || resource.sectionType === "exam" || resource.sectionType === "recitation") {
    if (resource.numberHint !== null) {
      return `${resource.sectionType}:${resource.numberHint}`;
    }

    const normalized = slugify(stripSolutionWords(resource.title));
    if (normalized) return `${resource.sectionType}:${normalized}`;
  }

  return `${resource.sectionType}:${resource.id}`;
}

function buildPreparedSectionsAgent(
  lectures: LectureEntry[],
  verifiedResources: Map<string, VerifiedResource>,
  allOccurrences: ResourceOccurrence[],
  occurrencesByResourceId: Map<string, ResourceOccurrence[]>,
): PreparedSection[] {
  const lectureIndexByNumber = new Map<number, number>();
  const lectureIndexByResourceId = new Map<string, number>();

  lectures.forEach((lecture, idx) => {
    if (lecture.lectureNumber !== null && !lectureIndexByNumber.has(lecture.lectureNumber)) {
      lectureIndexByNumber.set(lecture.lectureNumber, idx);
    }

    if (lecture.resourceId && !lectureIndexByResourceId.has(lecture.resourceId)) {
      lectureIndexByResourceId.set(lecture.resourceId, idx);
    }
  });

  const notesByLecture = new Map<number, string[]>();
  const assignedResourceIds = new Set<string>();

  for (const resource of verifiedResources.values()) {
    if (resource.resourceType !== "lecture_notes") continue;

    let lectureIndex: number | null = null;

    if (lectureIndexByResourceId.has(resource.id)) {
      lectureIndex = lectureIndexByResourceId.get(resource.id)!;
    } else if (resource.numberHint !== null && lectureIndexByNumber.has(resource.numberHint)) {
      lectureIndex = lectureIndexByNumber.get(resource.numberHint)!;
    }

    if (lectureIndex === null) continue;

    if (!notesByLecture.has(lectureIndex)) notesByLecture.set(lectureIndex, []);
    notesByLecture.get(lectureIndex)!.push(resource.id);
    assignedResourceIds.add(resource.id);
  }

  const sections: PreparedSection[] = [];
  let orderSeed = 0;

  for (let i = 0; i < lectures.length; i++) {
    const lecture = lectures[i];
    const resources: PreparedResource[] = [];

    if (lecture.youtubeId || lecture.archiveUrl) {
      resources.push({
        title: lecture.title,
        resourceType: "video",
        pdfPath: null,
        videoUrl: lecture.youtubeId ? `https://www.youtube.com/watch?v=${lecture.youtubeId}` : null,
        youtubeId: lecture.youtubeId,
        archiveUrl: lecture.archiveUrl,
      });
    }

    const noteIds = (notesByLecture.get(i) ?? []).sort((a, b) => a.localeCompare(b));
    for (const noteId of noteIds) {
      const note = verifiedResources.get(noteId);
      if (!note) continue;
      resources.push({
        title: note.title,
        resourceType: "lecture_notes",
        pdfPath: note.pdfUrl,
        videoUrl: null,
        youtubeId: null,
        archiveUrl: null,
      });
    }

    if (!resources.length) continue;

    const bestHint = findBestLectureHint(lecture, allOccurrences, occurrencesByResourceId);

    const lectureTitle = defaultSectionTitle(
      "lecture",
      lecture.lectureNumber ?? bestHint?.weekHint ?? i + 1,
      lecture.title,
    );

    sections.push({
      key: `lecture:${lecture.resourceId ?? lecture.slug ?? i}`,
      title: lectureTitle,
      slugBase: lecture.slug || lectureTitle,
      sectionType: "lecture",
      resources,
      weekHint: bestHint?.weekHint ?? lecture.lectureNumber ?? i + 1,
      sourcePriority: bestHint?.sourcePriority ?? lecture.sourcePriority,
      pageOrder: bestHint?.pageOrder ?? lecture.pageOrder,
      linkOrder: bestHint?.linkOrder ?? lecture.linkOrder,
      orderSeed: orderSeed++,
    });
  }

  interface ResourceGroup {
    key: string;
    sectionType: SectionType;
    title: string;
    numberHint: number | null;
    weekHint: number | null;
    sourcePriority: number;
    pageOrder: number;
    linkOrder: number;
    resources: VerifiedResource[];
  }

  const groups = new Map<string, ResourceGroup>();

  for (const resource of verifiedResources.values()) {
    if (assignedResourceIds.has(resource.id)) continue;

    const groupKey = deriveResourceGroupKey(resource);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        sectionType: resource.resourceType === "lecture_notes" ? "other" : resource.sectionType,
        title: resource.title,
        numberHint: resource.numberHint,
        weekHint: resource.weekHint ?? resource.numberHint,
        sourcePriority: resource.sourcePriority,
        pageOrder: resource.pageOrder,
        linkOrder: resource.linkOrder,
        resources: [],
      });
    }

    const group = groups.get(groupKey)!;
    group.resources.push(resource);

    if (resource.resourceType !== "solution") {
      group.title = resource.title;
    } else if (!group.title) {
      group.title = stripSolutionWords(resource.title);
    }

    if (group.numberHint === null && resource.numberHint !== null) {
      group.numberHint = resource.numberHint;
    }

    if (group.weekHint === null && resource.weekHint !== null) {
      group.weekHint = resource.weekHint;
    }

    const cmp = compareHintTuple(
      resource.sourcePriority,
      resource.pageOrder,
      resource.linkOrder,
      group.sourcePriority,
      group.pageOrder,
      group.linkOrder,
    );

    if (cmp < 0) {
      group.sourcePriority = resource.sourcePriority;
      group.pageOrder = resource.pageOrder;
      group.linkOrder = resource.linkOrder;
    }
  }

  for (const group of groups.values()) {
    const sortedResources = [...group.resources].sort((a, b) => {
      const typeDiff = resourceTypePriority(a.resourceType) - resourceTypePriority(b.resourceType);
      if (typeDiff !== 0) return typeDiff;
      return a.title.localeCompare(b.title);
    });

    const preparedResources: PreparedResource[] = sortedResources.map((resource) => ({
      title: resource.title,
      resourceType: resource.resourceType === "lecture_notes" ? "other" : resource.resourceType,
      pdfPath: resource.pdfUrl,
      videoUrl: null,
      youtubeId: null,
      archiveUrl: null,
    }));

    if (!preparedResources.length) continue;

    const title = defaultSectionTitle(group.sectionType, group.numberHint, group.title);
    const slugBase = `${group.sectionType}-${group.numberHint ?? ""}-${title}`;

    sections.push({
      key: `resource-group:${group.key}`,
      title,
      slugBase,
      sectionType: group.sectionType,
      resources: preparedResources,
      weekHint: group.weekHint ?? group.numberHint,
      sourcePriority: group.sourcePriority,
      pageOrder: group.pageOrder,
      linkOrder: group.linkOrder,
      orderSeed: orderSeed++,
    });
  }

  sections.sort((a, b) => {
    const aWeek = a.weekHint ?? Number.MAX_SAFE_INTEGER;
    const bWeek = b.weekHint ?? Number.MAX_SAFE_INTEGER;
    if (aWeek !== bWeek) return aWeek - bWeek;

    const typeDiff = sectionTypePriority(a.sectionType) - sectionTypePriority(b.sectionType);
    if (typeDiff !== 0) return typeDiff;

    const hintDiff = compareHintTuple(
      a.sourcePriority,
      a.pageOrder,
      a.linkOrder,
      b.sourcePriority,
      b.pageOrder,
      b.linkOrder,
    );
    if (hintDiff !== 0) return hintDiff;

    if (a.orderSeed !== b.orderSeed) return a.orderSeed - b.orderSeed;
    return a.title.localeCompare(b.title);
  });

  return sections;
}

export async function downloadCourse(slug: string) {
  console.log(`Looking up course with slug: ${slug}`);

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

  const courseUrl = course.url.endsWith("/") ? course.url : `${course.url}/`;

  console.log(`[Stage 0] Fetching download page: ${courseUrl}download`);
  const downloadPageRes = await fetch(`${courseUrl}download`);
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
    zipUrl = href.startsWith("http") ? href : new URL(href, courseUrl).toString();
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

  console.log("[Stage 1] Crawling extracted site graph...");
  const crawledPages = crawlCourseSite(contentRoot);
  console.log(`[Stage 1] Crawled ${crawledPages.length} HTML pages`);

  console.log("[Stage 2] Loading resource metadata from resources/*/data.json...");
  const { resourceMap: rawResourceMap, pdfTitleMap } = loadResourceMetadata(contentRoot);
  console.log(`[Stage 2] Loaded metadata for ${rawResourceMap.size} resources (${pdfTitleMap.size} PDF titles)`);

  console.log("[Stage 3] Uploading static_resources PDFs with deterministic renaming...");
  const {
    uploadedPdfCount,
    pdfUrlByFilename,
    pdfRenameMap,
  } = await uploadStaticPdfs(contentRoot, slug, pdfTitleMap);
  console.log(`[Stage 3] Uploaded ${uploadedPdfCount} PDFs`);

  console.log("[Stage 4] Extracting resource link occurrences from crawled pages...");
  const occurrences = extractResourceOccurrences(crawledPages);
  const occurrencesByResourceId = groupOccurrencesByResourceId(occurrences);
  console.log(`[Stage 4] Extracted ${occurrences.length} link occurrences across ${occurrencesByResourceId.size} resource IDs`);

  console.log("[Stage 5] Extracting lecture/video items from local HTML...");
  const lectures = extractLectures(contentRoot, crawledPages, rawResourceMap);
  console.log(`[Stage 5] Extracted ${lectures.length} lecture candidates`);

  console.log("[Stage 6] Resolving verified resources (must map to uploaded PDFs)...");
  const verifiedResources = resolveVerifiedResources(
    rawResourceMap,
    occurrencesByResourceId,
    pdfRenameMap,
    pdfUrlByFilename,
  );
  console.log(`[Stage 6] Resolved ${verifiedResources.size} verified resources`);

  console.log("[Stage 7] Sequencing with deterministic ordering agent...");
  const preparedSections = buildPreparedSectionsAgent(
    lectures,
    verifiedResources,
    occurrences,
    occurrencesByResourceId,
  );

  if (!preparedSections.length) {
    throw new Error("Ordering agent produced zero sections with verified resources.");
  }

  const previewCount = Math.min(12, preparedSections.length);
  console.log(`[Stage 7] Sequenced ${preparedSections.length} sections. Preview:`);
  for (let i = 0; i < previewCount; i++) {
    const section = preparedSections[i];
    console.log(`  ${i + 1}. [${section.sectionType}] ${section.title} (${section.resources.length} resources)`);
  }

  console.log("[Stage 8] Persisting sections and resources to database...");

  await supabase.from("resources").delete().eq("course_id", course.id);
  await supabase.from("course_sections").delete().eq("course_id", course.id);

  const usedSlugs = new Set<string>();
  const sectionRows: {
    course_id: number;
    title: string;
    slug: string;
    section_type: string;
    ordering: number;
  }[] = preparedSections.map((section, idx) => {
    const fallbackNumber = section.weekHint ?? idx + 1;
    const safeTitle = isBlockedSidebarTitle(section.title)
      ? defaultSectionTitle(section.sectionType, fallbackNumber, "")
      : section.title;

    return {
      course_id: course.id,
      title: safeTitle,
      slug: makeUniqueSlug(section.slugBase || safeTitle, usedSlugs),
      section_type: section.sectionType,
      ordering: idx,
    };
  });

  const { data: insertedSections, error: sectionInsertError } = await supabase
    .from("course_sections")
    .insert(sectionRows)
    .select("id, ordering");

  if (sectionInsertError) {
    throw new Error(`Error inserting sections: ${sectionInsertError.message}`);
  }

  const sectionIdByOrdering = new Map<number, number>();
  for (const row of insertedSections ?? []) {
    sectionIdByOrdering.set(row.ordering, row.id);
  }

  const resourceRows: {
    course_id: number;
    section_id: number | null;
    title: string;
    resource_type: string;
    pdf_path: string | null;
    video_url: string | null;
    youtube_id: string | null;
    archive_url: string | null;
    ordering: number;
  }[] = [];
  const seenVideoKeys = new Set<string>();
  let skippedDuplicateVideos = 0;

  for (let i = 0; i < preparedSections.length; i++) {
    const section = preparedSections[i];
    const sectionId = sectionIdByOrdering.get(i) ?? null;

    section.resources.forEach((resource, resourceIndex) => {
      if (resource.resourceType === "video") {
        const videoKey = resource.youtubeId
          ? `yt:${resource.youtubeId}`
          : resource.archiveUrl
            ? `arch:${resource.archiveUrl.replace(/^http:\/\//i, "https://")}`
            : resource.videoUrl
              ? `url:${resource.videoUrl}`
              : `title:${slugify(resource.title)}`;

        if (seenVideoKeys.has(videoKey)) {
          skippedDuplicateVideos++;
          return;
        }
        seenVideoKeys.add(videoKey);
      }

      resourceRows.push({
        course_id: course.id,
        section_id: sectionId,
        title: resource.title,
        resource_type: resource.resourceType,
        pdf_path: resource.pdfPath,
        video_url: resource.videoUrl,
        youtube_id: resource.youtubeId,
        archive_url: resource.archiveUrl,
        ordering: resourceIndex,
      });
    });
  }

  if (!resourceRows.length) {
    throw new Error("Sequencing produced sections but no resources.");
  }

  const { error: resourceInsertError } = await supabase
    .from("resources")
    .insert(resourceRows);

  if (resourceInsertError) {
    throw new Error(`Error inserting resources: ${resourceInsertError.message}`);
  }

  console.log(`[Stage 8] Inserted ${sectionRows.length} sections and ${resourceRows.length} resources`);
  if (skippedDuplicateVideos > 0) {
    console.log(`[Stage 8] Skipped ${skippedDuplicateVideos} duplicate video link(s)`);
  }

  const { error: updateError } = await supabase
    .from("courses")
    .update({
      content_downloaded: true,
      content_downloaded_at: new Date().toISOString(),
    })
    .eq("id", course.id);

  if (updateError) {
    console.error("Error updating course download status:", updateError.message);
  }

  const keepTmp = process.env.MYOCW_KEEP_TMP === "1";
  if (keepTmp) {
    console.log(`[Stage 9] Skipping temp cleanup (MYOCW_KEEP_TMP=1): ${TMP_DIR}`);
  } else {
    console.log("[Stage 9] Cleaning up temp files...");
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log("Done!");
  console.log("\nSummary:");
  console.log(`  Course: ${course.title}`);
  console.log(`  Crawled pages: ${crawledPages.length}`);
  console.log(`  Lecture candidates: ${lectures.length}`);
  console.log(`  Verified resources: ${verifiedResources.size}`);
  console.log(`  Sections persisted: ${sectionRows.length}`);
  console.log(`  Resources persisted: ${resourceRows.length}`);
  console.log(`  PDFs uploaded: ${uploadedPdfCount}`);
}

const __isMain = process.argv[1]?.includes("download-course");
if (__isMain) {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: pnpm download-course <course-slug>");
    console.error("Example: pnpm download-course 6-006-introduction-to-algorithms-spring-2020");
    process.exit(1);
  }

  downloadCourse(slug).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
