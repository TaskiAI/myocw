import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const GEMINI_MODEL = "gemini-3-flash-preview";

// --- Types ---

interface CodingProblemStep {
  label: string;
  title: string;
  instructions: string;
  test_snippet: string;
}

// --- PDF → base64 ---

async function fetchPdfBase64(source: string): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status} ${source}`);
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString("base64");
  }
  // Local file
  return fs.readFileSync(source).toString("base64");
}

// --- Gemini prompt ---

const PROMPT = `You are an expert at breaking down coding problem sets into individual stepped exercises.

You will receive:
1. A PDF containing problem set instructions
2. A Python template file with helper code and function stubs to implement

Your task: split this into individual coding steps — one per function the student needs to implement.

Return a JSON array where each element has:
- "label": step number as string (e.g. "1", "2", "3")
- "title": the function name (e.g. "is_word_guessed")
- "instructions": the relevant instructions from the PDF for this specific function, in clean Markdown. Include the function's purpose, expected behavior, examples, and any rules/constraints mentioned.
- "test_snippet": a simple test the student can run to verify their implementation. Use print() statements with expected output in comments. The test will be appended to the FULL template script at runtime, so all imports, helper functions, and previous function implementations are available. Do NOT redefine imports or helpers in test_snippet.

RULES:
- Preserve the original ordering from the template file
- The student edits the full template file directly — each step just tells them which function to implement and provides tests for it
- For game/interactive functions (like a main game loop), the test_snippet should be a simpler non-interactive test (e.g. just verify it's callable)
- Instructions should be complete enough that a student can implement the function without the original PDF
- Output ONLY valid JSON array, no code fences, no commentary`;

// --- Gemini call ---

async function parseCodingPset(
  pdfBase64: string,
  templateCode: string
): Promise<CodingProblemStep[]> {
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

  parts.push({ text: PROMPT });
  parts.push({ inlineData: { data: pdfBase64, mimeType: "application/pdf" } });
  parts.push({ text: `\n\n--- PYTHON TEMPLATE ---\n\n${templateCode}` });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ parts }],
  });

  const text = response.text?.trim();
  if (!text) throw new Error("No content from Gemini.");

  const cleaned = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Gemini response is not an array.");
  return parsed as CodingProblemStep[];
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  // Support two modes:
  // 1. Direct file: --pdf=path --template=path [--dry-run]
  // 2. DB mode: <course-id> --resource=<id> [--dry-run] [--force]

  const pdfArg = args.find((a) => a.startsWith("--pdf="));
  const templateArg = args.find((a) => a.startsWith("--template="));
  const resourceArg = args.find((a) => a.startsWith("--resource="));
  const courseArg = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  if (pdfArg && templateArg) {
    // --- Direct file mode ---
    const pdfPath = pdfArg.split("=")[1];
    const templatePath = templateArg.split("=")[1];

    console.log(`PDF: ${pdfPath}`);
    console.log(`Template: ${templatePath}\n`);

    const pdfBase64 = await fetchPdfBase64(pdfPath);
    const templateCode = fs.readFileSync(templatePath, "utf-8");

    const steps = await parseCodingPset(pdfBase64, templateCode);

    console.log(`Gemini returned ${steps.length} step(s):\n`);
    for (const step of steps) {
      console.log(`--- Step ${step.label}: ${step.title} ---`);
      console.log(`Instructions: ${step.instructions.slice(0, 120)}...`);
      console.log(`Test: ${step.test_snippet.split("\n")[0]}`);
      console.log();
    }

    if (dryRun) {
      console.log("[DRY RUN] Full output:\n");
      console.log(JSON.stringify(steps, null, 2));
      return;
    }

    // If course-id provided, also write to DB
    if (courseArg && resourceArg) {
      await writeToDB(steps, courseArg, resourceArg, force);
    } else {
      console.log("No --resource and course-id provided, skipping DB write.");
      console.log("Full JSON output:\n");
      console.log(JSON.stringify(steps, null, 2));
    }
  } else if (courseArg && resourceArg) {
    // --- DB mode ---
    const resourceId = parseInt(resourceArg.split("=")[1], 10);

    // Look up course
    const isNumericId = /^\d+$/.test(courseArg);
    const courseQuery = supabase.from("courses").select("id, title");
    const { data: course, error: courseError } = await (
      isNumericId
        ? courseQuery.eq("id", Number(courseArg))
        : courseQuery.eq("url", `https://ocw.mit.edu/courses/${courseArg}/`)
    ).single();

    if (courseError || !course) {
      console.error(`Course not found: ${courseArg}`);
      process.exit(1);
    }

    console.log(`${course.title} (id=${course.id})\n`);

    // Get resource
    const { data: resource } = await supabase
      .from("resources")
      .select("id, title, pdf_path, content_text")
      .eq("id", resourceId)
      .single();

    if (!resource) {
      console.error(`Resource ${resourceId} not found.`);
      process.exit(1);
    }

    if (!resource.pdf_path) {
      console.error(`Resource ${resourceId} has no PDF path.`);
      process.exit(1);
    }

    console.log(`Resource: ${resource.title}`);

    // We need the template .py file — look for it as a sibling resource or in content_text
    // For now, require --template flag even in DB mode
    if (!templateArg) {
      console.error("DB mode still requires --template=<path-to-py-file>");
      process.exit(1);
    }

    const templatePath = templateArg.split("=")[1];
    const pdfBase64 = await fetchPdfBase64(resource.pdf_path);
    const templateCode = fs.readFileSync(templatePath, "utf-8");

    const steps = await parseCodingPset(pdfBase64, templateCode);
    console.log(`Gemini returned ${steps.length} step(s).\n`);

    if (dryRun) {
      for (const step of steps) {
        console.log(`[DRY] Step ${step.label}: ${step.title}`);
      }
      return;
    }

    await writeToDB(steps, courseArg, resourceArg, force);
  } else {
    console.error(
      "Usage:\n" +
        "  parse-coding-pset --pdf=<path> --template=<path> [--dry-run]\n" +
        "  parse-coding-pset <course-id> --resource=<id> --template=<path> [--dry-run] [--force]"
    );
    process.exit(1);
  }
}

