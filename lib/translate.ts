/**
 * Translation engine.
 *
 * Translates course content (problems, resources) via OpenAI GPT-5.4 Mini,
 * with LaTeX / interactive-tag preservation and DB caching.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// ---- Config ----

const OPENAI_MODEL = "gpt-5.4-mini";
const DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Placeholder extraction ----

interface Extraction {
  cleaned: string;
  placeholders: string[];
}

/**
 * Extract interactive component tags from text, replacing them with
 * numbered `<<COMP_N>>` placeholders. LaTeX math spans are kept in the
 * text so the LLM can translate `\text{...}` content inside them.
 */
export function extractPlaceholders(text: string): Extraction {
  const placeholders: string[] = [];
  let idx = 0;

  // Extract interactive tags: <FillInBlank .../>, <MultipleChoice .../>, <FreeResponse .../>
  const cleaned = text.replace(
    /<(FillInBlank|MultipleChoice|FreeResponse)\b[^>]*\/>/g,
    (match) => {
      const i = idx++;
      placeholders.push(match);
      return `<<COMP_${i}>>`;
    }
  );

  return { cleaned, placeholders };
}

/**
 * Restore placeholders in translated text back to original component markup.
 */
export function restorePlaceholders(text: string, placeholders: string[]): string {
  return text.replace(/<<COMP_(\d+)>>/g, (_match, num) => {
    const i = Number(num);
    return placeholders[i] ?? _match;
  });
}

// ---- LLM translation ----

function buildPrompt(language: string): string {
  return `You are translating university-level math and science courseware from English to ${language}. Use formal, academic, textbook-standard terminology — the kind found in published ${language}-language university textbooks. Never use colloquial or simplified synonyms for technical terms (e.g. "scalar" → "escalar", not "número"; "vector space" → "espacio vectorial", not a loose paraphrase).

Rules:
- Preserve ALL placeholders exactly as they appear (<<COMP_0>>, <<COMP_1>>, etc.)
- Preserve markdown formatting (**, *, \`, #, lists, etc.)
- Preserve all LaTeX math delimiters ($...$, $$...$$, \\[...\\], \\(...\\)) and LaTeX commands exactly
- IMPORTANT: Translate ALL English words inside LaTeX blocks to ${language}. This means bare words like "and", "where", "if", words inside \\text{}, \\textbf{}, \\textit{}, \\mathrm{} — any English word that is not a variable name or LaTeX command must be translated. Examples: "and" → "y", "where" → "donde", \\text{velocity} → \\text{velocidad}
- Do not translate single-letter variable names (x, y, A, b), LaTeX commands, or code
- Maintain the same paragraph and line structure
- Output ONLY the translated text, no explanations or commentary`;

}

/**
 * Translate a single text via OpenAI, preserving LaTeX and interactive tags.
 */
export async function translateText(
  ai: OpenAI,
  text: string,
  language: string
): Promise<string> {
  if (!text.trim()) return text;

  const { cleaned, placeholders } = extractPlaceholders(text);

  // If there are no natural-language words to translate (pure math/placeholders), return as-is
  const wordsOnly = cleaned
    .replace(/<<COMP_\d+>>/g, "")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\)/g, "")
    .trim();
  if (!wordsOnly) return text;

  const response = await ai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: buildPrompt(language) },
      { role: "user", content: cleaned },
    ],
  });

  const translated = response.choices[0]?.message?.content?.trim();
  if (!translated) throw new Error("Empty translation response from OpenAI");

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
  ai: OpenAI,
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
  openaiApiKey: string,
  courseId: number,
  language: string,
  onProgress?: (p: TranslationProgress) => void,
  force = false
): Promise<{ translated: number; cached: number }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const ai = new OpenAI({ apiKey: openaiApiKey });

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

    if (!force && existing && existing.source_hash === hash) {
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
