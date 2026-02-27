import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const LLAMA_CLOUD_API_KEY = process.env.LLAMA_CLOUD_API_KEY!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// ── LlamaParse rate limiter (20 req/min free tier) ──

const uploadTimestamps: number[] = [];
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

async function rateLimitWait() {
  const now = Date.now();
  // Remove timestamps older than the window
  while (uploadTimestamps.length > 0 && uploadTimestamps[0] < now - RATE_WINDOW_MS) {
    uploadTimestamps.shift();
  }
  if (uploadTimestamps.length >= RATE_LIMIT) {
    const waitMs = uploadTimestamps[0] + RATE_WINDOW_MS - now + 100;
    console.log(`  Rate limit: waiting ${(waitMs / 1000).toFixed(1)}s...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  uploadTimestamps.push(Date.now());
}

// ── LlamaParse v2: upload PDF → poll → get markdown ──

async function pdfToMarkdown(pdfBuffer: Buffer, filename: string): Promise<string> {
  await rateLimitWait();

  // Upload
  const formData = new FormData();
  formData.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), filename);
  formData.append("configuration", JSON.stringify({ tier: "cost_effective", version: "latest" }));

  const uploadRes = await fetch("https://api.cloud.llamaindex.ai/api/v2/parse/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`LlamaParse upload failed (${uploadRes.status}): ${text}`);
  }

  const { id: jobId } = await uploadRes.json();
  console.log(`  LlamaParse job ${jobId} for ${filename}`);

  // Poll for result
  const POLL_INTERVAL_MS = 5_000;
  const TIMEOUT_MS = 5 * 60_000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const statusRes = await fetch(
      `https://api.cloud.llamaindex.ai/api/v2/parse/${jobId}?expand=markdown`,
      { headers: { Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}` } },
    );

    // 400 = "Job not completed yet" — keep polling
    if (statusRes.status === 400) {
      const errBody = await statusRes.json().catch(() => ({}));
      if (errBody.detail === "Job not completed yet") {
        continue;
      }
      throw new Error(`LlamaParse error: ${JSON.stringify(errBody)}`);
    }

    if (!statusRes.ok) {
      const text = await statusRes.text();
      throw new Error(`LlamaParse status check failed (${statusRes.status}): ${text}`);
    }

    const data = await statusRes.json();

    // Check job status
    const jobStatus = data.job?.status;
    if (jobStatus === "ERROR" || jobStatus === "FAILED") {
      throw new Error(`LlamaParse job failed: ${JSON.stringify(data.job)}`);
    }

    if (jobStatus === "COMPLETED") {
      // Markdown is nested: data.markdown.pages[].markdown
      if (data.markdown?.pages?.length) {
        return data.markdown.pages
          .map((p: { markdown: string }) => p.markdown)
          .join("\n\n");
      }
      // Fallback: check top-level
      if (typeof data.markdown === "string") return data.markdown;
      return "";
    }

    // Still processing — continue polling
  }

  throw new Error(`LlamaParse job ${jobId} timed out after 5 minutes`);
}

// ── LLM extraction: markdown → structured problems ──

interface ExtractedProblem {
  problem_label: string;
  question_text: string;
  solution_text: string | null;
  ordering: number;
}

async function extractProblems(
  questionsMarkdown: string,
  solutionsMarkdown: string | null,
): Promise<ExtractedProblem[]> {
  const solutionBlock = solutionsMarkdown
    ? `\n\n## Solutions document\n\n${solutionsMarkdown}`
    : "\n\n(No separate solutions document available.)";

  const prompt = `You are parsing an MIT OpenCourseWare problem set into structured data.

## Questions document

${questionsMarkdown}
${solutionBlock}

## Task

Extract each distinct problem from the questions document. Return a JSON array where each element has:
- "problem_label": short label like "Problem 1", "1(a)", "Question 3", etc.
- "question_text": the full problem text in markdown. Keep sub-parts (a, b, c, ...) together as ONE problem entry with the parent. Preserve all math notation exactly as-is from the markdown.
- "solution_text": the matching solution from the solutions document (if available), or null. Match by problem number/label.
- "ordering": integer starting from 0, in document order.

Rules:
- Keep sub-parts together: if Problem 1 has parts (a), (b), (c), that is ONE entry with label "Problem 1".
- Preserve math notation as-is (LaTeX, Unicode, etc.).
- Do NOT include headers, instructions, or preamble as problems.
- If no distinct problems can be identified, return [].
- Output ONLY the JSON array. No markdown fences, no commentary.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${text}`);
  }

  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "";

  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned) as ExtractedProblem[];
  } catch (e) {
    console.error("  Failed to parse LLM response:", e);
    console.log("  Raw response (first 500 chars):", raw.slice(0, 500));
    return [];
  }
}

// ── Download PDF from URL ──

const STORAGE_BUCKET = "mit-ocw";
const SUPABASE_PUBLIC_URL = SUPABASE_URL.replace(/\/$/, "");

