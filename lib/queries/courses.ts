import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types/course";

const PAGE_SIZE = 12;

export interface CourseFilters {
  q?: string;
  department?: string;
  topic?: string;
  videos?: boolean;
  psets?: boolean;
  page?: number;
}

export interface CourseResult {
  courses: Course[];
  totalPages: number;
  currentPage: number;
}

export async function getCourses(filters: CourseFilters): Promise<CourseResult> {
  const supabase = await createClient();
  const page = filters.page ?? 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("courses")
    .select("*", { count: "exact" });

  if (filters.q) {
    query = query.ilike("title", `%${filters.q}%`);
  }

  if (filters.department) {
    query = query.contains("departments", [{ name: filters.department }]);
  }

  if (filters.topic) {
    query = query.contains("topics", [{ name: filters.topic }]);
  }

  if (filters.videos) {
    query = query.eq("has_lecture_videos", true);
  }

  if (filters.psets) {
    query = query.eq("has_problem_sets", true);
  }

  query = query
    .order("views", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;

  if (error) {
    console.error("Error fetching courses:", error);
    return { courses: [], totalPages: 0, currentPage: page };
  }

  return {
    courses: (data as Course[]) ?? [],
    totalPages: Math.ceil((count ?? 0) / PAGE_SIZE),
    currentPage: page,
  };
}

export interface FilterOptions {
  departments: string[];
  topics: string[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("courses")
    .select("departments, topics");

  if (error || !data) {
    console.error("Error fetching filter options:", error);
    return { departments: [], topics: [] };
  }

  const departmentSet = new Set<string>();
  const topicSet = new Set<string>();

  for (const row of data) {
    if (Array.isArray(row.departments)) {
      for (const dept of row.departments) {
        if (dept.name) departmentSet.add(dept.name);
      }
    }
    if (Array.isArray(row.topics)) {
      for (const topic of row.topics) {
        if (topic.name && topic.parent === null) {
          topicSet.add(topic.name);
        }
      }
    }
  }

  return {
    departments: [...departmentSet].sort(),
    topics: [...topicSet].sort(),
  };
}
