import {
  QWEN_ALLOWED_CTX,
  QWEN_MAX_OUTPUT_TOKENS,
  QWEN_MAX_PAGES_PER_QUESTION_CALL,
  QWEN_MAX_PAGES_PER_VISION_CALL,
  QWEN_MAX_HINTS_PER_SOLUTION_CALL,
  QWEN_SOLUTION_MAX_PAGES,
  QWEN_ENABLE_RAW_SOLUTION_FALLBACK,
  PARSER_PROVIDER,
} from "./config.js";
import {
  normalizeWhitespace,
  normalizeLabel,
  stripFences,
  chunkArray,
  containsSplitSubparts,
  reindexProblems,
  parseQuestionExtractionPayload,
  parseSolutionExtractionEntries,
  parseSolutionReconciliationUpdates,
} from "./json-utils.js";
import {
  callQwenResponses,
  callOpenAiResponsesWithPdf,
  uploadPdfToOpenAI,
  logUsage,
  parseWithRepair,
} from "./llm-clients.js";
import { renderPdfToImages, cleanupRenderedPdf } from "./pdf-rendering.js";
import {
  buildQuestionExtractionPrompt,
  buildSubpartConsolidationPrompt,
  buildSolutionExtractionPrompt,
  buildSolutionReconciliationPrompt,
  buildVisionContent,
  toQuestionHint,
  QUESTION_EXTRACTION_RESPONSE_SCHEMA,
  SOLUTION_EXTRACTION_RESPONSE_SCHEMA,
  SOLUTION_RECONCILIATION_RESPONSE_SCHEMA,
} from "./prompts.js";
import type {
  ExtractedProblem,
  ExtractionOutcome,
  QuestionExtractionPayload,
  RenderedPageImage,
  RenderedPdf,
  ResourceRow,
  SolutionExtractionEntry,
  TitleNormalizationDecision,
} from "./types.js";