function resolveStorageUrl(pdfPath: string): string {
  // Already a full URL
  if (pdfPath.startsWith("http")) return pdfPath;
  // Relative path like "/content/courses/slug/file.pdf" — build Supabase storage URL
  // Strip leading slash, replace "content/" prefix with bucket path
  const cleaned = pdfPath.replace(/^\//, "");
  // Paths are stored as "content/courses/<slug>/<file>" but storage uses "courses/<slug>/<file>"
  const objectPath = cleaned.startsWith("content/")
    ? cleaned.replace(/^content\//, "")
    : cleaned;
  return `${SUPABASE_PUBLIC_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}

async function downloadPdf(pdfPath: string): Promise<Buffer> {
  const url = resolveStorageUrl(pdfPath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Main ──

interface ResourceRow {
  id: number;
  course_id: number;
  section_id: number | null;
  title: string;
  resource_type: string;
  pdf_path: string | null;
  ordering: number;
}

async function parseProblems(slug: string) {
  console.log(`Looking up course: ${slug}`);

  const { data: courses, error: lookupError } = await supabase
    .from("courses")
    .select("*")
    .ilike("url", `%${slug}%`);

  if (lookupError || !courses?.length) {
    console.error("Course not found:", lookupError?.message ?? "no match");
    process.exit(1);
  }

  const course = courses[0];
  console.log(`Found: ${course.title} (id: ${course.id})`);

  // Fetch problem-related resources
  const { data: resources, error: resError } = await supabase
    .from("resources")
    .select("id, course_id, section_id, title, resource_type, pdf_path, ordering")
    .eq("course_id", course.id)
    .in("resource_type", ["problem_set", "solution", "exam"])
    .order("ordering", { ascending: true });

  if (resError) {
    console.error("Error fetching resources:", resError);
    process.exit(1);
  }

  const allResources = (resources ?? []) as ResourceRow[];
  console.log(`Found ${allResources.length} problem-related resources`);

  if (allResources.length === 0) {
    console.log("No problem sets, solutions, or exams found for this course.");
    process.exit(0);
  }

  // Group by section_id to pair questions with solutions
  const bySection = new Map<number | null, ResourceRow[]>();
  for (const r of allResources) {
    const key = r.section_id;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(r);
  }

  let totalProblems = 0;

  for (const [sectionId, sectionResources] of bySection) {
    // Find questions resource (problem_set or exam) and solution resource
    const questionsResource = sectionResources.find(
      (r) => r.resource_type === "problem_set" || r.resource_type === "exam",
    );
    const solutionResource = sectionResources.find(
      (r) => r.resource_type === "solution",
    );

    if (!questionsResource) {
      console.log(`\nSection ${sectionId}: no questions resource, skipping`);
      continue;
    }

    if (!questionsResource.pdf_path) {
      console.log(`\nSection ${sectionId}: questions resource has no PDF, skipping`);
      continue;
    }

    console.log(`\n── ${questionsResource.title} (resource ${questionsResource.id}) ──`);

    // Download and parse questions PDF
    console.log(`  Downloading questions PDF...`);
    const questionsPdf = await downloadPdf(questionsResource.pdf_path);
    console.log(`  Converting to markdown via LlamaParse...`);
    const questionsMarkdown = await pdfToMarkdown(questionsPdf, `${questionsResource.title}.pdf`);

    if (!questionsMarkdown.trim()) {
      console.log(`  Empty markdown from questions PDF, skipping`);
      continue;
    }
    console.log(`  Questions markdown: ${questionsMarkdown.length} chars`);

    // Download and parse solution PDF if available
    let solutionsMarkdown: string | null = null;
    if (solutionResource?.pdf_path) {
      console.log(`  Downloading solutions PDF...`);
      const solutionPdf = await downloadPdf(solutionResource.pdf_path);
      console.log(`  Converting solutions to markdown...`);
      solutionsMarkdown = await pdfToMarkdown(solutionPdf, `${solutionResource.title}.pdf`);
      console.log(`  Solutions markdown: ${solutionsMarkdown.length} chars`);
    } else {
      console.log(`  No solution PDF found`);
    }

    // Extract problems via LLM
    console.log(`  Extracting problems via Claude...`);
    const problems = await extractProblems(questionsMarkdown, solutionsMarkdown);
    console.log(`  Extracted ${problems.length} problems`);

    if (problems.length === 0) continue;

    // Delete existing problems for this resource (idempotency)
    const { error: deleteError } = await supabase
      .from("problems")
      .delete()
      .eq("resource_id", questionsResource.id);

    if (deleteError) {
      console.error(`  Error deleting old problems:`, deleteError);
      continue;
    }

    // Insert new problems
    const rows = problems.map((p) => ({
      resource_id: questionsResource.id,
      course_id: course.id,
      problem_label: p.problem_label,
      question_text: p.question_text,
      solution_text: p.solution_text,
      ordering: p.ordering,
    }));

    const { error: insertError } = await supabase.from("problems").insert(rows);

    if (insertError) {
      console.error(`  Error inserting problems:`, insertError);
      continue;
    }

    console.log(`  Inserted ${rows.length} problems`);
    totalProblems += rows.length;
  }

  console.log(`\n✓ Done! Inserted ${totalProblems} total problems for "${course.title}"`);
}

// Entry point
const slug = process.argv[2];
if (!slug) {
  console.error("Usage: pnpm parse-problems <course-slug>");
  console.error("Example: pnpm parse-problems 6-006-introduction-to-algorithms-spring-2020");
  process.exit(1);
}

parseProblems(slug).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
