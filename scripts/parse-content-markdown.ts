import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { execFileSync } from "child_process";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const GEMINI_MODEL = "gemini-2.5-flash";
const STORAGE_BUCKET = "mit-ocw";

const PROMPT =
  "You are an expert LaTeX and Markdown converter. This is a university-level teaching resource — " +
  "preserve the pedagogical structure and clarity of the original material.\n\n" +
  "Convert the provided PDF into clean, well-spaced Markdown:\n" +
  "- Use generous newlines between sections, paragraphs, and logical blocks for readability. " +
  "In math-heavy areas, add blank lines before and after each $$...$$ block so equations breathe.\n" +
  "- Use $...$ for simple inline math only (single variables, short expressions). " +
  "Any nontrivial formula, equation, or multi-term expression should be on its own line using $$...$$ block math.\n" +
  "- For matrices, use \\begin{bmatrix}...\\end{bmatrix} (NOT \\begin{array} with \\left[ \\right], and NOT \\bmatrix{...}).\n" +
  "- Preserve all text, structure, and numbering faithfully.\n" +
  "- When you encounter a figure, diagram, graph, or image, output a placeholder [FIGURE N] on its own line. " +
  "Only tag actual embedded images, figures, and graphs — not tables or text-based diagrams.\n" +
  "- Output ONLY the markdown content.";

const DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PYTHON_PATH = path.resolve(SCRIPT_DIR, "../doc_ingestion_python/.venv/bin/python");
const EXTRACT_SCRIPT = path.resolve(SCRIPT_DIR, "../doc_ingestion_python/extract_figures.py");

// --- Types ---

interface ExtractedFigure {
  index: number;
  ext: string;
  base64: string;
  width: number;
  height: number;
}

// --- PDF → base64 ---

async function fetchPdfBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

// --- Gemini conversion ---

async function convertPdfToMarkdown(base64Data: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inlineData: { data: base64Data, mimeType: "application/pdf" } },
        ],
      },
    ],
  });
  const text = response.text;
  if (!text) throw new Error("No content generated from Gemini.");
  return text;
}

// --- Figure extraction (shells out to Python/pymupdf) ---

function extractFigures(pdfUrl: string): ExtractedFigure[] {
  try {
    const result = execFileSync(PYTHON_PATH, [EXTRACT_SCRIPT, pdfUrl], {
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(result.toString());
  } catch (err: any) {
    console.error(`    Figure extraction failed: ${err.message}`);
    return [];
  }
}

// --- Upload figures to Supabase storage ---

async function uploadFigures(
  figures: ExtractedFigure[],
  slug: string,
  resourceId: number
): Promise<string[]> {
  const urls: string[] = [];
  for (const fig of figures) {
    const objectPath = `courses/${slug}/figures/${resourceId}_fig${fig.index + 1}.${fig.ext}`;
    const buffer = Buffer.from(fig.base64, "base64");
    const contentType = `image/${fig.ext === "jpg" ? "jpeg" : fig.ext}`;

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, buffer, { contentType, upsert: true });

    if (error) {
      console.error(`    Upload error for fig${fig.index + 1}: ${error.message}`);
      continue;
    }

    const url = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
    urls.push(url);
  }
  return urls;
}

// --- Replace [FIGURE N] tags with image markdown ---

function replaceFigureTags(markdown: string, figureUrls: string[]): string {
  return markdown.replace(/\[FIGURE (\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10) - 1;
    if (idx >= 0 && idx < figureUrls.length) {
      return `![Figure ${num}](${figureUrls[idx]})`;
    }
    return match;
  });
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const courseArg = args.find((a) => !a.startsWith("--"));
  const sessionArg = args.find((a) => a.startsWith("--session=") || a === "--session");
  const sessionNum = sessionArg
    ? parseInt(sessionArg.includes("=") ? sessionArg.split("=")[1] : args[args.indexOf(sessionArg) + 1], 10)
    : null;

  if (!courseArg) {
    console.error("Usage: parse-content-markdown <course-slug-or-id> [--session=N]");
    process.exit(1);
  }

  const isNumericId = /^\d+$/.test(courseArg);
  const courseQuery = supabase.from("courses").select("id, title, url");
  const { data: course, error: courseError } = await (
    isNumericId
      ? courseQuery.eq("id", Number(courseArg))
      : courseQuery.eq("url", `https://ocw.mit.edu/courses/${courseArg}/`)
  ).single();

  if (courseError || !course) {
    console.error(`Course not found: ${courseArg}`);
    process.exit(1);
  }

  // Derive slug from URL for figure storage paths
  const slug = course.url?.replace(/.*\/courses\//, "").replace(/\/$/, "") ?? courseArg;

  console.log(`\n${course.title} (id=${course.id})\n`);

  // If --session=N, find the section_id matching that session number
  let sectionId: number | null = null;
  if (sessionNum !== null) {
    const { data: sections } = await supabase
      .from("course_sections")
      .select("id, title, ordering")
      .eq("course_id", course.id)
      .eq("section_type", "lecture")
      .order("ordering");

    if (!sections?.length) {
      console.error("No lecture sections found for this course.");
      process.exit(1);
    }

    const section = sections[sessionNum - 1];
    if (!section) {
      console.error(`Session ${sessionNum} not found (only ${sections.length} sessions).`);
      process.exit(1);
    }
    sectionId = section.id;
    console.log(`Session ${sessionNum}: ${section.title} (section_id=${sectionId})\n`);
  }

  let resourceQuery = supabase
    .from("resources")
    .select("id, title, resource_type, pdf_path")
    .eq("course_id", course.id)
    .not("pdf_path", "is", null)
    .in("resource_type", ["solution", "lecture_notes"])
    .order("id");

  if (sectionId !== null) {
    resourceQuery = resourceQuery.eq("section_id", sectionId);
  }

  const { data: resources, error: resError } = await resourceQuery;

  if (resError || !resources?.length) {
    console.log("No matching resources found.");
    return;
  }

  console.log(`${resources.length} resources to convert.\n`);

  let converted = 0;
  let failed = 0;

  for (const r of resources) {
    console.log(`  [convert] ${r.title} (${r.resource_type})`);
    try {
      // 1. Convert PDF to markdown with figure tags
      const base64 = await fetchPdfBase64(r.pdf_path);
      let markdown = await convertPdfToMarkdown(base64);

      // 2. Extract figures from PDF
      const figures = extractFigures(r.pdf_path);
      if (figures.length > 0) {
        console.log(`    Extracted ${figures.length} figure(s).`);
        // 3. Upload figures to Supabase storage
        const urls = await uploadFigures(figures, slug, r.id);
        // 4. Replace [FIGURE N] tags with image URLs
        markdown = replaceFigureTags(markdown, urls);
        console.log(`    Replaced ${urls.length} figure tag(s).`);
      }

      // 5. Save final markdown
      const { error } = await supabase
        .from("resources")
        .update({ content_text: markdown })
        .eq("id", r.id);

      if (error) {
        console.error(`    Save error: ${error.message}`);
        failed++;
      } else {
        console.log(`    ${markdown.length} chars saved.`);
        converted++;
      }
    } catch (err: any) {
      console.error(`    Error: ${err.message}`);
      failed++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. Converted: ${converted}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