export async function extractQuestionsFromImages(
  questionPages: RenderedPageImage[],
): Promise<QuestionExtractionPayload> {
  const schemaHint = `{"content_title":"string|null","problems":[{"problem_label":"string","question_text":"string","ordering":0}]}`;
  const pageChunks = chunkArray(
    questionPages,
    Math.max(1, QWEN_MAX_PAGES_PER_QUESTION_CALL),
  );
  const collected: ExtractedProblem[] = [];
  let extractedTitle: string | null = null;

  for (let chunkIndex = 0; chunkIndex < pageChunks.length; chunkIndex++) {
    const chunk = pageChunks[chunkIndex];
    const prompt = `${buildQuestionExtractionPrompt(chunk.length)}

You are processing QUESTION page chunk ${chunkIndex + 1} of ${pageChunks.length}.
Only include problems that are visible in this chunk.`;

    let parsedChunk: QuestionExtractionPayload | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const call = await callQwenResponses(
          buildVisionContent(prompt, chunk, "QUESTION"),
        );
        logUsage(
          `  Qwen question extraction chunk ${chunkIndex + 1}/${pageChunks.length}`,
          call.usage,
        );

        let parsed = await parseWithRepair(
          call.outputText,
          parseQuestionExtractionPayload,
          schemaHint,
          "Question extraction",
        );

        parsed = {
          content_title: parsed.content_title,
          problems: reindexProblems(
            parsed.problems.map((problem, index) => ({
              problem_label: normalizeWhitespace(problem.problem_label),
              question_text: problem.question_text.trim(),
              solution_text: null,
              ordering:
                Number.isFinite(problem.ordering) && problem.ordering >= 0
                  ? problem.ordering
                  : index,
            })),
          ),
        };

        if (containsSplitSubparts(parsed.problems)) {
          console.log(
            "  Question extraction appears to split subparts; requesting consolidation pass...",
          );

          const consolidationCall = await callQwenResponses(
            buildSubpartConsolidationPrompt(parsed),
          );
          logUsage("  Qwen subpart consolidation", consolidationCall.usage);

          parsed = await parseWithRepair(
            consolidationCall.outputText,
            parseQuestionExtractionPayload,
            schemaHint,
            "Subpart consolidation",
          );

          parsed = {
            content_title: parsed.content_title,
            problems: reindexProblems(
              parsed.problems.map((problem, index) => ({
                problem_label: normalizeWhitespace(problem.problem_label),
                question_text: problem.question_text.trim(),
                solution_text: null,
                ordering:
                  Number.isFinite(problem.ordering) && problem.ordering >= 0
                    ? problem.ordering
                    : index,
              })),
            ),
          };
        }

        parsedChunk = parsed;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 2) {
          console.log(
            `  Question extraction chunk ${chunkIndex + 1}/${pageChunks.length} failed; retrying one more time...`,
          );
        }
      }
    }

    if (!parsedChunk) {
      throw (
        lastError ??
        new Error(
          `Question extraction failed for chunk ${chunkIndex + 1}/${pageChunks.length}`,
        )
      );
    }

    if (!extractedTitle && parsedChunk.content_title) {
      extractedTitle = parsedChunk.content_title;
    }

    for (let i = 0; i < parsedChunk.problems.length; i++) {
      const problem = parsedChunk.problems[i];
      collected.push({
        problem_label: problem.problem_label,
        question_text: problem.question_text,
        solution_text: null,
        ordering: chunkIndex * 1000 + i,
      });
    }
  }

  if (collected.length === 0) {
    return { content_title: extractedTitle, problems: [] };
  }

  const mergedByLabel = new Map<string, ExtractedProblem>();
  for (const problem of collected) {
    const key = normalizeLabel(problem.problem_label);
    const dedupeKey = key || `ordering:${problem.ordering}`;
    const existing = mergedByLabel.get(dedupeKey);

    if (!existing) {
      mergedByLabel.set(dedupeKey, {
        problem_label: normalizeWhitespace(problem.problem_label),
        question_text: problem.question_text.trim(),
        solution_text: null,
        ordering: problem.ordering,
      });
      continue;
    }

    const existingText = existing.question_text.trim();
    const nextText = problem.question_text.trim();

    if (nextText.length > existingText.length) {
      existing.question_text = nextText;
    } else if (
      nextText &&
      !existingText.includes(nextText) &&
      !nextText.includes(existingText)
    ) {
      existing.question_text = `${existingText}\n\n${nextText}`;
    }

    if (problem.ordering < existing.ordering) {
      existing.ordering = problem.ordering;
    }

    if (problem.problem_label.length < existing.problem_label.length) {
      existing.problem_label = problem.problem_label;
    }
  }

  let finalPayload: QuestionExtractionPayload = {
    content_title: extractedTitle,
    problems: reindexProblems(Array.from(mergedByLabel.values())),
  };

  if (containsSplitSubparts(finalPayload.problems)) {
    const consolidationCall = await callQwenResponses(
      buildSubpartConsolidationPrompt(finalPayload),
    );
    logUsage("  Qwen final subpart consolidation", consolidationCall.usage);

    finalPayload = await parseWithRepair(
      consolidationCall.outputText,
      parseQuestionExtractionPayload,
      schemaHint,
      "Final subpart consolidation",
    );

    finalPayload = {
      content_title: finalPayload.content_title,
      problems: reindexProblems(
        finalPayload.problems.map((problem, index) => ({
          problem_label: normalizeWhitespace(problem.problem_label),
          question_text: problem.question_text.trim(),
          solution_text: null,
          ordering:
            Number.isFinite(problem.ordering) && problem.ordering >= 0
              ? problem.ordering
              : index,
        })),
      ),
    };
  }

  return finalPayload;
}

export function cleanupSolutionText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return cleaned;
  if (/^```/i.test(cleaned) && /```$/i.test(cleaned)) {
    return stripFences(cleaned);
  }
  return cleaned;
}

