import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types/course";
import type { CourseSection, Resource } from "@/lib/types/course-content";

export async function getCourseById(id: number): Promise<Course | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching course:", error);
    return null;
  }

  return data as Course;
}

export async function getCourseSections(courseId: number): Promise<CourseSection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("course_sections")
    .select("*")
    .eq("course_id", courseId)
    .order("ordering", { ascending: true });

  if (error) {
    console.error("Error fetching course sections:", error);
    return [];
  }

  return (data as CourseSection[]) ?? [];
}

export async function getCourseResources(courseId: number): Promise<Resource[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .eq("course_id", courseId)
    .order("ordering", { ascending: true });

  if (error) {
    console.error("Error fetching resources:", error);
    return [];
  }

  return (data as Resource[]) ?? [];
}
