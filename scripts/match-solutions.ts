import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const GEMINI_MODEL = "gemini-3-flash-preview";
const DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Types ---

interface Resource {
  id: number;
  section_id: number | null;
  title: string;
  resource_type: string;
  content_text: string | null;
  ordering: number;
}

interface Problem {
  id: number;
  resource_id: number;
  problem_label: string;
  solution_text: string | null;
  explanation_text: string | null;
}

interface SplitSolution {
  label: string;
  solution_text: string | null;
  explanation_text: string | null;
}

// --- JSON repair for LaTeX ---

function parseJsonWithLatex(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
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
          fixed += ch + next;
          i++;
        } else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
          fixed += ch + raw.slice(i + 1, i + 6);
          i += 5;
        } else {
          fixed += "\\\\";
        }
      } else {
        fixed += ch;
      }
    }
    return JSON.parse(fixed);
  }
}

// --- Label normalization ---

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/^(problem|exercise|question|q|p)\.?\s*/i, "")
    .replace(/[.:)\s]+$/, "")
    .trim();
}

// --- Gemini splitting ---

const SPLIT_PROMPT = `You are splitting a solution document into individual problem solutions.

The document contains solutions for these problems (in order):
{LABELS}

Split the markdown below into individual solutions. Return a JSON array where each element has:
- "label": the problem label exactly as listed above
- "solution_text": the concise answer — final numbers, values, key results only. Keep it short.
- "explanation_text": the full worked-out steps and reasoning (null if the document only states the answer without showing work)

Rules:
- Include ALL text between one problem boundary and the next
- Preserve all markdown formatting and figure references exactly
- If a problem's solution is not found in the document, set both fields to null
- Do NOT generate or modify content — only segment and classify what exists
- Output ONLY valid JSON, no code fences

LaTeX formatting (CRITICAL — follow exactly):
- Use $...$ for INLINE math only: single variables, short expressions that flow within a sentence (e.g. $x = 3$, $A^{-1}$)
- Use $$...$$ on its OWN LINE for any nontrivial formula, equation, multi-term expression, or matrix. Always put a blank line before and after $$...$$ blocks.
- NEVER put $$...$$ inline within a sentence. If it's a standalone equation, it goes on its own line.
- For matrices, use \\begin{bmatrix}...\\end{bmatrix} (NOT \\begin{array} with \\left[ \\right], and NOT \\bmatrix{...}).

Document:
{CONTENT}`;

