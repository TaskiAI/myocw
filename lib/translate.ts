/**
 * Translation engine.
 *
 * Translates course content (problems, resources) via Gemini 3 Flash Preview,
 * with LaTeX / interactive-tag preservation and DB caching.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// ---- Config ----

const GEMINI_MODEL = "gemini-3-flash-preview";
const DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Placeholder extraction ----

interface Extraction {
  cleaned: string;
  placeholders: string[];
}

/**
 * Extract LaTeX math spans and interactive component tags from text,
 * replacing them with numbered `<<MATH_N>>` / `<<COMP_N>>` placeholders.
 * This prevents the LLM from mangling math notation during translation.
 */
export function extractPlaceholders(text: string): Extraction {
  const placeholders: string[] = [];
  let idx = 0;

  // 1. Extract interactive tags: <FillInBlank .../>, <MultipleChoice .../>, <FreeResponse .../>
  let cleaned = text.replace(
    /<(FillInBlank|MultipleChoice|FreeResponse)\b[^>]*\/>/g,
    (match) => {
      const i = idx++;
      placeholders.push(match);
      return `<<COMP_${i}>>`;
    }
  );

  // 2. Extract LaTeX math spans (order matters — $$ before $)
  cleaned = cleaned.replace(
    /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]*?)\\\)/g,
    (match) => {
      const i = idx++;
      placeholders.push(match);
      return `<<MATH_${i}>>`;
    }
  );

  return { cleaned, placeholders };
}

/**
 * Restore placeholders in translated text back to original LaTeX/component markup.
 */
export function restorePlaceholders(text: string, placeholders: string[]): string {
  return text.replace(/<<(?:MATH|COMP)_(\d+)>>/g, (_match, num) => {
    const i = Number(num);
    return placeholders[i] ?? _match;
  });
}

// ---- LLM translation ----

function buildPrompt(language: string): string {
  return `Translate the following educational content from English to ${language}.

Rules:
- Preserve ALL placeholders exactly as they appear (<<MATH_0>>, <<COMP_0>>, etc.)
- Preserve markdown formatting (**, *, \`, #, lists, etc.)
- Do not translate variable names, function names, or code
- Do not translate placeholder tokens
- Maintain the same paragraph and line structure
- Be accurate with mathematical/scientific terminology in ${language}
- Output ONLY the translated text, no explanations or commentary

Content:
`;
}

/**
 * Translate a single text via Gemini, preserving LaTeX and interactive tags.
 */
export async function translateText(
  ai: InstanceType<typeof GoogleGenAI>,
  text: string,
  language: string
): Promise<string> {
  if (!text.trim()) return text;

  const { cleaned, placeholders } = extractPlaceholders(text);

  // If there are no natural-language words to translate (pure math), return as-is
  const wordsOnly = cleaned.replace(/<<(?:MATH|COMP)_\d+>>/g, "").trim();
  if (!wordsOnly) return text;

  const prompt = buildPrompt(language) + cleaned;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
  });

  const translated = response.text?.trim();
  if (!translated) throw new Error("Empty translation response from Gemini");

  return restorePlaceholders(translated, placeholders);
}

// ---- MD5 hashing for cache invalidation ----

export function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

// ---- Cached translation ----

type SourceTable = "problems" | "resources";
type FieldName = "question_text" | "solution_text" | "explanation_text" | "content_text" | "title";

/**
 * Translate a single field with DB cache. Returns the translated text.
 * Uses the service-role Supabase client (writes to content_translations).
 */
export async function translateWithCache(
  supabase: AnySupabaseClient,
  ai: InstanceType<typeof GoogleGenAI>,
  sourceTable: SourceTable,
  sourceId: number,
  fieldName: FieldName,
  originalText: string,
  language: string
): Promise<string> {
  const hash = md5(originalText);

  // Check cache
  const { data: cached } = await supabase
    .from("content_translations")
    .select("translated_text, source_hash")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .eq("field_name", fieldName)
    .eq("language", language)
    .single();

  if (cached && cached.source_hash === hash) {
    return cached.translated_text;
  }

  // Translate
  const translated = await translateText(ai, originalText, language);

  // Upsert into cache
  await supabase.from("content_translations").upsert(
    {
      source_table: sourceTable,
      source_id: sourceId,
      field_name: fieldName,
      language,
      translated_text: translated,
      source_hash: hash,
    },
    { onConflict: "source_table,source_id,field_name,language" }
  );

  return translated;
}

// ---- Batch course translation ----

interface TranslationProgress {
  done: number;
  total: number;
  current?: string;
}

/**
 * Translate all problems and resources for a course.
 * Calls onProgress for each item translated.
 */
export async function translateCourseContent(
  supabaseUrl: string,
  supabaseKey: string,
  geminiApiKey: string,
  courseId: number,
  language: string,
  onProgress?: (p: TranslationProgress) => void
): Promise<{ translated: number; cached: number }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });

  // Fetch all problems for this course
  const { data: problems } = await supabase
    .from("problems")
    .select("id, question_text, solution_text, explanation_text")
    .eq("course_id", courseId)
    .order("ordering");

  // Fetch resources with translatable content
  const { data: resources } = await supabase
    .from("resources")
    .select("id, title, content_text")
    .eq("course_id", courseId)
    .not("content_text", "is", null)
    .order("ordering");

  // Build work items
  type WorkItem = { table: SourceTable; id: number; field: FieldName; text: string };
  const items: WorkItem[] = [];

  for (const p of problems ?? []) {
    if (p.question_text) items.push({ table: "problems", id: p.id, field: "question_text", text: p.question_text });
    if (p.solution_text) items.push({ table: "problems", id: p.id, field: "solution_text", text: p.solution_text });
    if (p.explanation_text) items.push({ table: "problems", id: p.id, field: "explanation_text", text: p.explanation_text });
  }

  for (const r of resources ?? []) {
    if (r.content_text) items.push({ table: "resources", id: r.id, field: "content_text", text: r.content_text });
  }

  let translated = 0;
  let cached = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.({ done: i, total: items.length, current: `${item.table}:${item.id}:${item.field}` });

    const hash = md5(item.text);

    // Quick cache check to avoid unnecessary LLM calls
    const { data: existing } = await supabase
      .from("content_translations")
      .select("source_hash")
      .eq("source_table", item.table)
      .eq("source_id", item.id)
      .eq("field_name", item.field)
      .eq("language", language)
      .single();

    if (existing && existing.source_hash === hash) {
      cached++;
      continue;
    }

    // Translate and cache
    await translateWithCache(supabase, ai, item.table, item.id, item.field, item.text, language);
    translated++;

    // Rate limit
    if (i < items.length - 1) await sleep(DELAY_MS);
  }

  onProgress?.({ done: items.length, total: items.length });
  return { translated, cached };
}