function trimLargeSolutionEntry(entry: SolutionExtractionEntry): SolutionExtractionEntry {
  if (!entry.solution_text) return entry;
  return {
    problem_label: entry.problem_label,
    ordering_hint: entry.ordering_hint,
    solution_text: cleanupSolutionText(entry.solution_text),
  };
}

function dedupeSolutionEntries(
  collected: SolutionExtractionEntry[],
): SolutionExtractionEntry[] {
  const bestByLabel = new Map<string, SolutionExtractionEntry>();

  for (const rawEntry of collected) {
    const entry = trimLargeSolutionEntry(rawEntry);
    if (!entry.solution_text) continue;
    const key = normalizeLabel(entry.problem_label);
    if (!key) continue;

    const existing = bestByLabel.get(key);
    if (!existing) {
      bestByLabel.set(key, entry);
      continue;
    }

    const existingLen = existing.solution_text?.length ?? 0;
    const currentLen = entry.solution_text.length;
    if (currentLen > existingLen) {
      bestByLabel.set(key, entry);
      continue;
    }

    if (existing.ordering_hint === null && entry.ordering_hint !== null) {
      bestByLabel.set(key, entry);
    }
  }

  return Array.from(bestByLabel.values());
}

async function extractSolutionEntriesFromImages(
  questions: ExtractedProblem[],
  solutionPages: RenderedPageImage[],
): Promise<SolutionExtractionEntry[]> {
  if (questions.length === 0) return [];

  const hints = questions.map(toQuestionHint);
  const schemaHint = `{"solutions":[{"problem_label":"string","ordering_hint":0,"solution_text":"string|null"}]}`;
  const pageChunks = chunkArray(
    solutionPages,
    Math.max(1, QWEN_MAX_PAGES_PER_VISION_CALL),
  );
  const hintChunks = chunkArray(
    hints,
    Math.max(1, QWEN_MAX_HINTS_PER_SOLUTION_CALL),
  );

  const collected: SolutionExtractionEntry[] = [];

  for (let pageChunkIndex = 0; pageChunkIndex < pageChunks.length; pageChunkIndex++) {
    const pageChunk = pageChunks[pageChunkIndex];

    for (
      let hintChunkIndex = 0;
      hintChunkIndex < hintChunks.length;
      hintChunkIndex++
    ) {
      const hintChunk = hintChunks[hintChunkIndex];
      const prompt = buildSolutionExtractionPrompt(
        hintChunk,
        pageChunkIndex + 1,
        pageChunks.length,
      );

      let chunkResult: SolutionExtractionEntry[] | null = null;
      let lastError: Error | null = null;
      let lastRawOutput: string | null = null;

      for (let attempt = 1; attempt <= 1; attempt++) {
        try {
          const call = await callQwenResponses(
            buildVisionContent(prompt, pageChunk, "SOLUTION"),
          );
          lastRawOutput = call.outputText;
          logUsage(
            `  Qwen solution extraction page_chunk ${pageChunkIndex + 1}/${pageChunks.length} hint_chunk ${hintChunkIndex + 1}/${hintChunks.length}`,
            call.usage,
          );

          chunkResult = parseSolutionExtractionEntries(call.outputText);
          if (chunkResult === null) {
            lastError = new Error("Solution extraction: model output was not valid JSON");
          }
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < 2) {
            console.log(
              `  Solution extraction page_chunk ${pageChunkIndex + 1}/${pageChunks.length} hint_chunk ${hintChunkIndex + 1}/${hintChunks.length} failed; retrying...`,
            );
          }
        }
      }

      if (!chunkResult) {
        if (QWEN_ENABLE_RAW_SOLUTION_FALLBACK && hintChunk.length === 1 && lastRawOutput) {
          const fallbackText = cleanupSolutionText(stripFences(lastRawOutput)).trim();
          if (fallbackText.length > 0) {
            const compactFallback = fallbackText.replace(/\s+/g, "");
            if (compactFallback !== "[]" && compactFallback !== "{}") {
              collected.push({
                problem_label: hintChunk[0].problem_label,
                ordering_hint: hintChunk[0].ordering,
                solution_text: fallbackText.slice(0, 6000),
              });
              console.warn(
                `  Solution extraction recovered raw text for page_chunk ${pageChunkIndex + 1}/${pageChunks.length} hint_chunk ${hintChunkIndex + 1}/${hintChunks.length}`,
              );
              continue;
            }
          }
        }

        const reason =
          lastError?.message ??
          "model output was not valid JSON after retries";
        console.warn(
          `  Solution extraction skipped for page_chunk ${pageChunkIndex + 1}/${pageChunks.length} hint_chunk ${hintChunkIndex + 1}/${hintChunks.length}: ${reason}`,
        );
        continue;
      }

      collected.push(...chunkResult);
    }
  }

  return dedupeSolutionEntries(collected);
}

