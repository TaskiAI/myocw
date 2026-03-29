import {
  supabase,
  PARSER_PROVIDER,
  OPENAI_ENDPOINT_URL,
  OPENAI_MODEL,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_REASONING_EFFORT,
  OPENAI_TEXT_VERBOSITY,
  QWEN_ENDPOINT_URL,
  QWEN_MODEL,
  QWEN_IMAGE_DPI,
  QWEN_IMAGE_FORMAT,
  QWEN_IMAGE_QUALITY,
  QWEN_RENDER_MAX_PAGES,
  QWEN_MAX_PAGES_PER_QUESTION_CALL,
  QWEN_MAX_PAGES_PER_VISION_CALL,
  QWEN_MAX_HINTS_PER_SOLUTION_CALL,
  QWEN_SOLUTION_MAX_PAGES,
} from "./parsing/config.js";
import { sanitizeFilename } from "./parsing/json-utils.js";
import { downloadPdf } from "./parsing/pdf-rendering.js";
import {
  extractProblemsFromPdfs,
  pickSolutionResource,
  decideTitleNormalization,
} from "./parsing/extraction.js";
import type {
  ExtractionOutcome,
  ResourceRow,
  SectionRow,
  TitleNormalizationDecision,
  ParseProblemsOptions,
  ParseProblemsResult,
} from "./parsing/types.js";

// Re-export public API types
export type { ParseProblemsOptions, ParseProblemsResult } from "./parsing/types.js";

// Re-export __internal for tests — same shape as before
import {
  stripFences,
  parseJsonLike,
  parseQuestionExtractionPayload,
  parseSolutionExtractionEntries,
  parseSolutionReconciliationUpdates,
  containsSplitSubparts,
} from "./parsing/json-utils.js";
import { deterministicMergeSolutions } from "./parsing/extraction.js";

export const __internal = {
  stripFences,
  parseJsonLike,
  parseQuestionExtractionPayload,
  parseSolutionExtractionEntries,
  parseSolutionReconciliationUpdates,
  containsSplitSubparts,
  deterministicMergeSolutions,
  decideTitleNormalization,
};

