import { createClient } from "@/lib/supabase/client";

/**
 * Record that the user interacted with a course (viewed, started, etc.).
 * Updates last_interacted_at on subsequent interactions.
 */
export async function markCourseInteracted(courseId: number): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("user_course_activity")
    .upsert(
      {
        user_id: user.id,
        course_id: courseId,
        last_interacted_at: new Date().toISOString(),
      },
      { onConflict: "user_id,course_id" }
    );

  return !error;
}