export function chooseLongestEntryIndex(
  candidateIndices: number[],
  entries: SolutionExtractionEntry[],
): number {
  let best = candidateIndices[0];
  for (const idx of candidateIndices.slice(1)) {
    const curLen = entries[idx].solution_text?.length ?? 0;
    const bestLen = entries[best].solution_text?.length ?? 0;
    if (curLen > bestLen) {
      best = idx;
    }
  }
  return best;
}

export function deterministicMergeSolutions(
  questions: ExtractedProblem[],
  entries: SolutionExtractionEntry[],
): {
  merged: ExtractedProblem[];
  unmatchedQuestionIndices: number[];
  unresolvedEntries: SolutionExtractionEntry[];
  deterministicMatches: number;
} {
  const merged: ExtractedProblem[] = questions.map((question) => ({
    problem_label: question.problem_label,
    question_text: question.question_text,
    solution_text: null as string | null,
    ordering: question.ordering,
  }));

  const usableEntries = entries
    .map((entry, index) => ({ index, entry }))
    .filter(({ entry }) => Boolean(entry.solution_text));

  const byLabel = new Map<string, number[]>();
  for (const { index, entry } of usableEntries) {
    const key = normalizeLabel(entry.problem_label);
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(index);
  }

  const usedEntryIndices = new Set<number>();

  for (let qIdx = 0; qIdx < merged.length; qIdx++) {
    const question = merged[qIdx];
    const labelKey = normalizeLabel(question.problem_label);
    const labelCandidates = (byLabel.get(labelKey) ?? []).filter(
      (idx) => !usedEntryIndices.has(idx),
    );

    if (labelCandidates.length === 0) continue;

    const chosen = chooseLongestEntryIndex(labelCandidates, entries);
    merged[qIdx].solution_text = entries[chosen].solution_text;
    usedEntryIndices.add(chosen);
  }

  for (let qIdx = 0; qIdx < merged.length; qIdx++) {
    if (merged[qIdx].solution_text) continue;

    const orderingCandidates = usableEntries
      .filter(
        ({ index, entry }) =>
          !usedEntryIndices.has(index) &&
          entry.ordering_hint !== null &&
          entry.ordering_hint === merged[qIdx].ordering,
      )
      .map(({ index }) => index);

    if (orderingCandidates.length !== 1) continue;

    const chosen = orderingCandidates[0];
    merged[qIdx].solution_text = entries[chosen].solution_text;
    usedEntryIndices.add(chosen);
  }

  const unmatchedQuestionIndices: number[] = [];
  for (let i = 0; i < merged.length; i++) {
    if (!merged[i].solution_text) unmatchedQuestionIndices.push(i);
  }

  const unresolvedEntries = usableEntries
    .filter(({ index }) => !usedEntryIndices.has(index))
    .map(({ entry }) => entry);

  return {
    merged,
    unmatchedQuestionIndices,
    unresolvedEntries,
    deterministicMatches: merged.filter((problem) => Boolean(problem.solution_text)).length,
  };
}

