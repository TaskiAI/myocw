import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// --- Configuration ---

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const STORAGE_BUCKET = "mit-ocw";
const STORAGE_PREFIX = "courses";
const SUPABASE_PUBLIC_URL = SUPABASE_URL.replace(/\/$/, "");
const TMP_DIR = "/tmp/myocw-download";

// --- Types ---

type SectionType = "lecture" | "problem_set" | "exam" | "recitation" | "other";
type ResourceType = "video" | "problem_set" | "exam" | "solution" | "recitation" | "lecture_notes" | "other";
type NavType = "video_gallery" | "assignments" | "exams" | "recitations" | "lecture_supplements" | "other" | "skip";

interface IndexedItem {
  resourceSlug: string;
  title: string;
  youtubeId: string | null;
  archiveUrl: string | null;
  originalFilename: string | null;
  fileType: string | null;
  navType: NavType;
  order: number;
  numberHint: number | null;
}

interface PreparedResource {
  title: string;
  resourceType: ResourceType;
  pdfPath: string | null;
  contentText: string | null;
  videoUrl: string | null;
  youtubeId: string | null;
  archiveUrl: string | null;
}

interface PreparedSection {
  title: string;
  slugBase: string;
  sectionType: SectionType;
  resources: PreparedResource[];
  orderHint: number;
}

interface UploadResult {
  uploadedPdfCount: number;
  pdfUrlByFilename: Map<string, string>;
  pdfRenameMap: Map<string, string>;
  textContentByOriginalFilename: Map<string, string>;
  zipContentsMap: Map<string, { pdfs: string[]; texts: string[] }>;
}

// --- Utilities ---

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

