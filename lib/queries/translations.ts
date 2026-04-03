import { createClient } from "@/lib/supabase/server";
import type { Problem, Resource } from "@/lib/types/course-content";

interface Translation {
  source_table: string;
  source_id: number;
  field_name: string;
  translated_text: string;
}

/**
 * Fetch cached translations for a course + language, then substitute into
 * problem and resource objects. Falls back to English for untranslated items.
 */
export async function applyTranslations(
  courseId: number,
  language: string | null,
  problems: Problem[],
  resources: Resource[]
): Promise<{ problems: Problem[]; resources: Resource[] }> {
  if (!language || language === "English" || language === "Other") {
    return { problems, resources };
  }

  const supabase = await createClient();

  // Fetch all problem IDs and resource IDs for this course
  const problemIds = problems.map((p) => p.id);
  const resourceIds = resources.map((r) => r.id);

  // Fetch translations in parallel
  const [{ data: problemTx }, { data: resourceTx }] = await Promise.all([
    problemIds.length > 0
      ? supabase
          .from("content_translations")
          .select("source_table, source_id, field_name, translated_text")
          .eq("source_table", "problems")
          .eq("language", language)
          .in("source_id", problemIds)
      : Promise.resolve({ data: [] as Translation[] }),
    resourceIds.length > 0
      ? supabase
          .from("content_translations")
          .select("source_table, source_id, field_name, translated_text")
          .eq("source_table", "resources")
          .eq("language", language)
          .in("source_id", resourceIds)
      : Promise.resolve({ data: [] as Translation[] }),
  ]);

  // Build lookup map
  const txMap = new Map<string, string>();
  for (const t of [...(problemTx ?? []), ...(resourceTx ?? [])]) {
    txMap.set(`${t.source_table}:${t.source_id}:${t.field_name}`, t.translated_text);
  }

  // If no translations found at all, return originals unchanged
  if (txMap.size === 0) {
    return { problems, resources };
  }

  // Substitute into problems
  const translatedProblems = problems.map((p) => ({
    ...p,
    question_text: txMap.get(`problems:${p.id}:question_text`) ?? p.question_text,
    solution_text: txMap.get(`problems:${p.id}:solution_text`) ?? p.solution_text,
    explanation_text: txMap.get(`problems:${p.id}:explanation_text`) ?? p.explanation_text,
  }));

  // Substitute into resources
  const translatedResources = resources.map((r) => ({
    ...r,
    content_text: r.content_text
      ? txMap.get(`resources:${r.id}:content_text`) ?? r.content_text
      : r.content_text,
  }));

  return { problems: translatedProblems, resources: translatedResources };
}

/**
 * Check how many translations exist for a course + language.
 * Returns { translated, total } counts.
 */
export async function getTranslationCoverage(
  courseId: number,
  language: string
): Promise<{ translated: number; total: number }> {
  const supabase = await createClient();

  // Count translatable content
  const [{ count: problemCount }, { count: resourceCount }] = await Promise.all([
    supabase
      .from("problems")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId),
    supabase
      .from("resources")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .not("content_text", "is", null),
  ]);

  const total = (problemCount ?? 0) + (resourceCount ?? 0);

  // Count existing translations
  const { count: txCount } = await supabase
    .from("content_translations")
    .select("id", { count: "exact", head: true })
    .eq("language", language)
    .eq("field_name", "question_text"); // one per problem as proxy

  return { translated: txCount ?? 0, total };
}
