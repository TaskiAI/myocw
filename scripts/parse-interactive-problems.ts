import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const GEMINI_MODEL = "gemini-2.5-flash";
const DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Types ---

interface Resource {
  id: number;
  section_id: number | null;
  title: string;
  resource_type: string;
  content_text: string | null;
  pdf_path: string | null;
  ordering: number;
}

interface ParsedProblem {
  label: string;
  question_text: string;
  solution_text: string | null;
  explanation_text: string | null;
}

// --- PDF → base64 ---

async function fetchPdfBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

// --- Tag count for logging ---

function countTags(text: string): string {
  const fib = (text.match(/<FillInBlank/g) || []).length;
  const mc = (text.match(/<MultipleChoice/g) || []).length;
  const fr = (text.match(/<FreeResponse/g) || []).length;
  return `${fib} FIB, ${mc} MC, ${fr} FR`;
}

// --- JSON repair for LaTeX ---

function parseJsonWithLatex(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Gemini outputs LaTeX with single backslashes (\frac, \bmatrix, \left)
    // which are invalid JSON escapes. Fix all backslashes that aren't valid
    // JSON escape sequences: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
    // Process character by character to handle nested/broken escapes
    let fixed = "";
    let inString = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"' && (i === 0 || raw[i - 1] !== "\\")) {
        inString = !inString;
        fixed += ch;
      } else if (inString && ch === "\\") {
        const next = raw[i + 1];
        if (next && '"\\/bfnrt'.includes(next)) {
          // Valid JSON escape — keep as-is
          fixed += ch + next;
          i++;
        } else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
          // Valid \uXXXX
          fixed += ch + raw.slice(i + 1, i + 6);
          i += 5;
        } else {
          // Invalid escape (LaTeX) — double it
          fixed += "\\\\";
        }
      } else {
        fixed += ch;
      }
    }
    return JSON.parse(fixed);
  }
}

// --- Gemini prompt ---

const PROMPT = `You are an expert at creating interactive university problem sets.

You will receive a problem set PDF containing math/science problems.
You may also receive a SOLUTION DOCUMENT with worked answers.

Your task: extract each individual problem and return a JSON array. Each element has:
- "label": the problem number/label exactly as shown (e.g. "2.1", "2a", "3")
- "question_text": the full problem statement in Markdown with interactive answer tags embedded at the end
- "solution_text": concise final answer only — numbers, values, key results (null if no solution provided)
- "explanation_text": full worked-out solution steps (null if unavailable)

INTERACTIVE TAG FORMAT — embed at the natural answer point in question_text:

1. <FillInBlank answer="VALUE" />
   For specific numeric values, short text, single variables.
   Example: $x$ = <FillInBlank answer="42" />

2. <MultipleChoice options={["A","B","C"]} answer="B" />
   For true/false, yes/no, classification with discrete choices.
   Example: The matrix is <MultipleChoice options={["Invertible","Singular"]} answer="Singular" />

3. <FreeResponse prompt="Brief instruction." answer="model answer in LaTeX" />
   For open computation, matrices, proofs, explanations — anything that isn't a single value or choice.
   Example: <FreeResponse prompt="Compute the product AB." answer="$\\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}$" />

TAG SELECTION:
- "find x", "compute" a single number/value → FillInBlank
- Explicit choices, true/false → MultipleChoice
- "show", "prove", "compute" a matrix/vector, "explain", multi-step → FreeResponse
- Multiple sub-answers (find x1, x2, x3) → separate FillInBlank for each
- When unsure → FreeResponse (always works)
- Place tags AFTER the problem statement, not inline within the question text

ANSWER ATTRIBUTE CONSTRAINT:
- The answer="..." value must NOT contain literal double-quote characters
- For LaTeX in answer attributes, use single $ delimiters, not $$

LaTeX FORMATTING (CRITICAL):
- Inline: $...$ for single variables, short expressions within a sentence
- Block: $$...$$ on its OWN LINE with blank lines before and after, for any nontrivial formula
- Matrices: use \\begin{bmatrix}...\\end{bmatrix} (NOT \\begin{array} with \\left[ \\right], and NOT \\bmatrix{...})
- NEVER put $$...$$ inline within a sentence
- Write LaTeX with SINGLE backslashes naturally (e.g. \\frac, \\bmatrix). Do NOT double-escape for JSON — we handle that.

STRUCTURAL RULES:
- Each problem gets ONE entry — keep multi-part problems (a, b, c) together
- Include the FULL problem statement before the interactive tags
- Preserve figures as [FIGURE N] placeholders
- Use the solution document to determine correct answer= values when available
- Output ONLY valid JSON array, no code fences, no commentary`;

// --- Gemini call ---

