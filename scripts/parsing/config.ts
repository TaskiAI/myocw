import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import type { ImageFormat } from "./types.js";

export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`Invalid ${name}=${raw}, using fallback=${fallback}`);
    return fallback;
  }
  return value;
}

export function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    console.warn(`Invalid ${name}=${raw}, using fallback=${fallback}`);
    return fallback;
  }
  return value;
}

export function parseImageFormatEnv(name: string, fallback: ImageFormat): ImageFormat {
  const raw = (process.env[name] ?? fallback).toLowerCase().trim();
  if (raw === "jpeg" || raw === "jpg") return "jpeg";
  if (raw === "png") return "png";
  console.warn(`Invalid ${name}=${raw}, using fallback=${fallback}`);
  return fallback;
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
export const QWEN_ENDPOINT_URL =
  process.env.QWEN_ENDPOINT_URL ?? "http://127.0.0.1:1234/v1/responses";
export const QWEN_CHAT_COMPLETIONS_URL =
  process.env.QWEN_CHAT_COMPLETIONS_URL ??
  QWEN_ENDPOINT_URL.replace(/\/responses\/?$/, "/chat/completions");
export const QWEN_MODEL = process.env.QWEN_MODEL ?? "qwen/qwen3.5-35b-a3b";
export const QWEN_MAX_OUTPUT_TOKENS = parsePositiveIntEnv("QWEN_MAX_OUTPUT_TOKENS", 2500);
export const QWEN_ALLOWED_CTX = parsePositiveIntEnv("QWEN_ALLOWED_CTX", 32768);
export const QWEN_REQUEST_TIMEOUT_MS = parsePositiveIntEnv(
  "QWEN_REQUEST_TIMEOUT_MS",
  300_000,
);
export const QWEN_API_KEY = process.env.QWEN_API_KEY;
export const QWEN_IMAGE_DPI = parsePositiveIntEnv("QWEN_IMAGE_DPI", 56);
export const QWEN_IMAGE_QUALITY = parsePositiveIntEnv("QWEN_IMAGE_QUALITY", 80);
export const QWEN_IMAGE_FORMAT = parseImageFormatEnv("QWEN_IMAGE_FORMAT", "jpeg");
export const QWEN_RENDER_MAX_PAGES = parseNonNegativeIntEnv("QWEN_RENDER_MAX_PAGES", 24);
export const QWEN_MAX_PAGES_PER_QUESTION_CALL = parsePositiveIntEnv(
  "QWEN_MAX_PAGES_PER_QUESTION_CALL",
  1,
);
export const QWEN_MAX_PAGES_PER_VISION_CALL = parsePositiveIntEnv(
  "QWEN_MAX_PAGES_PER_VISION_CALL",
  1,
);
export const QWEN_MAX_HINTS_PER_SOLUTION_CALL = parsePositiveIntEnv(
  "QWEN_MAX_HINTS_PER_SOLUTION_CALL",
  2,
);
export const QWEN_SOLUTION_MAX_PAGES = parseNonNegativeIntEnv("QWEN_SOLUTION_MAX_PAGES", 0);
export const QWEN_ENABLE_RAW_SOLUTION_FALLBACK =
  (process.env.QWEN_ENABLE_RAW_SOLUTION_FALLBACK ?? "0") === "1";
export const PARSER_PROVIDER = (process.env.PARSER_PROVIDER ?? "openai_pdf").trim().toLowerCase();
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const OPENAI_ENDPOINT_URL = process.env.OPENAI_ENDPOINT_URL ?? "https://api.openai.com/v1/responses";
export const OPENAI_FILES_URL = process.env.OPENAI_FILES_URL ?? "https://api.openai.com/v1/files";
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.1-nano";
export const OPENAI_MAX_OUTPUT_TOKENS = parsePositiveIntEnv("OPENAI_MAX_OUTPUT_TOKENS", 6000);
export const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT ?? "minimal";
export const OPENAI_TEXT_VERBOSITY = process.env.OPENAI_TEXT_VERBOSITY ?? "low";

export const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

export const STORAGE_BUCKET = "mit-ocw";
export const SUPABASE_PUBLIC_URL = SUPABASE_URL.replace(/\/$/, "");
export const PDF_RENDERER_PROJECT = path.join(process.cwd(), "scripts", "pdf_renderer");
export const PDF_RENDERER_SCRIPT = path.join(PDF_RENDERER_PROJECT, "render_pdf.py");

export function actionIfMissingCriticalEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Missing required Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY)",
    );
  }
  if (PARSER_PROVIDER === "openai_pdf" && !OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY for PARSER_PROVIDER=openai_pdf");
  }
}

actionIfMissingCriticalEnv();
