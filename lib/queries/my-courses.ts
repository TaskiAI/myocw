import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types/course";

interface ActivityRow {
  course_id: number;
  last_interacted_at: string | null;
}

interface ProgressRow {
  completed_at: string | null;
  resources: { course_id: number } | null;
}

interface VideoCountRow {
  course_id: number;
}

export interface CourseProgress {
  completed: number;
  total: number;
}

export async function getMyCourses(): Promise<{
  userId: string | null;
  courses: Course[];
  progress: Map<number, CourseProgress>;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, courses: [] };
  }

  const [{ data: activity, error: activityError }, { data: progress, error: progressError }] =
    await Promise.all([
      supabase
        .from("user_course_activity")
        .select("course_id, last_interacted_at")
        .eq("user_id", user.id),
      supabase
        .from("user_video_progress")
        .select("completed_at, resources!inner(course_id)")
        .eq("user_id", user.id)
        .eq("completed", true),
    ]);

  if (activityError || progressError) {
    console.error("Error fetching my courses:", activityError ?? progressError);
    return { userId: user.id, courses: [], progress: new Map() };
  }

  const lastSeenByCourse = new Map<number, string>();

  for (const row of (activity ?? []) as ActivityRow[]) {
    if (!row.course_id) continue;
    if (row.last_interacted_at) {
      const prev = lastSeenByCourse.get(row.course_id);
      if (!prev || row.last_interacted_at > prev) {
        lastSeenByCourse.set(row.course_id, row.last_interacted_at);
      }
    } else if (!lastSeenByCourse.has(row.course_id)) {
      lastSeenByCourse.set(row.course_id, "");
    }
  }

  for (const row of (progress ?? []) as ProgressRow[]) {
    const courseId = row.resources?.course_id;
    if (!courseId) continue;
    if (row.completed_at) {
      const prev = lastSeenByCourse.get(courseId);
      if (!prev || row.completed_at > prev) {
        lastSeenByCourse.set(courseId, row.completed_at);
      }
    } else if (!lastSeenByCourse.has(courseId)) {
      lastSeenByCourse.set(courseId, "");
    }
  }

  const courseIds = [...lastSeenByCourse.keys()];
  if (courseIds.length === 0) {
    return { userId: user.id, courses: [], progress: new Map() };
  }

  const [{ data: courses, error: coursesError }, { data: videoTotals, error: videoTotalsError }] =
    await Promise.all([
      supabase.from("courses").select("*").in("id", courseIds),
      supabase
        .from("resources")
        .select("course_id")
        .eq("resource_type", "video")
        .in("course_id", courseIds),
    ]);

  if (coursesError || !courses) {
    console.error("Error fetching course details:", coursesError);
    return { userId: user.id, courses: [], progress: new Map() };
  }

  // Build completed count per course from progress rows
  const completedByCourse = new Map<number, number>();
  for (const row of (progress ?? []) as ProgressRow[]) {
    const courseId = row.resources?.course_id;
    if (!courseId) continue;
    completedByCourse.set(courseId, (completedByCourse.get(courseId) ?? 0) + 1);
  }

  // Build total video count per course
  const totalByCourse = new Map<number, number>();
  for (const row of (videoTotals ?? []) as VideoCountRow[]) {
    if (!row.course_id) continue;
    totalByCourse.set(row.course_id, (totalByCourse.get(row.course_id) ?? 0) + 1);
  }

  if (videoTotalsError) {
    console.error("Error fetching video totals:", videoTotalsError);
  }

  const progressMap = new Map<number, CourseProgress>();
  for (const courseId of courseIds) {
    const total = totalByCourse.get(courseId) ?? 0;
    if (total > 0) {
      progressMap.set(courseId, {
        completed: completedByCourse.get(courseId) ?? 0,
        total,
      });
    }
  }

  const courseList = courses as Course[];
  courseList.sort((a, b) => {
    const aKey = lastSeenByCourse.get(a.id) ?? "";
    const bKey = lastSeenByCourse.get(b.id) ?? "";
    return bKey.localeCompare(aKey);
  });

  return { userId: user.id, courses: courseList, progress: progressMap };
}
