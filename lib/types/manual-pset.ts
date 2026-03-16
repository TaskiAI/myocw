export interface ManualPsetProblem {
  id: string;
  label: string;
  questionText: string;
  solutionText: string;
}

export interface UserPsetDraft {
  id: number;
  user_id: string;
  title: string;
  source_pdf_label: string | null;
  source_pdf_url: string | null;
  notes: string | null;
  problems: ManualPsetProblem[];
  created_at: string;
  updated_at: string;
}

export interface UserPsetDraftInput {
  title: string;
  source_pdf_label: string | null;
  source_pdf_url: string | null;
  notes: string | null;
  problems: ManualPsetProblem[];
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalText(value: unknown): string | null {
  const text = asText(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeManualPsetProblem(
  raw: unknown,
  index: number
): ManualPsetProblem {
  const record = asRecord(raw);
  const fallbackLabel = `Problem ${index + 1}`;

  return {
    id: asOptionalText(record?.id) ?? `problem-${index + 1}`,
    label: asOptionalText(record?.label) ?? fallbackLabel,
    questionText: asText(record?.questionText),
    solutionText: asText(record?.solutionText),
  };
}

export function normalizeManualPsetProblems(raw: unknown): ManualPsetProblem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((problem, index) => normalizeManualPsetProblem(problem, index));
}

export function normalizeUserPsetDraft(raw: unknown): UserPsetDraft | null {
  const record = asRecord(raw);
  const id = asNumber(record?.id);
  const userId = asOptionalText(record?.user_id);

  if (id === null || !userId) return null;

  const problems = normalizeManualPsetProblems(record?.problems);

  return {
    id,
    user_id: userId,
    title: asOptionalText(record?.title) ?? "Untitled problem set",
    source_pdf_label: asOptionalText(record?.source_pdf_label),
    source_pdf_url: asOptionalText(record?.source_pdf_url),
    notes: asOptionalText(record?.notes),
    problems:
      problems.length > 0
        ? problems
        : [
            {
              id: "problem-1",
              label: "Problem 1",
              questionText: "",
              solutionText: "",
            },
          ],
    created_at: asText(record?.created_at),
    updated_at: asText(record?.updated_at),
  };
}

export function prepareUserPsetDraftInput(
  input: UserPsetDraftInput
): UserPsetDraftInput {
  const normalizedProblems = input.problems.map((problem, index) => ({
    id: problem.id.trim() || `problem-${index + 1}`,
    label: problem.label.trim() || `Problem ${index + 1}`,
    questionText: problem.questionText,
    solutionText: problem.solutionText,
  }));

  return {
    title: input.title.trim() || "Untitled problem set",
    source_pdf_label: input.source_pdf_label?.trim() || null,
    source_pdf_url: input.source_pdf_url?.trim() || null,
    notes: input.notes?.trim() || null,
    problems:
      normalizedProblems.length > 0
        ? normalizedProblems
        : [
            {
              id: "problem-1",
              label: "Problem 1",
              questionText: "",
              solutionText: "",
            },
          ],
  };
}
