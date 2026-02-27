export interface CourseSection {
  id: number;
  course_id: number;
  title: string;
  slug: string;
  section_type: string;
  ordering: number;
  parent_id: number | null;
  created_at: string;
}

export interface Resource {
  id: number;
  course_id: number;
  section_id: number | null;
  title: string;
  resource_type: string;
  pdf_path: string | null;
  video_url: string | null;
  youtube_id: string | null;
  archive_url: string | null;
  ordering: number;
  created_at: string;
}

export type SelfGrade = "correct" | "partially_correct" | "incorrect" | "unsure";

export interface Problem {
  id: number;
  resource_id: number;
  course_id: number;
  problem_label: string;
  question_text: string;
  solution_text: string | null;
  ordering: number;
  created_at: string;
}

export interface UserProblemAttempt {
  id: number;
  user_id: string;
  problem_id: number;
  answer_text: string;
  self_grade: SelfGrade;
  attempted_at: string;
}
