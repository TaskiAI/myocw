import { createClient } from "@/lib/supabase/client";

/**
 * Fetch all completed video resource IDs for a given course.
 * Returns a Set<number> of resource IDs that the user has marked completed.
 */
export async function getVideoProgress(courseId: number): Promise<Set<number>> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();

  const { data, error } = await supabase
    .from("user_video_progress")
    .select("resource_id, resources!inner(course_id)")
    .eq("completed", true)
    .eq("user_id", user.id)
    .eq("resources.course_id", courseId);

  if (error || !data) return new Set();

  return new Set(data.map((row: { resource_id: number }) => row.resource_id));
}

/**
 * Mark a video resource as completed (upsert).
 */
export async function markVideoCompleted(resourceId: number): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("user_video_progress")
    .upsert(
      {
        user_id: user.id,
        resource_id: resourceId,
        completed: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,resource_id" }
    );

  return !error;
}