async function writeToDB(
  steps: CodingProblemStep[],
  courseArg: string,
  resourceArg: string,
  force: boolean
) {
  const resourceId = parseInt(resourceArg.split("=")[1], 10);

  // Look up course
  const isNumericId = /^\d+$/.test(courseArg);
  const courseQuery = supabase.from("courses").select("id");
  const { data: course } = await (
    isNumericId
      ? courseQuery.eq("id", Number(courseArg))
      : courseQuery.eq("url", `https://ocw.mit.edu/courses/${courseArg}/`)
  ).single();

  if (!course) {
    console.error(`Course not found: ${courseArg}`);
    return;
  }

  // Check existing
  const { data: existing } = await supabase
    .from("problems")
    .select("id")
    .eq("resource_id", resourceId);

  if (existing?.length && !force) {
    console.log(`SKIP: ${existing.length} problems already exist (use --force to overwrite).`);
    return;
  }

  if (force && existing?.length) {
    await supabase.from("problems").delete().eq("resource_id", resourceId);
    console.log(`Deleted ${existing.length} existing problem(s).`);
  }

  // Insert steps as problems
  let inserted = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    const solutionJson = JSON.stringify({
      test_snippet: step.test_snippet,
    });

    const { error } = await supabase.from("problems").insert({
      resource_id: resourceId,
      course_id: course.id,
      problem_label: `${step.label}: ${step.title}`,
      question_text: step.instructions,
      solution_text: solutionJson,
      ordering: i,
    });

    if (error) {
      console.error(`DB ERROR for step ${step.label}: ${error.message}`);
    } else {
      console.log(`INSERT: Step ${step.label} — ${step.title}`);
      inserted++;
    }
  }

  console.log(`\nDone. Inserted ${inserted} of ${steps.length} steps.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
