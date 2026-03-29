export type ImageFormat = "jpeg" | "png";

export interface ExtractedProblem {
  problem_label: string;
  question_text: string;
  solution_text: string | null;
  ordering: number;
}

export interface QuestionExtractionPayload {
  content_title: string | null;
  problems: ExtractedProblem[];
}

export interface SolutionExtractionEntry {
  problem_label: string;
  ordering_hint: number | null;
  solution_text: string | null;
}

export interface SolutionReconciliationUpdate {
  problem_label: string;
  solution_text: string | null;
}

export interface TitleNormalizationDecision {
  shouldUpdate: boolean;
  reason: string;
  nextTitle: string | null;
}

export interface ResourceRow {
  id: number;
  course_id: number;
  section_id: number | null;
  title: string;
  resource_type: string;
  pdf_path: string | null;
  ordering: number;
}

export interface SectionRow {
  id: number;
  title: string;
}

export interface QwenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface QwenResponseItem {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export interface QwenResponse {
  output?: QwenResponseItem[];
  usage?: QwenUsage;
}

export interface QwenChatChoice {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

export interface QwenChatResponse {
  choices?: QwenChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface QwenCallResult {
  outputText: string;
  usage: QwenUsage | null;
}

export interface RenderManifestPage {
  page_index: number;
  image_path: string;
  mime: string;
  width: number;
  height: number;
}

export interface RenderManifest {
  page_count: number;
  rendered_count: number;
  truncated: boolean;
  pages: RenderManifestPage[];
}

export interface RenderedPageImage {
  page_index: number;
  image_path: string;
  mime: string;
  width: number;
  height: number;
  data_url: string;
  bytes: number;
}

export interface RenderedPdf {
  tempDir: string;
  sourcePageCount: number;
  renderedCount: number;
  truncated: boolean;
  totalImageBytes: number;
  pages: RenderedPageImage[];
}

export interface ExtractionMetrics {
  questionPages: number;
  solutionPages: number;
  questionImageBytes: number;
  solutionImageBytes: number;
  pairedSolutions: number;
}

export interface ExtractionOutcome {
  problems: ExtractedProblem[];
  contentTitle: string | null;
  metrics: ExtractionMetrics;
}

export type QwenInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_id: string };

export interface OpenAiJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface OpenAiResponseOptions {
  jsonSchema?: OpenAiJsonSchema;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ParseProblemsOptions {
  forceReparse?: boolean;
}

export interface ParseProblemsResult {
  insertedProblems: number;
  processedResources: number;
  skippedResources: number;
}