async function parseProblems(
  psetPdfBase64: string,
  solutionContent: string | null,
  solutionPdfBase64: string | null
): Promise<ParsedProblem[]> {
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

  parts.push({ text: PROMPT });
  parts.push({ inlineData: { data: psetPdfBase64, mimeType: "application/pdf" } });

  if (solutionContent) {
    parts.push({ text: `\n\n--- SOLUTION DOCUMENT ---\n\n${solutionContent}` });
  } else if (solutionPdfBase64) {
    parts.push({ text: "\n\n--- SOLUTION DOCUMENT (PDF) ---" });
    parts.push({ inlineData: { data: solutionPdfBase64, mimeType: "application/pdf" } });
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ parts }],
  });

  const text = response.text?.trim();
  if (!text) throw new Error("No content from Gemini.");

  const cleaned = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  const parsed = parseJsonWithLatex(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Gemini response is not an array.");
  return parsed as ParsedProblem[];
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const courseArg = args.find((a) => !a.startsWith("--"));
  const sessionArg = args.find((a) => a.startsWith("--session="));
  const sessionNum = sessionArg ? parseInt(sessionArg.split("=")[1], 10) : null;
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  if (!courseArg) {
    console.error("Usage: parse-interactive-problems <course-id-or-slug> --session=N [--dry-run] [--force]");
    process.exit(1);
  }

  if (dryRun) console.log("[DRY RUN] No database writes will be made.\n");

  // 1. Look up course
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

  console.log(`\n${course.title} (id=${course.id})\n`);

  // 2. Session filtering
  let sectionId: number | null = null;
  if (sessionNum !== null) {
    const { data: sections } = await supabase
      .from("course_sections")
      .select("id, title, ordering")
      .eq("course_id", course.id)
      .eq("section_type", "lecture")
      .order("ordering");

    if (!sections?.length) {
      console.error("No lecture sections found.");
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

  // 3. Fetch resources
  let resourceQuery = supabase
    .from("resources")
    .select("id, section_id, title, resource_type, content_text, pdf_path, ordering")
    .eq("course_id", course.id)
    .order("section_id")
    .order("ordering");

  if (sectionId !== null) {
    resourceQuery = resourceQuery.eq("section_id", sectionId);
  }

  const { data: resources, error: resError } = await resourceQuery;
  if (resError || !resources?.length) {
    console.log("No resources found.");
    return;
  }

  // 4. Build problem_set → solution pairs (adjacency within section)
  const pairs: Array<{ pset: Resource; solution: Resource | null }> = [];
  for (let i = 0; i < resources.length; i++) {
    const r = resources[i] as Resource;
    if (r.resource_type !== "problem_set") continue;
    const next = resources[i + 1] as Resource | undefined;
    const solution =
      next?.resource_type === "solution" && next.section_id === r.section_id
        ? next
        : null;
    pairs.push({ pset: r, solution });
  }

  if (!pairs.length) {
    console.log("No problem_set resources found.");
    return;
  }

  console.log(`Found ${pairs.length} problem_set(s) to process.\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const { pset, solution } of pairs) {
    console.log(`--- ${pset.title} ---`);

    // Skip check
    const { data: existing } = await supabase
      .from("problems")
      .select("id")
      .eq("resource_id", pset.id);

    if (existing?.length && !force) {
      console.log(`  SKIP: ${existing.length} problems already exist (use --force to overwrite).`);
      totalSkipped++;
      continue;
    }

    if (!pset.pdf_path) {
      console.log(`  SKIP: No PDF path.`);
      totalSkipped++;
      continue;
    }

    // Fetch problem PDF
    let psetBase64: string;
    try {
      psetBase64 = await fetchPdfBase64(pset.pdf_path);
    } catch (err: any) {
      console.error(`  ERROR fetching PDF: ${err.message}`);
      totalFailed++;
      continue;
    }

    // Get solution content (prefer markdown, fallback to PDF)
    let solutionContent: string | null = null;
    let solutionPdfBase64: string | null = null;
    if (solution) {
      if (solution.content_text) {
        solutionContent = solution.content_text;
        console.log(`  Solution: using markdown (${solutionContent.length} chars)`);
      } else if (solution.pdf_path) {
        try {
          solutionPdfBase64 = await fetchPdfBase64(solution.pdf_path);
          console.log(`  Solution: using PDF`);
        } catch (err: any) {
          console.log(`  Solution PDF fetch failed: ${err.message} — proceeding without`);
        }
      }
    } else {
      console.log(`  No paired solution resource — Gemini will infer answers.`);
    }

    // Call Gemini (with 1 retry for transient errors)
    let parsed: ParsedProblem[];
    try {
      parsed = await parseProblems(psetBase64, solutionContent, solutionPdfBase64);
    } catch (err: any) {
      console.log(`  Retry after error: ${err.message}`);
      await sleep(DELAY_MS * 2);
      try {
        parsed = await parseProblems(psetBase64, solutionContent, solutionPdfBase64);
      } catch (err2: any) {
        console.error(`  ERROR from Gemini: ${err2.message}`);
        totalFailed++;
        await sleep(DELAY_MS);
        continue;
      }
    }

    console.log(`  Gemini returned ${parsed.length} problem(s).`);

    // Delete existing if --force
    if (force && existing?.length) {
      if (!dryRun) {
        await supabase.from("problems").delete().eq("resource_id", pset.id);
        console.log(`  Deleted ${existing.length} existing problem(s).`);
      }
    }

    // Insert
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];

      if (dryRun) {
        console.log(`  [DRY] ${p.label}: ${p.question_text.length} chars, ${countTags(p.question_text)}`);
        totalInserted++;
        continue;
      }

      const { error } = await supabase.from("problems").insert({
        resource_id: pset.id,
        course_id: course.id,
        problem_label: p.label,
        question_text: p.question_text,
        solution_text: p.solution_text,
        explanation_text: p.explanation_text,
        ordering: i,
      });

      if (error) {
        console.error(`  DB ERROR for "${p.label}": ${error.message}`);
        totalFailed++;
      } else {
        console.log(`  INSERT: "${p.label}" — ${countTags(p.question_text)}`);
        totalInserted++;
      }
    }

    await sleep(DELAY_MS);
  }

  console.log(
    `\nDone. Inserted: ${totalInserted}, Skipped: ${totalSkipped}, Failed: ${totalFailed}`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