async function reconcileUnmatchedSolutions(
  mergedQuestions: ExtractedProblem[],
  unmatchedQuestionIndices: number[],
  unresolvedEntries: SolutionExtractionEntry[],
): Promise<Map<number, string>> {
  const reconciled = new Map<number, string>();
  if (unmatchedQuestionIndices.length === 0 || unresolvedEntries.length === 0) {
    return reconciled;
  }

  const unmatchedQuestions = unmatchedQuestionIndices.map((idx) =>
    toQuestionHint(mergedQuestions[idx]),
  );

  const unresolvedHints = unresolvedEntries.map((entry) => ({
    problem_label: entry.problem_label,
    ordering_hint: entry.ordering_hint,
    solution_hint: (entry.solution_text ?? "").replace(/\s+/g, " ").slice(0, 240),
  }));

  const prompt = buildSolutionReconciliationPrompt(unmatchedQuestions, unresolvedHints);
  const estimatedTokens = Math.ceil(prompt.length / 4);
  const budget = Math.max(1024, QWEN_ALLOWED_CTX - QWEN_MAX_OUTPUT_TOKENS - 512);

  if (estimatedTokens > budget) {
    console.log(
      `  Reconciliation prompt estimate=${estimatedTokens} exceeds budget=${budget}; skipping reconciliation`,
    );
    return reconciled;
  }

  const call = await callQwenResponses(prompt);
  logUsage("  Qwen solution reconciliation", call.usage);

  const schemaHint = `{"updates":[{"problem_label":"string","solution_text":"string|null"}]}`;
  const updates = await parseWithRepair(
    call.outputText,
    parseSolutionReconciliationUpdates,
    schemaHint,
    "Solution reconciliation",
    { jsonSchema: SOLUTION_RECONCILIATION_RESPONSE_SCHEMA },
  );

  const solutionByLabel = new Map<string, string>();
  for (const update of updates) {
    if (!update.solution_text) continue;
    const key = normalizeLabel(update.problem_label);
    if (!key) continue;

    const existing = solutionByLabel.get(key);
    if (!existing || update.solution_text.length > existing.length) {
      solutionByLabel.set(key, update.solution_text);
    }
  }

  for (const idx of unmatchedQuestionIndices) {
    const labelKey = normalizeLabel(mergedQuestions[idx].problem_label);
    const matched = solutionByLabel.get(labelKey);
    if (matched) {
      reconciled.set(idx, matched);
    }
  }

  return reconciled;
}

async function pairSolutionsFromImages(
  questions: ExtractedProblem[],
  solutionPages: RenderedPageImage[],
): Promise<ExtractedProblem[]> {
  if (questions.length === 0) return [];

  const entries = await extractSolutionEntriesFromImages(questions, solutionPages);
  const deterministic = deterministicMergeSolutions(questions, entries);

  const reconciled = await reconcileUnmatchedSolutions(
    deterministic.merged,
    deterministic.unmatchedQuestionIndices,
    deterministic.unresolvedEntries,
  );

  for (const [idx, solution] of reconciled.entries()) {
    deterministic.merged[idx].solution_text = solution;
  }

  const final = reindexProblems(deterministic.merged);
  const finalMatches = final.filter((problem) => Boolean(problem.solution_text)).length;
  const reconciledCount = Math.max(0, finalMatches - deterministic.deterministicMatches);

  console.log(
    `  Solution mapping: deterministic=${deterministic.deterministicMatches} reconciled=${reconciledCount} total=${finalMatches}/${final.length}`,
  );

  return final;
}

