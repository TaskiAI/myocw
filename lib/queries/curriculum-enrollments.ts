import { createClient } from "@/lib/supabase/client";

export async function enrollInCurriculum(curriculumId: string): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { error } = await supabase.from("user_curriculum_enrollments").upsert(
    {
      user_id: user.id,
      curriculum_id: curriculumId,
      enrolled_at: new Date().toISOString(),
    },
    { onConflict: "user_id,curriculum_id" }
  );

  return !error;
}

export async function unenrollFromCurriculum(curriculumId: string): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { error } = await supabase
    .from("user_curriculum_enrollments")
    .delete()
    .eq("user_id", user.id)
    .eq("curriculum_id", curriculumId);

  return !error;
}
