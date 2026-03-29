"use server";

import { createClient as createAuthClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { DEV_EDITOR_EMAIL } from "@/lib/queries/user-pset-drafts-shared";
import type { Problem } from "@/lib/types/course-content";

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

async function requireDevEditor() {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== DEV_EDITOR_EMAIL) return null;
  return user;
}

function normalizeProblemLabel(value: string, fallbackOrdering: number): string {
  const trimmed = value.trim();
  return trimmed || `Problem ${fallbackOrdering + 1}`;
}

function normalizeSolutionText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function createCourseProblem(input: {
  courseId: number;
  resourceId: number;
  problemLabel: string;
  questionText: string;
  solutionText: string | null;
  ordering: number;
}): Promise<Problem | null> {
  const user = await requireDevEditor();
  if (!user) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("problems")
    .insert({
      course_id: input.courseId,
      resource_id: input.resourceId,
      problem_label: normalizeProblemLabel(input.problemLabel, input.ordering),
      question_text: input.questionText,
      solution_text: normalizeSolutionText(input.solutionText),
      ordering: input.ordering,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("Error creating problem:", error);
    return null;
  }

  return data as Problem;
}

export async function updateCourseProblem(
  problemId: number,
  input: {
    problemLabel: string;
    questionText: string;
    solutionText: string | null;
  },
  fallbackOrdering = 0
): Promise<Problem | null> {
  const user = await requireDevEditor();
  if (!user) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("problems")
    .update({
      problem_label: normalizeProblemLabel(input.problemLabel, fallbackOrdering),
      question_text: input.questionText,
      solution_text: normalizeSolutionText(input.solutionText),
    })
    .eq("id", problemId)
    .select("*")
    .single();

  if (error || !data) {
    console.error("Error updating problem:", error);
    return null;
  }

  return data as Problem;
}

export async function deleteCourseProblem(problemId: number): Promise<boolean> {
  const user = await requireDevEditor();
  if (!user) return false;

  const admin = createAdminClient();
  const { error } = await admin.from("problems").delete().eq("id", problemId);

  if (error) {
    console.error("Error deleting problem:", error);
  }

  return !error;
}