async function extractProblemsFromPdfsViaOpenAiPdf(
  questionsPdf: Buffer,
  questionsFilename: string,
  solutionsPdf: Buffer | null,
  solutionsFilename: string | null,
): Promise<ExtractionOutcome> {
  const questionFileId = await uploadPdfToOpenAI(questionsPdf, questionsFilename);
  const questionPrompt = `${buildQuestionExtractionPrompt(0)}

You are reading an attached PDF file (not images). Parse all pages in order.`;

  const questionCall = await callOpenAiResponsesWithPdf(questionPrompt, questionFileId, {
    jsonSchema: QUESTION_EXTRACTION_RESPONSE_SCHEMA,
  });
  logUsage("  OpenAI question extraction", questionCall.usage);
  const questionSchemaHint =
    `{"content_title":"string|null","problems":[{"problem_label":"string","question_text":"string","ordering":0}]}`;
  const questionPayload = await parseWithRepair(
    questionCall.outputText,
    parseQuestionExtractionPayload,
    questionSchemaHint,
    "Question extraction",
    { jsonSchema: QUESTION_EXTRACTION_RESPONSE_SCHEMA },
  );
  let problems = reindexProblems(questionPayload.problems);

  if (solutionsPdf && solutionsFilename && problems.length > 0) {
    const hints = problems.map(toQuestionHint);
    const solutionFileId = await uploadPdfToOpenAI(solutionsPdf, solutionsFilename);
    const solutionPrompt = `${buildSolutionExtractionPrompt(hints, 1, 1)}

You are reading an attached PDF file (not images). Parse all pages in order.`;

    const solutionCall = await callOpenAiResponsesWithPdf(solutionPrompt, solutionFileId, {
      jsonSchema: SOLUTION_EXTRACTION_RESPONSE_SCHEMA,
    });
    logUsage("  OpenAI solution extraction", solutionCall.usage);
    const solutionSchemaHint =
      `{"solutions":[{"problem_label":"string","ordering_hint":0,"solution_text":"string|null"}]}`;
    const entries = await parseWithRepair(
      solutionCall.outputText,
      parseSolutionExtractionEntries,
      solutionSchemaHint,
      "Solution extraction",
      { jsonSchema: SOLUTION_EXTRACTION_RESPONSE_SCHEMA },
    );

    const deterministic = deterministicMergeSolutions(problems, dedupeSolutionEntries(entries));
    problems = reindexProblems(deterministic.merged);
  }

  return {
    problems,
    contentTitle: questionPayload.content_title,
    metrics: {
      questionPages: 0,
      solutionPages: 0,
      questionImageBytes: 0,
      solutionImageBytes: 0,
      pairedSolutions: problems.filter((problem) => Boolean(problem.solution_text)).length,
    },
  };
}

export async function extractProblemsFromPdfs(
  questionsPdf: Buffer,
  questionsFilename: string,
  solutionsPdf: Buffer | null,
  solutionsFilename: string | null,
): Promise<ExtractionOutcome> {
  if (PARSER_PROVIDER === "openai_pdf") {
    return await extractProblemsFromPdfsViaOpenAiPdf(
      questionsPdf,
      questionsFilename,
      solutionsPdf,
      solutionsFilename,
    );
  }

  let renderedQuestions: RenderedPdf | null = null;
  let renderedSolutions: RenderedPdf | null = null;

  try {
    renderedQuestions = await renderPdfToImages(questionsPdf, questionsFilename);
    console.log(
      `  Rendered questions: pages=${renderedQuestions.renderedCount}/${renderedQuestions.sourcePageCount} bytes=${renderedQuestions.totalImageBytes}${renderedQuestions.truncated ? " (truncated by max-pages)" : ""}`,
    );

    const questionPayload = await extractQuestionsFromImages(renderedQuestions.pages);
    let problems = reindexProblems(questionPayload.problems);

    let solutionPages = 0;
    let solutionImageBytes = 0;

    if (solutionsPdf && solutionsFilename && problems.length > 0) {
      renderedSolutions = await renderPdfToImages(solutionsPdf, solutionsFilename);
      solutionPages = renderedSolutions.renderedCount;
      solutionImageBytes = renderedSolutions.totalImageBytes;

      console.log(
        `  Rendered solutions: pages=${renderedSolutions.renderedCount}/${renderedSolutions.sourcePageCount} bytes=${renderedSolutions.totalImageBytes}${renderedSolutions.truncated ? " (truncated by max-pages)" : ""}`,
      );

      try {
        const solutionPagesForExtraction =
          QWEN_SOLUTION_MAX_PAGES > 0
            ? renderedSolutions.pages.slice(0, QWEN_SOLUTION_MAX_PAGES)
            : renderedSolutions.pages;

        if (solutionPagesForExtraction.length !== renderedSolutions.pages.length) {
          console.log(
            `  Limiting solution extraction pages: using ${solutionPagesForExtraction.length}/${renderedSolutions.pages.length}`,
          );
        }

        problems = await pairSolutionsFromImages(problems, solutionPagesForExtraction);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`  Solution pairing failed; proceeding with question-only rows: ${message}`);
      }
    }

    return {
      problems,
      contentTitle: questionPayload.content_title,
      metrics: {
        questionPages: renderedQuestions.renderedCount,
        solutionPages,
        questionImageBytes: renderedQuestions.totalImageBytes,
        solutionImageBytes,
        pairedSolutions: problems.filter((problem) => Boolean(problem.solution_text)).length,
      },
    };
  } finally {
    await cleanupRenderedPdf(renderedQuestions);
    await cleanupRenderedPdf(renderedSolutions);
  }
}

