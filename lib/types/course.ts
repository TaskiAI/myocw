export interface CourseTopic {
  id: number;
  name: string;
  parent: number | null;
}

export interface CourseInstructor {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
}

export interface CourseRun {
  id: number;
  semester: string | null;
  year: number | null;
  level: { code: string; name: string }[];
  instructors: CourseInstructor[];
  image?: { url: string; alt: string } | null;
}

export interface CourseDepartment {
  department_id: string;
  name: string;
  school?: { id: number; name: string; url: string } | null;
}

export interface Course {
  id: number;
  readable_id: string;
  title: string;
  description: string | null;
  url: string | null;
  image_url: string | null;
  image_alt: string | null;
  topics: CourseTopic[];
  departments: CourseDepartment[];
  runs: CourseRun[];
  course_feature: string[];
  has_lecture_videos: boolean;
  has_problem_sets: boolean;
  free: boolean;
  certification: boolean;
  views: number;
  content_downloaded: boolean;
  content_downloaded_at: string | null;
  created_at: string;
  updated_at: string;
}
