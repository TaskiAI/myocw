import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const QWEN_ENDPOINT_URL =
  process.env.QWEN_ENDPOINT_URL ?? "http://127.0.0.1:1234/v1/responses";
const QWEN_CHAT_COMPLETIONS_URL =
  process.env.QWEN_CHAT_COMPLETIONS_URL ??
  QWEN_ENDPOINT_URL.replace(/\/responses\/?$/, "/chat/completions");
const QWEN_MODEL = process.env.QWEN_MODEL ?? "qwen/qwen3.5-35b-a3b";
const QWEN_MAX_OUTPUT_TOKENS = parsePositiveIntEnv("QWEN_MAX_OUTPUT_TOKENS", 2500);
const QWEN_ALLOWED_CTX = parsePositiveIntEnv("QWEN_ALLOWED_CTX", 32768);
const QWEN_REQUEST_TIMEOUT_MS = parsePositiveIntEnv(
  "QWEN_REQUEST_TIMEOUT_MS",
  300_000,
);
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const QWEN_IMAGE_DPI = parsePositiveIntEnv("QWEN_IMAGE_DPI", 56);
const QWEN_IMAGE_QUALITY = parsePositiveIntEnv("QWEN_IMAGE_QUALITY", 80);
const QWEN_IMAGE_FORMAT = parseImageFormatEnv("QWEN_IMAGE_FORMAT", "jpeg");
const QWEN_RENDER_MAX_PAGES = parseNonNegativeIntEnv("QWEN_RENDER_MAX_PAGES", 24);
const QWEN_MAX_PAGES_PER_QUESTION_CALL = parsePositiveIntEnv(
  "QWEN_MAX_PAGES_PER_QUESTION_CALL",
  1,
);
const QWEN_MAX_PAGES_PER_VISION_CALL = parsePositiveIntEnv(
  "QWEN_MAX_PAGES_PER_VISION_CALL",
  1,
);
const QWEN_MAX_HINTS_PER_SOLUTION_CALL = parsePositiveIntEnv(
  "QWEN_MAX_HINTS_PER_SOLUTION_CALL",
  2,
);
const QWEN_SOLUTION_MAX_PAGES = parseNonNegativeIntEnv("QWEN_SOLUTION_MAX_PAGES", 0);
const QWEN_ENABLE_RAW_SOLUTION_FALLBACK =
  (process.env.QWEN_ENABLE_RAW_SOLUTION_FALLBACK ?? "0") === "1";
const PARSER_PROVIDER = (process.env.PARSER_PROVIDER ?? "openai_pdf").trim().toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT_URL = process.env.OPENAI_ENDPOINT_URL ?? "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = process.env.OPENAI_FILES_URL ?? "https://api.openai.com/v1/files";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.1-nano";
const OPENAI_MAX_OUTPUT_TOKENS = parsePositiveIntEnv("OPENAI_MAX_OUTPUT_TOKENS", 6000);
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT ?? "minimal";
const OPENAI_TEXT_VERBOSITY = process.env.OPENAI_TEXT_VERBOSITY ?? "low";

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const STORAGE_BUCKET = "mit-ocw";
const SUPABASE_PUBLIC_URL = SUPABASE_URL.replace(/\/$/, "");
const PDF_RENDERER_PROJECT = path.join(process.cwd(), "scripts", "pdf_renderer");
const PDF_RENDERER_SCRIPT = path.join(PDF_RENDERER_PROJECT, "render_pdf.py");

type ImageFormat = "jpeg" | "png";

actionIfMissingCriticalEnv();

function actionIfMissingCriticalEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Missing required Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY)",
    );
  }
  if (PARSER_PROVIDER === "openai_pdf" && !OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY for PARSER_PROVIDER=openai_pdf");
  }
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`Invalid ${name}=${raw}, using fallback=${fallback}`);
    return fallback;
  }
  return value;
}

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    console.warn(`Invalid ${name}=${raw}, using fallback=${fallback}`);
    return fallback;
  }
  return value;
}

function parseImageFormatEnv(name: string, fallback: ImageFormat): ImageFormat {
  const raw = (process.env[name] ?? fallback).toLowerCase().trim();
  if (raw === "jpeg" || raw === "jpg") return "jpeg";
  if (raw === "png") return "png";
  console.warn(`Invalid ${name}=${raw}, using fallback=${fallback}`);
  return fallback;
}

