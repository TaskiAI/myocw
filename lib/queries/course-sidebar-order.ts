import { createClient } from "@/lib/supabase/client";

export interface SaveCourseSidebarOrderResult {
  ok: boolean;
  message: string;
}

function sanitizeSectionIds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<number>();
  const sectionIds: number[] = [];

  for (const value of values) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    sectionIds.push(id);
  }

  return sectionIds;
}

export async function getCourseSidebarOrder(courseId: number): Promise<number[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("course_sidebar_order")
    .select("section_ids")
    .eq("course_id", courseId)
    .maybeSingle();

  if (error || !data) return [];
  return sanitizeSectionIds(data.section_ids);
}

export async function saveCourseSidebarOrder(
  courseId: number,
  sectionIds: number[]
): Promise<SaveCourseSidebarOrderResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      message: "Sign in to save shared sidebar order.",
    };
  }

  const sanitizedSectionIds = sanitizeSectionIds(sectionIds);
  const { error } = await supabase.from("course_sidebar_order").upsert(
    {
      course_id: courseId,
      section_ids: sanitizedSectionIds,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "course_id" }
  );

  if (error) {
    return {
      ok: false,
      message: "Could not save sidebar order.",
    };
  }

  return {
    ok: true,
    message: "Saved shared sidebar order.",
  };
}