export async function parseProblems(
  slug: string,
  options: ParseProblemsOptions = {},
): Promise<ParseProblemsResult> {
  const forceReparse = options.forceReparse ?? false;

  console.log(`Looking up course: ${slug}`);
  console.log(`Options: force-reparse=${forceReparse}`);
  console.log(`Parser provider: ${PARSER_PROVIDER}`);
  if (PARSER_PROVIDER === "openai_pdf") {
    console.log(`OpenAI endpoint: ${OPENAI_ENDPOINT_URL}`);
    console.log(`OpenAI model: ${OPENAI_MODEL}`);
    console.log(
      `OpenAI config: max_output_tokens=${OPENAI_MAX_OUTPUT_TOKENS} reasoning_effort=${OPENAI_REASONING_EFFORT} verbosity=${OPENAI_TEXT_VERBOSITY}`,
    );
  } else {
    console.log(`Qwen endpoint: ${QWEN_ENDPOINT_URL}`);
    console.log(`Qwen model: ${QWEN_MODEL}`);
    console.log(
      `Image render config: dpi=${QWEN_IMAGE_DPI} format=${QWEN_IMAGE_FORMAT} quality=${QWEN_IMAGE_QUALITY} max_pages=${QWEN_RENDER_MAX_PAGES} max_pages_per_question_call=${QWEN_MAX_PAGES_PER_QUESTION_CALL} max_pages_per_solution_call=${QWEN_MAX_PAGES_PER_VISION_CALL} max_hints_per_solution_call=${QWEN_MAX_HINTS_PER_SOLUTION_CALL} solution_max_pages=${QWEN_SOLUTION_MAX_PAGES}`,
    );
  }

  const { data: courses, error: lookupError } = await supabase
    .from("courses")
    .select("*")
    .ilike("url", `%${slug}%`);

  if (lookupError || !courses?.length) {
    throw new Error(`Course not found: ${lookupError?.message ?? "no match"}`);
  }

  const course =
    courses.find((row: { url: string }) =>
      row.url.replace(/\/$/, "").endsWith(`/${slug}`),
    ) ?? courses[0];

  console.log(`Found: ${course.title} (id: ${course.id})`);

  const { data: resources, error: resError } = await supabase
    .from("resources")
    .select("id, course_id, section_id, title, resource_type, pdf_path, ordering")
    .eq("course_id", course.id)
    .in("resource_type", ["problem_set", "solution", "exam"])
    .order("ordering", { ascending: true });

  if (resError) {
    throw new Error(`Error fetching resources: ${resError.message}`);
  }

  const { data: sectionRows, error: sectionError } = await supabase
    .from("course_sections")
    .select("id,title")
    .eq("course_id", course.id);

  if (sectionError) {
    throw new Error(`Error fetching section titles: ${sectionError.message}`);
  }

  const sectionTitleById = new Map<number, string>();
  for (const row of ((sectionRows ?? []) as SectionRow[])) {
    sectionTitleById.set(row.id, row.title ?? "");
  }

  const allResources = (resources ?? []) as ResourceRow[];
  console.log(`Found ${allResources.length} problem-related resources`);

  if (allResources.length === 0) {
    console.log("No problem sets, solutions, or exams found for this course.");
    return { insertedProblems: 0, processedResources: 0, skippedResources: 0 };
  }

  const bySection = new Map<number | null, ResourceRow[]>();
  for (const resource of allResources) {
    if (!bySection.has(resource.section_id)) bySection.set(resource.section_id, []);
    bySection.get(resource.section_id)!.push(resource);
  }

  let insertedProblems = 0;
  let processedResources = 0;
  let skippedResources = 0;
  const extractionErrors: string[] = [];
  const solutionPdfCache = new Map<number, Buffer>();

  for (const [sectionId, sectionResources] of bySection) {
    const questionResources = sectionResources.filter(
      (resource) =>
        resource.resource_type === "problem_set" || resource.resource_type === "exam",
    );
    const solutionResources = sectionResources.filter(
      (resource) => resource.resource_type === "solution" && resource.pdf_path,
    );

    if (questionResources.length === 0) {
      console.log(`\nSection ${sectionId ?? "null"}: no question resources, skipping`);
      continue;
    }

    for (const questionsResource of questionResources) {
      if (!questionsResource.pdf_path) {
        console.log(
          `\nSection ${sectionId ?? "null"} resource ${questionsResource.id}: no PDF path, skipping`,
        );
        skippedResources++;
        continue;
      }

      if (!forceReparse) {
        const { count, error: countError } = await supabase
          .from("problems")
          .select("id", { count: "exact", head: true })
          .eq("resource_id", questionsResource.id);

        if (countError) {
          throw new Error(
            `Failed to check existing problems for resource ${questionsResource.id}: ${countError.message}`,
          );
        }

        if ((count ?? 0) > 0) {
          console.log(
            `\n── ${questionsResource.title} (resource ${questionsResource.id}) already parsed (${count}), skipping`,
          );
          skippedResources++;
          continue;
        }
      }

      console.log(`\n── ${questionsResource.title} (resource ${questionsResource.id}) ──`);
      const pairedSolution = pickSolutionResource(questionsResource, solutionResources);

      let extracted: ExtractionOutcome;

      try {
        console.log("  Downloading questions PDF...");
        const questionsPdf = await downloadPdf(questionsResource.pdf_path);
        const questionsFilename = `${sanitizeFilename(questionsResource.title)}.pdf`;
        console.log(`  Questions PDF size: ${questionsPdf.length} bytes`);

        let solutionsPdf: Buffer | null = null;
        let solutionsFilename: string | null = null;

        if (pairedSolution?.pdf_path) {
          if (solutionPdfCache.has(pairedSolution.id)) {
            solutionsPdf = solutionPdfCache.get(pairedSolution.id)!;
            console.log(`  Reusing solution PDF from cache (${pairedSolution.title})`);
          } else {
            console.log(`  Downloading solution PDF (${pairedSolution.title})...`);
            solutionsPdf = await downloadPdf(pairedSolution.pdf_path);
            solutionPdfCache.set(pairedSolution.id, solutionsPdf);
          }

          solutionsFilename = `${sanitizeFilename(pairedSolution.title)}.pdf`;
          console.log(`  Solutions PDF size: ${solutionsPdf.length} bytes`);
        } else {
          console.log("  No solution PDF found for this problem set");
        }

        console.log(
          `  Extracting structured problems with ${PARSER_PROVIDER === "openai_pdf" ? "OpenAI PDF pipeline" : "Qwen vision pipeline"}...`,
        );
        extracted = await extractProblemsFromPdfs(
          questionsPdf,
          questionsFilename,
          solutionsPdf,
          solutionsFilename,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  Extraction failed: ${message}`);
        extractionErrors.push(`resource ${questionsResource.id}: ${message}`);
        skippedResources++;
        continue;
      }

      const extractedProblems = extracted.problems;

      console.log(
        `  Render stats: question_pages=${extracted.metrics.questionPages} solution_pages=${extracted.metrics.solutionPages} question_image_bytes=${extracted.metrics.questionImageBytes} solution_image_bytes=${extracted.metrics.solutionImageBytes}`,
      );

      if (extracted.contentTitle) {
        console.log(`  Extracted content title: ${extracted.contentTitle}`);
      }

      console.log(`  Extracted ${extractedProblems.length} problems`);
      console.log(
        `  Paired solutions: ${extracted.metrics.pairedSolutions}/${extractedProblems.length}`,
      );

      let titleUpdated = false;
      let titleDecision: TitleNormalizationDecision = {
        shouldUpdate: false,
        reason: "no_section_id",
        nextTitle: null,
      };

      if (questionsResource.section_id !== null) {
        const currentTitle = sectionTitleById.get(questionsResource.section_id) ?? "";
        titleDecision = decideTitleNormalization(currentTitle, extracted.contentTitle);

        if (titleDecision.shouldUpdate && titleDecision.nextTitle) {
          const { error: titleUpdateError } = await supabase
            .from("course_sections")
            .update({ title: titleDecision.nextTitle })
            .eq("id", questionsResource.section_id);

          if (titleUpdateError) {
            console.warn(
              `  Failed to update section title for section ${questionsResource.section_id}: ${titleUpdateError.message}`,
            );
          } else {
            titleUpdated = true;
            sectionTitleById.set(questionsResource.section_id, titleDecision.nextTitle);
          }
        }
      }

      console.log(
        `  Title normalization: reason=${titleDecision.reason} title_updated=${titleUpdated}${titleUpdated ? ` next_title=${titleDecision.nextTitle}` : ""}`,
      );

      if (extractedProblems.length === 0) {
        skippedResources++;
        continue;
      }

      const { error: deleteError } = await supabase
        .from("problems")
        .delete()
        .eq("resource_id", questionsResource.id);

      if (deleteError) {
        throw new Error(
          `Error deleting old problems for resource ${questionsResource.id}: ${deleteError.message}`,
        );
      }

      const rows = extractedProblems.map((problem) => ({
        resource_id: questionsResource.id,
        course_id: course.id,
        problem_label: problem.problem_label,
        question_text: problem.question_text,
        solution_text: problem.solution_text,
        ordering: problem.ordering,
      }));

      const { error: insertError } = await supabase.from("problems").insert(rows);
      if (insertError) {
        throw new Error(
          `Error inserting problems for resource ${questionsResource.id}: ${insertError.message}`,
        );
      }

      processedResources++;
      insertedProblems += rows.length;
      console.log(`  Inserted ${rows.length} problems`);
    }
  }

  console.log(
    `\n✓ Done! inserted_problems=${insertedProblems} processed_resources=${processedResources} skipped_resources=${skippedResources}`,
  );

  if (extractionErrors.length > 0) {
    const preview = extractionErrors.slice(0, 3).join(" | ");
    throw new Error(
      `Completed with extraction errors (${extractionErrors.length} resource(s)): ${preview}`,
    );
  }

  return { insertedProblems, processedResources, skippedResources };
}

const __isMain = process.argv[1]?.includes("parse-problems");
if (__isMain) {
  const args = process.argv.slice(2);
  const slug = args[0];
  const forceReparse = args.includes("--force-reparse");

  if (!slug) {
    console.error("Usage: pnpm parse-problems <course-slug> [--force-reparse]");
    console.error(
      "Example: pnpm parse-problems 6-006-introduction-to-algorithms-spring-2020",
    );
    process.exit(1);
  }

  parseProblems(slug, { forceReparse }).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