async function splitSolutions(
  contentText: string,
  problemLabels: string[]
): Promise<SplitSolution[]> {
  const prompt = SPLIT_PROMPT
    .replace("{LABELS}", JSON.stringify(problemLabels))
    .replace("{CONTENT}", contentText);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
  });

  const text = response.text?.trim();
  if (!text) throw new Error("No content from Gemini.");

  // Strip code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  const parsed = parseJsonWithLatex(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Gemini response is not an array.");
  return parsed as SplitSolution[];
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  if (!slug) {
    console.error("Usage: match-solutions <course-slug-or-id> [--dry-run] [--force]");
    process.exit(1);
  }

  if (dryRun) console.log("[DRY RUN] No database writes will be made.\n");

  // 1. Look up course by ID or slug
  const isNumericId = /^\d+$/.test(slug);
  const query = supabase.from("courses").select("id, title");
  const { data: course, error: courseError } = await (
    isNumericId
      ? query.eq("id", Number(slug))
      : query.eq("url", `https://ocw.mit.edu/courses/${slug}/`)
  ).single();

  if (courseError || !course) {
    console.error(`Course not found for slug: ${slug}`);
    process.exit(1);
  }

  console.log(`${course.title} (id=${course.id})\n`);

  // 2. Fetch all resources ordered by section + ordering
  const { data: resources, error: resError } = await supabase
    .from("resources")
    .select("id, section_id, title, resource_type, content_text, ordering")
    .eq("course_id", course.id)
    .order("section_id")
    .order("ordering");

  if (resError || !resources?.length) {
    console.log("No resources found.");
    return;
  }

  // 3. Fetch all problems grouped by resource_id
  const { data: problems, error: probError } = await supabase
    .from("problems")
    .select("id, resource_id, problem_label, solution_text, explanation_text")
    .eq("course_id", course.id)
    .order("ordering");

  if (probError || !problems?.length) {
    console.log("No problems found.");
    return;
  }

  const problemsByResource = new Map<number, Problem[]>();
  for (const p of problems) {
    const list = problemsByResource.get(p.resource_id) ?? [];
    list.push(p);
    problemsByResource.set(p.resource_id, list);
  }

  // 4. Build problem_set → solution map (adjacency within section)
  const solutionByProblemSet = new Map<number, Resource>();
  for (let i = 0; i < resources.length; i++) {
    const r = resources[i];
    if (r.resource_type !== "problem_set") continue;
    const next = resources[i + 1];
    if (
      next?.resource_type === "solution" &&
      next.section_id === r.section_id
    ) {
      solutionByProblemSet.set(r.id, next);
    }
  }

  console.log(
    `Found ${solutionByProblemSet.size} problem_set → solution pairs.\n`
  );

  // 5. Process each pair
  let totalMatched = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const [psetId, solResource] of solutionByProblemSet) {
    const psetProblems = problemsByResource.get(psetId);
    if (!psetProblems?.length) continue;

    const psetResource = resources.find((r) => r.id === psetId)!;
    console.log(`--- ${psetResource.title} (${psetProblems.length} problems) ---`);

    // Skip if no content_text
    if (!solResource.content_text) {
      console.log(
        `  SKIP: Solution "${solResource.title}" has no content_text. Run parse-markdown first.`
      );
      totalSkipped += psetProblems.length;
      continue;
    }

    // Skip if all problems already have solutions (unless --force)
    const needsUpdate = psetProblems.filter(
      (p) => !p.solution_text || force
    );
    if (needsUpdate.length === 0) {
      console.log(`  SKIP: All problems already have solutions.`);
      totalSkipped += psetProblems.length;
      continue;
    }

    // Split via Gemini
    const labels = psetProblems.map((p) => p.problem_label);
    console.log(`  Splitting "${solResource.title}" for labels: [${labels.join(", ")}]`);

    let splits: SplitSolution[];
    try {
      splits = await splitSolutions(solResource.content_text, labels);
    } catch (err: any) {
      console.error(`  ERROR splitting: ${err.message}`);
      totalFailed += psetProblems.length;
      await sleep(DELAY_MS);
      continue;
    }

    // Match by normalized label
    const splitByNorm = new Map<string, SplitSolution>();
    for (const s of splits) {
      splitByNorm.set(normalizeLabel(s.label), s);
    }

    for (const problem of psetProblems) {
      const norm = normalizeLabel(problem.problem_label);
      const split = splitByNorm.get(norm);

      if (!split || (!split.solution_text && !split.explanation_text)) {
        console.log(`  MISS: "${problem.problem_label}" — no match in Gemini output`);
        totalFailed++;
        continue;
      }

      if (problem.solution_text && !force) {
        console.log(`  SKIP: "${problem.problem_label}" — already has solution`);
        totalSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(
          `  MATCH: "${problem.problem_label}" — solution: ${split.solution_text?.length ?? 0} chars, explanation: ${split.explanation_text?.length ?? 0} chars`
        );
        totalMatched++;
        continue;
      }

      const { error } = await supabase
        .from("problems")
        .update({
          solution_text: split.solution_text,
          explanation_text: split.explanation_text,
        })
        .eq("id", problem.id);

      if (error) {
        console.error(`  DB ERROR for "${problem.problem_label}": ${error.message}`);
        totalFailed++;
      } else {
        console.log(
          `  MATCH: "${problem.problem_label}" — updated (sol: ${split.solution_text?.length ?? 0}, expl: ${split.explanation_text?.length ?? 0} chars)`
        );
        totalMatched++;
      }
    }

    await sleep(DELAY_MS);
  }

  console.log(
    `\nDone. Matched: ${totalMatched}, Skipped: ${totalSkipped}, Failed: ${totalFailed}`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
