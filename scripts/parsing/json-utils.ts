import type {
  ExtractedProblem,
  QuestionExtractionPayload,
  SolutionExtractionEntry,
  SolutionReconciliationUpdate,
} from "./types.js";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripFences(raw: string): string {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  if (cleaned.toLowerCase().startsWith("json")) {
    return cleaned.slice(4).trim();
  }
  return cleaned.trim();
}

export function extractBalancedJsonSlice(
  text: string,
  opener: "{" | "[",
  closer: "}" | "]",
): string | null {
  const start = text.indexOf(opener);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === opener) {
      depth += 1;
      continue;
    }

    if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseJsonLike(rawText: string): unknown | null {
  const cleaned = stripFences(rawText);
  if (!cleaned) return null;

  const candidates: string[] = [cleaned];
  const objectSlice = extractBalancedJsonSlice(cleaned, "{", "}");
  if (objectSlice && objectSlice !== cleaned) candidates.push(objectSlice);
  const arraySlice = extractBalancedJsonSlice(cleaned, "[", "]");
  if (arraySlice && arraySlice !== cleaned) candidates.push(arraySlice);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function normalizeLabel(label: string): string {
  return normalizeWhitespace(label).toLowerCase();
}

export function isSchemaPlaceholderText(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return (
    normalized === "string" ||
    normalized === "string|null" ||
    normalized === "null" ||
    normalized === "number" ||
    normalized === "boolean" ||
    normalized === "array" ||
    normalized === "object"
  );
}

export function looksLikeModelReasoning(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("the user wants me") ||
    normalized.includes("analyze the input") ||
    normalized.includes("map to question_index") ||
    normalized.includes("construct the json")
  );
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function sanitizeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function parseOrdering(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.trunc(raw));
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return fallback;
}

export function parseProblemArray(raw: unknown): ExtractedProblem[] | null {
  if (!Array.isArray(raw)) return null;

  const problems: ExtractedProblem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const label =
      typeof record.problem_label === "string" ? normalizeWhitespace(record.problem_label) : "";
    const question =
      typeof record.question_text === "string" ? record.question_text.trim() : "";

    if (!label || !question) continue;
    if (isSchemaPlaceholderText(label) || isSchemaPlaceholderText(question)) continue;
    if (looksLikeModelReasoning(question)) continue;

    problems.push({
      problem_label: label,
      question_text: question,
      solution_text: null,
      ordering: parseOrdering(record.ordering, i),
    });
  }

  return problems;
}

export function parseQuestionExtractionPayload(
  rawText: string,
): QuestionExtractionPayload | null {
  const parsed = parseJsonLike(rawText);
  if (parsed === null) return null;

  if (Array.isArray(parsed)) {
    const problems = parseProblemArray(parsed);
    if (problems === null) return null;
    return { content_title: null, problems };
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  const contentTitleRaw = record.content_title;
  const contentTitle = (() => {
    if (typeof contentTitleRaw !== "string") return null;
    const normalized = normalizeWhitespace(contentTitleRaw);
    if (!normalized || isSchemaPlaceholderText(normalized)) return null;
    return normalized;
  })();

  const problems = parseProblemArray(record.problems);
  if (problems === null) return null;

  return {
    content_title: contentTitle,
    problems,
  };
}

export function parseSolutionExtractionEntries(
  rawText: string,
): SolutionExtractionEntry[] | null {
  const parsed = parseJsonLike(rawText);
  if (parsed === null) return null;

  const payload =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).solutions
        : null;

  if (!Array.isArray(payload)) return null;

  const entries: SolutionExtractionEntry[] = [];
  for (let i = 0; i < payload.length; i++) {
    const item = payload[i];
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const label =
      typeof record.problem_label === "string" ? normalizeWhitespace(record.problem_label) : "";
    if (!label) continue;
    if (isSchemaPlaceholderText(label)) continue;

    const solutionRaw = record.solution_text;
    const solution =
      typeof solutionRaw === "string" ? solutionRaw.trim() || null : null;
    if (solution && (isSchemaPlaceholderText(solution) || looksLikeModelReasoning(solution))) {
      continue;
    }

    const orderingHintRaw =
      record.ordering_hint !== undefined ? record.ordering_hint : record.ordering;

    let orderingHint: number | null = null;
    if (typeof orderingHintRaw === "number" && Number.isFinite(orderingHintRaw)) {
      orderingHint = Math.max(0, Math.trunc(orderingHintRaw));
    } else if (typeof orderingHintRaw === "string" && orderingHintRaw.trim()) {
      const parsedHint = Number.parseInt(orderingHintRaw, 10);
      if (Number.isFinite(parsedHint)) orderingHint = Math.max(0, parsedHint);
    }

    entries.push({
      problem_label: label,
      ordering_hint: orderingHint,
      solution_text: solution,
    });
  }

  return entries;
}

export function parseSolutionReconciliationUpdates(
  rawText: string,
): SolutionReconciliationUpdate[] | null {
  const parsed = parseJsonLike(rawText);
  if (parsed === null) return null;

  const payload =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).updates
        : null;

  if (!Array.isArray(payload)) return null;

  const updates: SolutionReconciliationUpdate[] = [];
  for (let i = 0; i < payload.length; i++) {
    const item = payload[i];
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const label =
      typeof record.problem_label === "string" ? normalizeWhitespace(record.problem_label) : "";
    if (!label) continue;

    const solutionRaw = record.solution_text;
    const solution =
      typeof solutionRaw === "string" ? solutionRaw.trim() || null : null;

    updates.push({ problem_label: label, solution_text: solution });
  }

  return updates;
}

export function reindexProblems(problems: ExtractedProblem[]): ExtractedProblem[] {
  const sorted = [...problems].sort((a, b) => a.ordering - b.ordering);
  return sorted.map((problem, index) => ({
    problem_label: problem.problem_label,
    question_text: problem.question_text,
    solution_text: problem.solution_text,
    ordering: index,
  }));
}

export function extractSplitPrefix(label: string): string | null {
  const compact = normalizeLabel(label).replace(/\s+/g, "").replace(/[().]/g, "");
  const match = compact.match(/^(\d+)[a-z]$/i);
  return match ? match[1] : null;
}

export function isPureNumericLabel(label: string, prefix: string): boolean {
  const compact = normalizeLabel(label).replace(/\s+/g, "").replace(/[().]/g, "");
  return compact === prefix;
}

export function containsSplitSubparts(problems: ExtractedProblem[]): boolean {
  const prefixCounts = new Map<string, number>();

  for (const problem of problems) {
    const prefix = extractSplitPrefix(problem.problem_label);
    if (!prefix) continue;
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  for (const [prefix, count] of prefixCounts.entries()) {
    if (count < 2) continue;
    const hasParentLabel = problems.some((problem) =>
      isPureNumericLabel(problem.problem_label, prefix),
    );
    if (!hasParentLabel) return true;
  }

  return false;
}