interface ExtractedProblem {
  problem_label: string;
  question_text: string;
  solution_text: string | null;
  ordering: number;
}

interface QuestionExtractionPayload {
  content_title: string | null;
  problems: ExtractedProblem[];
}

interface SolutionExtractionEntry {
  problem_label: string;
  ordering_hint: number | null;
  solution_text: string | null;
}

interface SolutionReconciliationUpdate {
  problem_label: string;
  solution_text: string | null;
}

interface TitleNormalizationDecision {
  shouldUpdate: boolean;
  reason: string;
  nextTitle: string | null;
}

interface ResourceRow {
  id: number;
  course_id: number;
  section_id: number | null;
  title: string;
  resource_type: string;
  pdf_path: string | null;
  ordering: number;
}

interface SectionRow {
  id: number;
  title: string;
}

interface QwenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface QwenResponseItem {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface QwenResponse {
  output?: QwenResponseItem[];
  usage?: QwenUsage;
}

interface QwenChatChoice {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

interface QwenChatResponse {
  choices?: QwenChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface QwenCallResult {
  outputText: string;
  usage: QwenUsage | null;
}

interface RenderManifestPage {
  page_index: number;
  image_path: string;
  mime: string;
  width: number;
  height: number;
}

interface RenderManifest {
  page_count: number;
  rendered_count: number;
  truncated: boolean;
  pages: RenderManifestPage[];
}

interface RenderedPageImage {
  page_index: number;
  image_path: string;
  mime: string;
  width: number;
  height: number;
  data_url: string;
  bytes: number;
}

interface RenderedPdf {
  tempDir: string;
  sourcePageCount: number;
  renderedCount: number;
  truncated: boolean;
  totalImageBytes: number;
  pages: RenderedPageImage[];
}

interface ExtractionMetrics {
  questionPages: number;
  solutionPages: number;
  questionImageBytes: number;
  solutionImageBytes: number;
  pairedSolutions: number;
}

interface ExtractionOutcome {
  problems: ExtractedProblem[];
  contentTitle: string | null;
  metrics: ExtractionMetrics;
}

type QwenInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_id: string };

interface OpenAiJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

interface OpenAiResponseOptions {
  jsonSchema?: OpenAiJsonSchema;
}

const QUESTION_EXTRACTION_RESPONSE_SCHEMA: OpenAiJsonSchema = {
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

const SOLUTION_EXTRACTION_RESPONSE_SCHEMA: OpenAiJsonSchema = {
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

const SOLUTION_RECONCILIATION_RESPONSE_SCHEMA: OpenAiJsonSchema = {
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

export interface ParseProblemsOptions {
  forceReparse?: boolean;
}

export interface ParseProblemsResult {
  insertedProblems: number;
  processedResources: number;
  skippedResources: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripFences(raw: string): string {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  if (cleaned.toLowerCase().startsWith("json")) {
    return cleaned.slice(4).trim();
  }
  return cleaned.trim();
}

function extractBalancedJsonSlice(
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

function parseJsonLike(rawText: string): unknown | null {
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

function normalizeLabel(label: string): string {
  return normalizeWhitespace(label).toLowerCase();
}

function isSchemaPlaceholderText(value: string): boolean {
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

function looksLikeModelReasoning(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("the user wants me") ||
    normalized.includes("analyze the input") ||
    normalized.includes("map to question_index") ||
    normalized.includes("construct the json")
  );
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function resolveStorageUrl(pdfPath: string): string {
  if (pdfPath.startsWith("http")) return pdfPath;
  const cleaned = pdfPath.replace(/^\//, "");
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

function extractOutputText(payload: QwenResponse): string {
  const text = (payload.output ?? [])
    .filter((entry) => entry.type === "message")
    .flatMap((entry) => entry.content ?? [])
    .filter((chunk) => chunk.type === "output_text")
    .map((chunk) => chunk.text ?? "")
    .join("");

  return text.trim();
}

function logUsage(prefix: string, usage: QwenUsage | null): void {
  if (!usage) return;
  console.log(
    `${prefix} usage input=${usage.input_tokens ?? "?"} output=${usage.output_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
  );
}

function extractReasoningText(payload: QwenResponse): string {
  const text = (payload.output ?? [])
    .filter((entry) => entry.type === "reasoning")
    .flatMap((entry) => entry.content ?? [])
    .filter((chunk) => chunk.type === "reasoning_text")
    .map((chunk) => chunk.text ?? "")
    .join("");

  return text.trim();
}

function normalizeChatUsage(
  usage: QwenChatResponse["usage"] | undefined,
): QwenUsage | null {
  if (!usage) return null;
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

async function sendQwenRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QWEN_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function toChatContent(input: QwenInputContent[]): Array<Record<string, unknown>> {
  return input.map((item) => {
    if (item.type === "input_text") {
      return { type: "text", text: item.text };
    }
    if (item.type === "input_file") {
      return {
        type: "text",
        text: "[input_file omitted in chat/completions fallback]",
      };
    }
    return {
      type: "image_url",
      image_url: { url: item.image_url },
    };
  });
}

function extractChatOutputText(payload: QwenChatResponse): string {
  const first = payload.choices?.[0]?.message?.content;
  if (typeof first === "string") return first.trim();
  if (Array.isArray(first)) {
    return first
      .map((chunk) => (typeof chunk.text === "string" ? chunk.text : ""))
      .join("")
      .trim();
  }
  return "";
}

async function callQwenChatCompletions(
  input: string | QwenInputContent[],
  headers: Record<string, string>,
): Promise<QwenCallResult> {
  const body: Record<string, unknown> = {
    model: QWEN_MODEL,
    temperature: 0,
    max_tokens: QWEN_MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: "user",
        content:
          typeof input === "string"
            ? input
            : toChatContent(input),
      },
    ],
  };

  const response = await sendQwenRequest(QWEN_CHAT_COMPLETIONS_URL, body, headers);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen chat fallback error (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as QwenChatResponse;
  const outputText = extractChatOutputText(payload);
  if (!outputText) {
    throw new Error("Qwen chat fallback returned no assistant text output");
  }

  return {
    outputText,
    usage: normalizeChatUsage(payload.usage),
  };
}

async function callQwenResponses(
  input: string | QwenInputContent[],
): Promise<QwenCallResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (QWEN_API_KEY) {
    headers.Authorization = `Bearer ${QWEN_API_KEY}`;
  }

  const body: Record<string, unknown> = {
    model: QWEN_MODEL,
    temperature: 0,
    max_output_tokens: QWEN_MAX_OUTPUT_TOKENS,
    input:
      typeof input === "string"
        ? input
        : [
            {
              type: "message",
              role: "user",
              content: input,
            },
          ],
  };

  const response = await sendQwenRequest(QWEN_ENDPOINT_URL, body, headers);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen endpoint error (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as QwenResponse;
  const outputText = extractOutputText(payload);
  if (outputText) {
    if (
      Array.isArray(input) &&
      (payload.usage?.output_tokens ?? 0) >= QWEN_MAX_OUTPUT_TOKENS - 2
    ) {
      console.log(
        "  Responses output hit max token budget; retrying via chat/completions fallback...",
      );
      return await callQwenChatCompletions(input, headers);
    }

    return {
      outputText,
      usage: payload.usage ?? null,
    };
  }

  const reasoningText = extractReasoningText(payload);
  if (
    reasoningText &&
    (/^\s*[\[{]/.test(reasoningText) ||
      reasoningText.includes("```json") ||
      reasoningText.includes("\"problem_label\""))
  ) {
    return {
      outputText: reasoningText,
      usage: payload.usage ?? null,
    };
  }

  console.log(
    "  Responses API returned no assistant output_text; trying chat/completions fallback...",
  );
  return await callQwenChatCompletions(input, headers);
}

async function uploadPdfToOpenAI(pdfBuffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  const bytes = new Uint8Array(pdfBuffer);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QWEN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_FILES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI file upload failed (${response.status}): ${text}`);
    }
    const payload = (await response.json()) as { id?: string };
    if (!payload.id) {
      throw new Error("OpenAI file upload returned no file id");
    }
    return payload.id;
  } finally {
    clearTimeout(timeout);
  }
}

function getOpenAiModelFallback(primaryModel: string): string | null {
  const normalized = primaryModel.trim();
  if (normalized === "gpt-5.1-nano") return "gpt-5-nano";
  return null;
}

function isOpenAiModelNotFound(status: number, responseText: string): boolean {
  if (status !== 400) return false;
  if (responseText.includes("\"model_not_found\"")) return true;
  return /requested model .* does not exist/i.test(responseText);
}

async function callOpenAiResponses(
  input: string | QwenInputContent[],
  options: OpenAiResponseOptions = {},
): Promise<QwenCallResult> {
  const modelCandidates = [OPENAI_MODEL];
  const fallbackModel = getOpenAiModelFallback(OPENAI_MODEL);
  if (fallbackModel && fallbackModel !== OPENAI_MODEL) {
    modelCandidates.push(fallbackModel);
  }

  let lastError: Error | null = null;

  for (let i = 0; i < modelCandidates.length; i++) {
    const model = modelCandidates[i];
    const textConfig: Record<string, unknown> = {
      verbosity: OPENAI_TEXT_VERBOSITY,
    };
    if (options.jsonSchema) {
      textConfig.format = {
        type: "json_schema",
        name: options.jsonSchema.name,
        schema: options.jsonSchema.schema,
        strict: true,
      };
    }

    const body: Record<string, unknown> = {
      model,
      max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      text: textConfig,
      input:
        typeof input === "string"
          ? input
          : [
              {
                type: "message",
                role: "user",
                content: input,
              },
            ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QWEN_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OPENAI_ENDPOINT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        if (
          i < modelCandidates.length - 1 &&
          isOpenAiModelNotFound(response.status, text)
        ) {
          console.warn(
            `  OpenAI model '${model}' unavailable; retrying with '${modelCandidates[i + 1]}'`,
          );
          continue;
        }
        throw new Error(`OpenAI responses error (${response.status}): ${text}`);
      }
      const payload = (await response.json()) as QwenResponse;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        throw new Error("OpenAI responses returned no assistant output_text");
      }
      return {
        outputText,
        usage: payload.usage ?? null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i >= modelCandidates.length - 1) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("OpenAI responses call failed");
}

async function callOpenAiResponsesWithPdf(
  prompt: string,
  fileId: string,
  options: OpenAiResponseOptions = {},
): Promise<QwenCallResult> {
  return await callOpenAiResponses([
    { type: "input_text", text: prompt },
    { type: "input_file", file_id: fileId },
  ], options);
}

async function callRepairModel(
  prompt: string,
  options: OpenAiResponseOptions = {},
): Promise<QwenCallResult> {
  if (PARSER_PROVIDER !== "openai_pdf") {
    return await callQwenResponses(prompt);
  }
  return await callOpenAiResponses(prompt, options);
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

function parseProblemArray(raw: unknown): ExtractedProblem[] | null {
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

function parseQuestionExtractionPayload(
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

function parseSolutionExtractionEntries(
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

function parseSolutionReconciliationUpdates(
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

function reindexProblems(problems: ExtractedProblem[]): ExtractedProblem[] {
  const sorted = [...problems].sort((a, b) => a.ordering - b.ordering);
  return sorted.map((problem, index) => ({
    problem_label: problem.problem_label,
    question_text: problem.question_text,
    solution_text: problem.solution_text,
    ordering: index,
  }));
}

function extractSplitPrefix(label: string): string | null {
  const compact = normalizeLabel(label).replace(/\s+/g, "").replace(/[().]/g, "");
  const match = compact.match(/^(\d+)[a-z]$/i);
  return match ? match[1] : null;
}

function isPureNumericLabel(label: string, prefix: string): boolean {
  const compact = normalizeLabel(label).replace(/\s+/g, "").replace(/[().]/g, "");
  return compact === prefix;
}

function containsSplitSubparts(problems: ExtractedProblem[]): boolean {
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

async function parseWithRepair<T>(
  rawOutput: string,
  parser: (text: string) => T | null,
  schemaHint: string,
  contextLabel: string,
  repairOptions: OpenAiResponseOptions = {},
): Promise<T> {
  const firstAttempt = parser(rawOutput);
  if (firstAttempt !== null) {
    return firstAttempt;
  }

  console.log(`  ${contextLabel}: invalid JSON, requesting one repair pass...`);
  const repairPrompt = `Fix this into valid JSON only.

Required schema:
${schemaHint}

Rules:
- Output ONLY valid JSON.
- No markdown fences.
- Do not add commentary.

Broken JSON / model output:
${rawOutput}`;

  const repairedCall = await callRepairModel(repairPrompt, repairOptions);
  logUsage("  JSON repair", repairedCall.usage);

  const repaired = parser(repairedCall.outputText);
  if (repaired !== null) {
    return repaired;
  }

  throw new Error(`${contextLabel}: model output was not valid JSON after repair`);
}

function buildVisionContent(
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

function buildQuestionExtractionPrompt(pageCount: number): string {
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

function buildSubpartConsolidationPrompt(payload: QuestionExtractionPayload): string {
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

function toQuestionHint(problem: ExtractedProblem): {
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

function buildSolutionExtractionPrompt(
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

function buildSolutionReconciliationPrompt(
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

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
  });
}

async function cleanupRenderedPdf(rendered: RenderedPdf | null): Promise<void> {
  if (!rendered) return;
  await rm(rendered.tempDir, { recursive: true, force: true });
}

async function renderPdfToImages(
  pdfBuffer: Buffer,
  filenameHint: string,
): Promise<RenderedPdf> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "myocw-render-"));
  const pdfPath = path.join(tempDir, `${sanitizeFilename(filenameHint) || "input"}.pdf`);
  const outputDir = path.join(tempDir, "images");

  await writeFile(pdfPath, pdfBuffer);

  const args = [
    "run",
    "--project",
    PDF_RENDERER_PROJECT,
    "python",
    PDF_RENDERER_SCRIPT,
    "--input-pdf",
    pdfPath,
    "--output-dir",
    outputDir,
    "--dpi",
    String(QWEN_IMAGE_DPI),
    "--format",
    QWEN_IMAGE_FORMAT,
    "--quality",
    String(QWEN_IMAGE_QUALITY),
  ];

  if (QWEN_RENDER_MAX_PAGES > 0) {
    args.push("--max-pages", String(QWEN_RENDER_MAX_PAGES));
  }

  const result = await runCommand("uv", args);
  if (result.exitCode !== 0) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(
      `PDF rendering failed (exit=${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`,
    );
  }

  let manifest: RenderManifest;
  try {
    manifest = JSON.parse(result.stdout.trim()) as RenderManifest;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(
      `PDF renderer returned invalid JSON manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(manifest.pages)) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error("PDF renderer manifest missing pages array");
  }

  const pages: RenderedPageImage[] = [];
  let totalImageBytes = 0;

  for (const page of manifest.pages) {
    const imagePath = path.isAbsolute(page.image_path)
      ? page.image_path
      : path.resolve(outputDir, page.image_path);

    const imageBytes = await readFile(imagePath);
    totalImageBytes += imageBytes.length;

    const mime = page.mime || (QWEN_IMAGE_FORMAT === "png" ? "image/png" : "image/jpeg");

    pages.push({
      page_index: page.page_index,
      image_path: imagePath,
      mime,
      width: page.width,
      height: page.height,
      data_url: `data:${mime};base64,${imageBytes.toString("base64")}`,
      bytes: imageBytes.length,
    });
  }

  return {
    tempDir,
    sourcePageCount:
      typeof manifest.page_count === "number" ? Math.max(0, Math.trunc(manifest.page_count)) : pages.length,
    renderedCount:
      typeof manifest.rendered_count === "number"
        ? Math.max(0, Math.trunc(manifest.rendered_count))
        : pages.length,
    truncated: Boolean(manifest.truncated),
    totalImageBytes,
    pages,
  };
}

async function extractQuestionsFromImages(
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

function cleanupSolutionText(text: string): string {
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

function chooseLongestEntryIndex(
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

function deterministicMergeSolutions(
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

async function extractProblemsFromPdfs(
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

function pickSolutionResource(
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

function isLowQualitySectionTitle(value: string): boolean {
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

function isHighConfidenceExtractedTitle(value: string): boolean {
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

function decideTitleNormalization(
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
