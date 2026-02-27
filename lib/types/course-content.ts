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
