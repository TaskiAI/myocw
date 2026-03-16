import { createClient } from "@/lib/supabase/client";
import type { Problem } from "@/lib/types/course-content";
import { DEV_EDITOR_EMAIL } from "@/lib/queries/user-pset-drafts-shared";

interface ProblemEditorInput {
  courseId: number;
  resourceId: number;
  problemLabel: string;
  questionText: string;
  solutionText: string | null;
  ordering: number;
}

interface ProblemUpdateInput {
  problemLabel: string;
  questionText: string;
  solutionText: string | null;
}

function normalizeProblemLabel(value: string, fallbackOrdering: number): string {
  const trimmed = value.trim();
  return trimmed || `Problem ${fallbackOrdering + 1}`;
}

function normalizeSolutionText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

async function requireDevEditor() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== DEV_EDITOR_EMAIL) {
    return { supabase, user: null };
  }

  return { supabase, user };
}

export async function createCourseProblem(
  input: ProblemEditorInput
): Promise<Problem | null> {
  const { supabase, user } = await requireDevEditor();
  if (!user) return null;

  const { data, error } = await supabase
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
  input: ProblemUpdateInput,
  fallbackOrdering = 0
): Promise<Problem | null> {
  const { supabase, user } = await requireDevEditor();
  if (!user) return null;

  const { data, error } = await supabase
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
  const { supabase, user } = await requireDevEditor();
  if (!user) return false;

  const { error } = await supabase.from("problems").delete().eq("id", problemId);

  if (error) {
    console.error("Error deleting problem:", error);
  }

  return !error;
}


export async function updateCourseSectionTitle(
  sectionId: number,
  title: string
): Promise<{ id: number; title: string } | null> {
  const { supabase, user } = await requireDevEditor();
  if (!user) return null;

  const trimmedTitle = title.trim();
  if (!trimmedTitle) return null;

  const { data, error } = await supabase
    .from("course_sections")
    .update({ title: trimmedTitle })
    .eq("id", sectionId)
    .select("id, title")
    .single();

  if (error || !data) {
    console.error("Error updating course section title:", error);
    return null;
  }

  return data as { id: number; title: string };
}

export async function updateCourseResourceTitle(
  resourceId: number,
  title: string
): Promise<{ id: number; title: string } | null> {
  const { supabase, user } = await requireDevEditor();
  if (!user) return null;

  const trimmedTitle = title.trim();
  if (!trimmedTitle) return null;

  const { data, error } = await supabase
    .from("resources")
    .update({ title: trimmedTitle })
    .eq("id", resourceId)
    .select("id, title")
    .single();

  if (error || !data) {
    console.error("Error updating resource title:", error);
    return null;
  }

  return data as { id: number; title: string };
}
