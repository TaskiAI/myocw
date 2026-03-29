import type {
  ExtractedProblem,
  OpenAiJsonSchema,
  QwenInputContent,
  RenderedPageImage,
} from "./types.js";

export const QUESTION_EXTRACTION_RESPONSE_SCHEMA: OpenAiJsonSchema = {
  name: "question_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["content_title", "problems"],
    properties: {
      content_title: {
        type: ["string", "null"],
      },
      problems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["problem_label", "question_text", "ordering"],
          properties: {
            problem_label: { type: "string" },
            question_text: { type: "string" },
            ordering: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  },
};

export const SOLUTION_EXTRACTION_RESPONSE_SCHEMA: OpenAiJsonSchema = {
  name: "solution_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["solutions"],
    properties: {
      solutions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["problem_label", "ordering_hint", "solution_text"],
          properties: {
            problem_label: { type: "string" },
            ordering_hint: {
              anyOf: [
                { type: "integer", minimum: 0 },
                { type: "null" },
              ],
            },
            solution_text: {
              type: ["string", "null"],
            },
          },
        },
      },
    },
  },
};

export const SOLUTION_RECONCILIATION_RESPONSE_SCHEMA: OpenAiJsonSchema = {
  name: "solution_reconciliation",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["updates"],
    properties: {
      updates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["problem_label", "solution_text"],
          properties: {
            problem_label: { type: "string" },
            solution_text: {
              type: ["string", "null"],
            },
          },
        },
      },
    },
  },
};

export function buildQuestionExtractionPrompt(pageCount: number): string {
  return `Parse the attached QUESTION pages into structured, interactive problems.

The input contains ${pageCount} page image(s).

Return ONLY a JSON object with this exact structure:
{
  "content_title": "string|null",
  "problems": [
    {
      "problem_label": "string",
      "question_text": "string",
      "ordering": 0
    }
  ]
}

Rules:
- Group subparts under the parent problem. Example: 1(a), 1(b), 1(c) must be one problem object with one problem_label (e.g. "1").
- Return one array item per top-level problem; the problems array can be any non-negative length.
- Convert math expressions to LaTeX. Use $...$ for inline math and $$...$$ for display math.
- Do not use \\(...\\) or \\[...\\] delimiters.
- Because this is JSON, every LaTeX backslash must be escaped as \\\\ (example: \\\\frac{a}{b}).
- Exclude cover/instruction pages that are not actual problems.
- ordering must start at 0 and increase in document order.
- If there are no problems, return {"content_title":null,"problems":[]}.
- No markdown fences. No commentary.`;
}

export function buildSubpartConsolidationPrompt(payload: {
  content_title: string | null;
  problems: ExtractedProblem[];
}): string {
  return `Consolidate split subparts into top-level problems.

Input JSON:
${JSON.stringify(payload, null, 2)}

Output JSON ONLY with exact schema:
{
  "content_title": "string|null",
  "problems": [
    {
      "problem_label": "string",
      "question_text": "string",
      "ordering": 0
    }
  ]
}

Rules:
- Merge 1(a), 1(b), 1(c) style entries into one problem labeled "1".
- Keep all original text, preserving order.
- Keep LaTeX delimiters as $...$ or $$...$$ only (no \\(...\\), no \\[...\\]).
- Escape every LaTeX backslash as \\\\ so the JSON remains valid.
- ordering must be reindexed from 0.
- No markdown fences. No commentary.`;
}

export function toQuestionHint(problem: ExtractedProblem): {
  ordering: number;
  problem_label: string;
  question_hint: string;
} {
  const compact = problem.question_text.replace(/\s+/g, " ").trim();
  return {
    ordering: problem.ordering,
    problem_label: problem.problem_label,
    question_hint: compact.slice(0, 220),
  };
}

export function buildSolutionExtractionPrompt(
  hints: Array<{ ordering: number; problem_label: string; question_hint: string }>,
  chunkIndex: number,
  totalChunks: number,
): string {
  return `Parse the attached SOLUTION pages into solution entries.

QUESTION_INDEX for reference:
${JSON.stringify(hints, null, 2)}

You are processing solution page chunk ${chunkIndex} of ${totalChunks}.

Return ONLY a JSON object:
{
  "solutions": [
    {
      "problem_label": "string",
      "ordering_hint": 0,
      "solution_text": "string|null"
    }
  ]
}

Rules:
- Keep top-level grouping: combine subparts of the same parent problem into one entry.
- Only return entries whose problem_label is from QUESTION_INDEX.
- Include only solutions visible in this page chunk.
- Return at most ${hints.length} entr${hints.length === 1 ? "y" : "ies"}.
- Do NOT emit placeholder rows with null unless truly needed for ambiguity.
- ordering_hint should be the best guessed 0-based order relative to questions; use null if uncertain.
- Convert math expressions to LaTeX. Use $...$ for inline math and $$...$$ for display math.
- Do not use \\(...\\) or \\[...\\] delimiters.
- Because this is JSON, every LaTeX backslash must be escaped as \\\\ (example: \\\\int_0^1 x^2 dx).
- Keep solution_text concise (prefer <= 1200 characters).
- Include only actual problem solutions; skip front matter.
- If nothing is found, return {"solutions":[]}.
- No markdown fences. No commentary.`;
}

export function buildSolutionReconciliationPrompt(
  unmatchedQuestions: Array<{
    ordering: number;
    problem_label: string;
    question_hint: string;
  }>,
  unresolvedSolutions: Array<{
    problem_label: string;
    ordering_hint: number | null;
    solution_hint: string;
  }>,
): string {
  return `Map unresolved solution snippets to unresolved questions.

UNMATCHED_QUESTIONS:
${JSON.stringify(unmatchedQuestions, null, 2)}

UNRESOLVED_SOLUTIONS:
${JSON.stringify(unresolvedSolutions, null, 2)}

Return ONLY a JSON object:
{
  "updates": [
    {
      "problem_label": "string",
      "solution_text": "string|null"
    }
  ]
}

Rules:
- problem_label must come from UNMATCHED_QUESTIONS.
- Use null when no confident match exists.
- Do not include labels outside UNMATCHED_QUESTIONS.
- Preserve LaTeX delimiters as $...$ or $$...$$ only (no \\(...\\), no \\[...\\]).
- Escape every LaTeX backslash as \\\\ so the JSON remains valid.
- No markdown fences. No commentary.`;
}

export function buildVisionContent(
  prompt: string,
  pages: RenderedPageImage[],
  pageTag: "QUESTION" | "SOLUTION",
): QwenInputContent[] {
  const content: QwenInputContent[] = [{ type: "input_text", text: prompt }];

  for (const page of pages) {
    content.push({
      type: "input_text",
      text: `[${pageTag} PAGE ${page.page_index + 1}]`,
    });
    content.push({
      type: "input_image",
      image_url: page.data_url,
    });
  }

  return content;
}