function extractNumberHint(text: string): number | null {
  // Scholar courses use "Ses1.4" (Unit 1, Session 4) — encode as unit*100+session
  const sesMatch = text.match(/Ses(\d{1,2})\.(\d{1,2})/i);
  if (sesMatch) {
    const unit = parseInt(sesMatch[1], 10);
    const session = parseInt(sesMatch[2], 10);
    return unit * 100 + session;
  }

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

// Format section title: for Scholar-style encoded hints (e.g., 101 = Unit 1 Session 1),
// produce "Problem Set 1.1"; for plain numbers, produce "Problem Set 3".
function formatSectionTitle(prefix: string, num: number): string {
  if (num >= 100) {
    const unit = Math.floor(num / 100);
    const session = num % 100;
    return `${prefix} ${unit}.${session}`;
  }
  return `${prefix} ${num}`;
}

function inferResourceType(text: string, navType?: NavType): ResourceType {
  const lower = text.toLowerCase();
  if (/\b(solution|solutions|answer key|answers|soln?)\b/.test(lower) || /sol\.pdf$/i.test(lower)) return "solution";
  if (/\b(recitation|tutorial|problem session)\b/.test(lower)) return "recitation";
  if (/\b(quiz|midterm|final|exam|test)\b/.test(lower)) return "exam";
  if (/\b(problem\s*set|pset|assignment|homework|hw)\b/.test(lower) || /prob\.pdf$/i.test(lower)) return "problem_set";
  if (/\b(lecture|notes?|slides?)\b/.test(lower)) return "lecture_notes";
  // Fall back to navType-based inference for Scholar courses
  if (navType === "assignments") return "problem_set";
  if (navType === "exams") return "exam";
  if (navType === "recitations") return "recitation";
  return "other";
}

const TEXT_EXTENSIONS = new Set([".txt", ".py", ".tex", ".md", ".r", ".m", ".java", ".c", ".cpp", ".h", ".js", ".ts", ".html", ".css", ".sql", ".sh", ".rb", ".pl"]);
const ZIP_JUNK_PATTERNS = ["__MACOSX/", ".DS_Store"];

function isZipJunkEntry(entryName: string): boolean {
  const name = entryName.replace(/\\/g, "/");
  return ZIP_JUNK_PATTERNS.some((p) => name.includes(p)) || path.basename(name).startsWith(".");
}

// --- Stage 1: Walk HTML pages ---

function classifyNavPath(relativePath: string, title: string): NavType {
  const lower = relativePath.toLowerCase();
  const titleLower = title.toLowerCase();

  if (
    lower.includes("syllabus") || lower.includes("instructor-insights") || lower.includes("calendar")
    || lower.includes("resource-index") || lower.includes("download/")
  ) {
    return "skip";
  }

  if (lower.includes("video_galleries")) return "video_gallery";
  if (lower.includes("/assignments") || lower.includes("/problem") || titleLower.includes("assignment") || titleLower.includes("problem set")) return "assignments";
  if (lower.includes("/exams") || lower.includes("/quizzes") || titleLower.includes("exam") || titleLower.includes("quiz")) return "exams";
  if (lower.includes("/recitations") || titleLower.includes("recitation")) return "recitations";
  if (
    lower.includes("lecture-slides") || lower.includes("lecture-notes") || lower.includes("lecture-code")
    || titleLower.includes("lecture slides") || titleLower.includes("lecture notes")
  ) {
    return "lecture_supplements";
  }

  return "other";
}

function walkHtmlPages(contentRoot: string): IndexedItem[] {
  const indexPath = path.join(contentRoot, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error("No index.html found in extracted course zip.");
  }

  const indexHtml = fs.readFileSync(indexPath, "utf-8");
  const $index = cheerio.load(indexHtml);

  // Collect all nav link hrefs (parent + child items), deduplicate by resolved path
  const seenPaths = new Set<string>();
  const navPages: { title: string; absolutePath: string; relativePath: string }[] = [];

  $index("nav a[href], .course-nav a[href], [role=navigation] a[href]").each((_, el) => {
    const href = $index(el).attr("href") ?? "";
    const title = normalizeWhitespace($index(el).text());
    if (!href || !title || href.startsWith("#") || href.startsWith("http")) return;

    const absolutePath = path.resolve(path.dirname(indexPath), href);
    if (seenPaths.has(absolutePath)) return;
    seenPaths.add(absolutePath);

    if (!fs.existsSync(absolutePath)) return;
    const relativePath = path.relative(contentRoot, absolutePath);
    navPages.push({ title, absolutePath, relativePath });
  });

  // Fallback: if no nav links found, scan for section index pages
  if (!navPages.length) {
    for (const dir of ["video_galleries", "pages"]) {
      const dirPath = path.join(contentRoot, dir);
      if (!fs.existsSync(dirPath)) continue;

      const htmlFiles = findFiles(dirPath, (fp) => fp.endsWith("index.html"));
      for (const htmlFile of htmlFiles) {
        const relativePath = path.relative(contentRoot, htmlFile);
        if (seenPaths.has(htmlFile)) continue;
        seenPaths.add(htmlFile);
        const dirName = path.basename(path.dirname(htmlFile));
        const title = normalizeWhitespace(dirName.replace(/-/g, " "));
        navPages.push({ title, absolutePath: htmlFile, relativePath });
      }
    }
  }

  // Scholar courses link to session/topic pages from within part pages (not nav).
  // Discover child pages under /pages/ that are linked from known nav pages.
  const childPages: typeof navPages = [];
  for (const navPage of navPages) {
    if (!navPage.relativePath.startsWith("pages/")) continue;
    const pageHtml = fs.readFileSync(navPage.absolutePath, "utf-8");
    const $ = cheerio.load(pageHtml);
    $("main a[href], #course-content-section a[href], .course-content a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      const abs = path.resolve(path.dirname(navPage.absolutePath), href);
      if (seenPaths.has(abs)) return;
      const rel = path.relative(contentRoot, abs);
      if (!rel.startsWith("pages/") || !fs.existsSync(abs)) return;
      seenPaths.add(abs);
      const linkTitle = normalizeWhitespace($(el).text());
      childPages.push({ title: linkTitle || path.basename(path.dirname(abs)).replace(/-/g, " "), absolutePath: abs, relativePath: rel });
    });
  }
  navPages.push(...childPages);

  const items: IndexedItem[] = [];
  const seenSlugs = new Set<string>();
  let globalOrder = 0;

  for (const navPage of navPages) {
    const navType = classifyNavPath(navPage.relativePath, navPage.title);
    if (navType === "skip") continue;

    const pageHtml = fs.readFileSync(navPage.absolutePath, "utf-8");
    const $ = cheerio.load(pageHtml);

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const resourceMatch = href.match(/resources\/([^/]+)/);
      if (!resourceMatch) return;

      const resourceSlug = resourceMatch[1];
      if (seenSlugs.has(resourceSlug)) return;

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
      const hasSupportedFile = (() => {
        if (!originalFilename) return false;
        const lower = originalFilename.toLowerCase();
        const ext = path.extname(lower);
        return lower.endsWith(".pdf") || lower.endsWith(".zip") || TEXT_EXTENSIONS.has(ext);
      })();
      if (!youtubeId && !archiveUrl && !hasSupportedFile) return;

      seenSlugs.add(resourceSlug);
      const contextText = `${title} ${originalFilename ?? ""} ${navPage.title}`;

      // Scholar courses put everything under /pages/ so navType is "other".
      // Use data.json learning_resource_types to reclassify when possible.
      let effectiveNavType = navType;
      if (effectiveNavType === "other") {
        const lrt = Array.isArray(data.learning_resource_types)
          ? (data.learning_resource_types as string[]).map((s) => s.toLowerCase())
          : [];
        if (lrt.some((t) => t.includes("problem") || t.includes("assignment") || t.includes("homework"))) {
          effectiveNavType = "assignments";
        } else if (lrt.some((t) => t.includes("exam"))) {
          effectiveNavType = "exams";
        } else if (lrt.some((t) => t.includes("recitation"))) {
          effectiveNavType = "recitations";
        } else if (lrt.some((t) => t.includes("lecture video"))) {
          effectiveNavType = "video_gallery";
        } else if (lrt.some((t) => t.includes("lecture notes") || t.includes("lecture slides"))) {
          effectiveNavType = "lecture_supplements";
        }
      }

      items.push({
        resourceSlug,
        title,
        youtubeId,
        archiveUrl,
        originalFilename,
        fileType: typeof data.file_type === "string" ? data.file_type : null,
        navType: effectiveNavType,
        order: globalOrder++,
        numberHint: extractNumberHint(contextText),
      });
    });
  }

  return items;
}