export function pickSolutionResource(
  question: ResourceRow,
  solutions: ResourceRow[],
): ResourceRow | null {
  if (solutions.length === 0) return null;
  if (solutions.length === 1) return solutions[0];

  const sorted = [...solutions].sort((a, b) => {
    const distanceA = Math.abs(a.ordering - question.ordering);
    const distanceB = Math.abs(b.ordering - question.ordering);
    if (distanceA !== distanceB) return distanceA - distanceB;
    return a.ordering - b.ordering;
  });

  return sorted[0] ?? null;
}

export function isLowQualitySectionTitle(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  if (
    lower === "download file" ||
    lower === "download" ||
    lower === "file" ||
    lower === "video" ||
    lower === "resource"
  ) {
    return true;
  }

  if (/\.pdf$/i.test(normalized)) return true;

  const machineLike = /^[a-z0-9._-]+$/i.test(normalized) &&
    (normalized.includes("_") || normalized.includes("-"));
  if (machineLike) return true;

  const filenameish = /^[a-z0-9._-]+$/i.test(normalized) && /\d/.test(normalized) && !normalized.includes(" ");
  if (filenameish) return true;

  return false;
}

export function isHighConfidenceExtractedTitle(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (normalized.length < 4) return false;
  if (isLowQualitySectionTitle(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (
    lower === "problem set" ||
    lower === "exam" ||
    lower === "assignment" ||
    lower === "resource"
  ) {
    return false;
  }

  const letterCount = normalized.replace(/[^a-z]/gi, "").length;
  return letterCount >= 4;
}

export function decideTitleNormalization(
  currentTitle: string,
  extractedTitle: string | null,
): TitleNormalizationDecision {
  const current = normalizeWhitespace(currentTitle);
  const extracted = extractedTitle ? normalizeWhitespace(extractedTitle) : "";

  if (!current) {
    if (!extracted || !isHighConfidenceExtractedTitle(extracted)) {
      return {
        shouldUpdate: false,
        reason: "missing_current_title_and_extracted_title_not_confident",
        nextTitle: null,
      };
    }

    return {
      shouldUpdate: true,
      reason: "fill_missing_section_title",
      nextTitle: extracted,
    };
  }

  if (!isLowQualitySectionTitle(current)) {
    return {
      shouldUpdate: false,
      reason: "existing_title_is_human_readable",
      nextTitle: null,
    };
  }

  if (!extracted || !isHighConfidenceExtractedTitle(extracted)) {
    return {
      shouldUpdate: false,
      reason: "extracted_title_not_confident",
      nextTitle: null,
    };
  }

  if (normalizeLabel(current) === normalizeLabel(extracted)) {
    return {
      shouldUpdate: false,
      reason: "title_already_normalized",
      nextTitle: null,
    };
  }

  return {
    shouldUpdate: true,
    reason: "replace_low_quality_title",
    nextTitle: extracted,
  };
}
