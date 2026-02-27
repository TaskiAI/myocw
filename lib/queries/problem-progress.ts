import { createClient } from "@/lib/supabase/client";
import type { SelfGrade, UserProblemAttempt } from "@/lib/types/course-content";

/**
 * Fetch all problem attempts for a given course.
 * Returns a Map of problem_id → UserProblemAttempt.
 */
export async function getProblemAttempts(
  courseId: number
): Promise<Map<number, UserProblemAttempt>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Map();

  const { data, error } = await supabase
    .from("user_problem_attempts")
    .select("*, problems!inner(course_id)")
    .eq("user_id", user.id)
    .eq("problems.course_id", courseId);

  if (error || !data) return new Map();

  const map = new Map<number, UserProblemAttempt>();
  for (const row of data) {
    map.set(row.problem_id, {
      id: row.id,
      user_id: row.user_id,
      problem_id: row.problem_id,
      answer_text: row.answer_text,
      self_grade: row.self_grade,
      attempted_at: row.attempted_at,
    });
  }
  return map;
}

/**
 * Submit or update a problem attempt (upsert).
 */
export async function submitProblemAttempt(
  problemId: number,
  answerText: string,
  selfGrade: SelfGrade
): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from("user_problem_attempts").upsert(
    {
      user_id: user.id,
      problem_id: problemId,
      answer_text: answerText,
      self_grade: selfGrade,
      attempted_at: new Date().toISOString(),
    },
    { onConflict: "user_id,problem_id" }
  );

  return !error;
}