// --- Build PDF title map from resource data.json files ---

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
        const ext = filename.toLowerCase();
        if (ext.endsWith(".pdf") || ext.endsWith(".zip")) {
          titleMap.set(filename, title);
        }
      }
    } catch {
      // skip malformed data.json
    }
  }

  return titleMap;
}

// --- Stage 2: Upload static PDFs + extract ZIPs ---

async function uploadStaticPdfs(
  contentRoot: string,
  slug: string,
  pdfTitleMap: Map<string, string>,
): Promise<UploadResult> {
  const staticDir = path.join(contentRoot, "static_resources");
  const pdfUrlByFilename = new Map<string, string>();
  const pdfRenameMap = new Map<string, string>();
  const textContentByOriginalFilename = new Map<string, string>();
  const zipContentsMap = new Map<string, { pdfs: string[]; texts: string[] }>();

  if (!fs.existsSync(staticDir)) {
    return { uploadedPdfCount: 0, pdfUrlByFilename, pdfRenameMap, textContentByOriginalFilename, zipContentsMap };
  }

  const usedFilenames = new Set<string>();
  let uploadedPdfCount = 0;

  const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB
  const uploadPdf = async (filePath: string, file: string, title: string | undefined) => {
    if (isTranscriptArtifact(title ?? "", file)) return;

    const fileSize = fs.statSync(filePath).size;
    if (fileSize > MAX_PDF_SIZE) {
      console.log(`  Skipping oversized PDF (${(fileSize / 1024 / 1024).toFixed(1)} MB): ${file}`);
      return;
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
      throw new Error(`Error uploading PDF ${file}: ${uploadError.message}`);
    }

    const url = buildStoragePublicUrl(objectPath);
    pdfUrlByFilename.set(newFilename, url);
    pdfRenameMap.set(file, newFilename);
    uploadedPdfCount++;

    if (title) {
      console.log(`  ${file} -> ${newFilename} ("${title}")`);
    }
  };

  // Upload standalone PDFs
  const staticFiles = fs.readdirSync(staticDir).sort((a, b) => a.localeCompare(b));
  for (const file of staticFiles) {
    if (!file.toLowerCase().endsWith(".pdf")) continue;
    await uploadPdf(path.join(staticDir, file), file, pdfTitleMap.get(file));
  }

  // Extract ZIP files and process their contents
  for (const file of staticFiles) {
    if (!file.toLowerCase().endsWith(".zip")) continue;

    const zipPath = path.join(staticDir, file);
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipPath);
    } catch {
      console.warn(`  Skipping malformed ZIP: ${file}`);
      continue;
    }

    const entries = zip.getEntries();
    const contents: { pdfs: string[]; texts: string[] } = { pdfs: [], texts: [] };

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (isZipJunkEntry(entry.entryName)) continue;

      const basename = path.basename(entry.entryName);
      const ext = path.extname(basename).toLowerCase();

      if (ext === ".pdf") {
        const tempPath = path.join(staticDir, basename);
        const existed = fs.existsSync(tempPath);
        if (!existed) {
          fs.writeFileSync(tempPath, entry.getData());
          const title = pdfTitleMap.get(basename)
            ?? normalizeWhitespace(basename.replace(/\.pdf$/i, "").replace(/[-_]/g, " "));
          await uploadPdf(tempPath, basename, title);
          fs.unlinkSync(tempPath);
        }
        contents.pdfs.push(basename);
      } else if (TEXT_EXTENSIONS.has(ext)) {
        try {
          const content = entry.getData().toString("utf-8");
          if (content.trim()) {
            textContentByOriginalFilename.set(basename, content);
            contents.texts.push(basename);
          }
        } catch {
          console.warn(`  Skipping unreadable text file in ZIP: ${entry.entryName}`);
        }
      }
    }

    if (contents.pdfs.length || contents.texts.length) {
      console.log(`  Extracted ${contents.pdfs.length + contents.texts.length} file(s) from ZIP: ${file}`);
      zipContentsMap.set(file, contents);
    }
  }

  return { uploadedPdfCount, pdfUrlByFilename, pdfRenameMap, textContentByOriginalFilename, zipContentsMap };
}

// --- Stage 3: Build sections from indexed items ---

function resolveItemToResources(item: IndexedItem, upload: UploadResult): PreparedResource[] {
  // Video resources (youtube_key or archive_url in data.json)
  if (item.youtubeId || item.archiveUrl) {
    return [{
      title: item.title,
      resourceType: "video",
      pdfPath: null,
      contentText: null,
      videoUrl: item.youtubeId ? `https://www.youtube.com/watch?v=${item.youtubeId}` : null,
      youtubeId: item.youtubeId,
      archiveUrl: item.archiveUrl,
    }];
  }

  if (!item.originalFilename) return [];

  const ext = item.originalFilename.toLowerCase();
  const contextText = `${item.title} ${item.originalFilename}`;
  const resType = inferResourceType(contextText, item.navType);

  // PDF resources
  if (ext.endsWith(".pdf")) {
    const renamedFile = upload.pdfRenameMap.get(item.originalFilename);
    if (!renamedFile) return [];
    const pdfUrl = upload.pdfUrlByFilename.get(renamedFile);
    if (!pdfUrl) return [];

    return [{
      title: item.title,
      resourceType: resType,
      pdfPath: pdfUrl,
      contentText: null,
      videoUrl: null,
      youtubeId: null,
      archiveUrl: null,
    }];
  }

  // ZIP resources → return resources from extracted contents
  if (ext.endsWith(".zip")) {
    const contents = upload.zipContentsMap.get(item.originalFilename);
    if (!contents) return [];

    const resources: PreparedResource[] = [];

    for (const pdfBasename of contents.pdfs) {
      const renamedFile = upload.pdfRenameMap.get(pdfBasename);
      if (!renamedFile) continue;
      const pdfUrl = upload.pdfUrlByFilename.get(renamedFile);
      if (!pdfUrl) continue;

      resources.push({
        title: normalizeWhitespace(pdfBasename.replace(/\.pdf$/i, "").replace(/[-_]/g, " ")),
        resourceType: resType !== "other" ? resType : inferResourceType(pdfBasename),
        pdfPath: pdfUrl,
        contentText: null,
        videoUrl: null,
        youtubeId: null,
        archiveUrl: null,
      });
    }

    for (const textBasename of contents.texts) {
      const content = upload.textContentByOriginalFilename.get(textBasename);
      if (!content) continue;

      resources.push({
        title: normalizeWhitespace(textBasename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")),
        resourceType: "other",
        pdfPath: null,
        contentText: content,
        videoUrl: null,
        youtubeId: null,
        archiveUrl: null,
      });
    }

    return resources;
  }

  // Standalone text files
  if (TEXT_EXTENSIONS.has(path.extname(ext))) {
    const content = upload.textContentByOriginalFilename.get(item.originalFilename);
    if (!content) return [];

    return [{
      title: item.title,
      resourceType: "other",
      pdfPath: null,
      contentText: content,
      videoUrl: null,
      youtubeId: null,
      archiveUrl: null,
    }];
  }

  return [];
}

function buildSections(items: IndexedItem[], upload: UploadResult): PreparedSection[] {
  const sections: PreparedSection[] = [];

  // Separate items by navType
  const videoItems = items.filter((i) => i.navType === "video_gallery");
  const supplementItems = items.filter((i) => i.navType === "lecture_supplements");
  const assignmentItems = items.filter((i) => i.navType === "assignments");
  const examItems = items.filter((i) => i.navType === "exams");
  const recitationItems = items.filter((i) => i.navType === "recitations");
  const otherItems = items.filter((i) => i.navType === "other");

  // 1. Create lecture sections from video gallery items
  const lectureByNumber = new Map<number, number>(); // numberHint → section index
  let lectureCounter = 0;

  for (const item of videoItems) {
    const resources = resolveItemToResources(item, upload);
    if (!resources.length) continue;

    lectureCounter++;
    const num = item.numberHint ?? lectureCounter;
    const sectionIdx = sections.length;

    sections.push({
      title: item.title || `Lecture ${num}`,
      slugBase: slugify(item.title || `lecture-${num}`),
      sectionType: "lecture",
      resources,
      orderHint: item.order,
    });

    lectureByNumber.set(num, sectionIdx);
  }

  // 2. Attach lecture supplements to matching lecture sections by number
  const unattachedSupplements: IndexedItem[] = [];
  for (const item of supplementItems) {
    const resolved = resolveItemToResources(item, upload);
    if (!resolved.length) continue;

    if (item.numberHint !== null && lectureByNumber.has(item.numberHint)) {
      const sectionIdx = lectureByNumber.get(item.numberHint)!;
      sections[sectionIdx].resources.push(...resolved);
    } else {
      unattachedSupplements.push(item);
    }
  }

  // Helper: filter to only resources that have a displayable file (PDF or text).
  // Videos are only meaningful in lecture sections; non-lecture sections without
  // a PDF or text file would show "No files available" in the player.
  function fileResources(rs: PreparedResource[]): PreparedResource[] {
    return rs.filter((r) => r.pdfPath !== null || r.contentText !== null);
  }

  // 3. Create assignment sections (group by numberHint)
  const assignmentGroups = new Map<string, IndexedItem[]>();
  for (const item of assignmentItems) {
    const key = item.numberHint !== null ? `pset-${item.numberHint}` : `pset-slug-${item.resourceSlug}`;
    if (!assignmentGroups.has(key)) assignmentGroups.set(key, []);
    assignmentGroups.get(key)!.push(item);
  }

  for (const [, group] of assignmentGroups) {
    const resources = fileResources(
      group.flatMap((item) => resolveItemToResources(item, upload))
    );
    if (!resources.length) continue;

    const num = group[0].numberHint;
    const title = num !== null ? formatSectionTitle("Problem Set", num) : group[0].title;
    sections.push({
      title,
      slugBase: slugify(title),
      sectionType: "problem_set",
      resources,
      orderHint: group[0].order,
    });
  }

  // 4. Create exam sections (group by numberHint)
  const examGroups = new Map<string, IndexedItem[]>();
  for (const item of examItems) {
    const key = item.numberHint !== null ? `exam-${item.numberHint}` : `exam-slug-${item.resourceSlug}`;
    if (!examGroups.has(key)) examGroups.set(key, []);
    examGroups.get(key)!.push(item);
  }

  for (const [, group] of examGroups) {
    const resources = fileResources(
      group.flatMap((item) => resolveItemToResources(item, upload))
    );
    if (!resources.length) continue;

    const num = group[0].numberHint;
    const title = num !== null ? formatSectionTitle("Exam", num) : group[0].title;
    sections.push({
      title,
      slugBase: slugify(title),
      sectionType: "exam",
      resources,
      orderHint: group[0].order,
    });
  }

  // 5. Create recitation sections
  for (const item of recitationItems) {
    const resources = fileResources(resolveItemToResources(item, upload));
    if (!resources.length) continue;

    const num = item.numberHint;
    const title = num !== null ? `Recitation ${num}` : item.title;
    sections.push({
      title,
      slugBase: slugify(title),
      sectionType: "recitation",
      resources,
      orderHint: item.order,
    });
  }

  // 6. Create sections for unattached supplements and other items
  for (const item of [...unattachedSupplements, ...otherItems]) {
    const resources = fileResources(resolveItemToResources(item, upload));
    if (!resources.length) continue;

    sections.push({
      title: item.title,
      slugBase: slugify(item.title),
      sectionType: "other",
      resources,
      orderHint: item.order,
    });
  }

  // Sort: lectures first (by appearance order), then other types by appearance order
  const typeOrder = (t: SectionType) =>
    t === "lecture" ? 0 : t === "recitation" ? 1 : t === "other" ? 2 : t === "problem_set" ? 3 : 4;

  sections.sort((a, b) => {
    const typeDiff = typeOrder(a.sectionType) - typeOrder(b.sectionType);
    if (typeDiff !== 0) return typeDiff;
    return a.orderHint - b.orderHint;
  });

  return sections;
}

// --- Main pipeline ---

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

  // Stage 0: Download + extract ZIP
  console.log(`\n[Stage 0] Fetching download page: ${courseUrl}download`);
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

  // Stage 1: Walk HTML pages
  console.log("\n[Stage 1] Walking HTML pages from nav...");
  const items = walkHtmlPages(contentRoot);
  const videoCount = items.filter((i) => i.navType === "video_gallery").length;
  const nonVideoCount = items.length - videoCount;
  console.log(`[Stage 1] Found ${items.length} resources (${videoCount} videos, ${nonVideoCount} non-video)`);

  // Stage 2: Upload static files
  console.log("\n[Stage 2] Building PDF title map...");
  const pdfTitleMap = buildPdfTitleMap(contentRoot);
  console.log(`[Stage 2] ${pdfTitleMap.size} PDF/ZIP titles from data.json`);

  console.log("[Stage 2] Uploading static_resources files...");
  const uploadResult = await uploadStaticPdfs(contentRoot, slug, pdfTitleMap);
  console.log(`[Stage 2] Uploaded ${uploadResult.uploadedPdfCount} PDFs, extracted ${uploadResult.textContentByOriginalFilename.size} text files from ${uploadResult.zipContentsMap.size} ZIPs`);

  // Stage 3: Build sections + persist
  console.log("\n[Stage 3] Building sections...");
  const preparedSections = buildSections(items, uploadResult);

  if (!preparedSections.length) {
    throw new Error("Built zero sections — no content found.");
  }

  console.log(`[Stage 3] Built ${preparedSections.length} sections:`);
  for (let i = 0; i < preparedSections.length; i++) {
    const s = preparedSections[i];
    console.log(`  ${i + 1}. [${s.sectionType}] ${s.title} (${s.resources.length} resources)`);
  }

  console.log("\n[Stage 3] Persisting to database...");

  await supabase.from("resources").delete().eq("course_id", course.id);
  await supabase.from("course_sections").delete().eq("course_id", course.id);

  const usedSlugs = new Set<string>();
  const sectionRows = preparedSections.map((section, idx) => ({
    course_id: course.id,
    title: section.title,
    slug: makeUniqueSlug(section.slugBase || section.title, usedSlugs),
    section_type: section.sectionType,
    ordering: idx,
  }));

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
    content_text: string | null;
    video_url: string | null;
    youtube_id: string | null;
    archive_url: string | null;
    ordering: number;
  }[] = [];

  for (let i = 0; i < preparedSections.length; i++) {
    const section = preparedSections[i];
    const sectionId = sectionIdByOrdering.get(i) ?? null;

    section.resources.forEach((resource, resourceIndex) => {
      resourceRows.push({
        course_id: course.id,
        section_id: sectionId,
        title: resource.title,
        resource_type: resource.resourceType,
        pdf_path: resource.pdfPath,
        content_text: resource.contentText,
        video_url: resource.videoUrl,
        youtube_id: resource.youtubeId,
        archive_url: resource.archiveUrl,
        ordering: resourceIndex,
      });
    });
  }

  if (!resourceRows.length) {
    throw new Error("Built sections but no resources.");
  }

  const { error: resourceInsertError } = await supabase
    .from("resources")
    .insert(resourceRows);

  if (resourceInsertError) {
    throw new Error(`Error inserting resources: ${resourceInsertError.message}`);
  }

  console.log(`[Stage 3] Inserted ${sectionRows.length} sections and ${resourceRows.length} resources`);

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
  console.log(`  Sections: ${sectionRows.length}`);
  console.log(`  Resources: ${resourceRows.length}`);
  console.log(`  PDFs uploaded: ${uploadResult.uploadedPdfCount}`);
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
