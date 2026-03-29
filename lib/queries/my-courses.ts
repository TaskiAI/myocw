import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types/course";

interface ActivityRow {
  course_id: number;
  last_interacted_at: string | null;
}

interface ProgressRow {
  completed_at: string | null;
  resources: { course_id: number; section_id: number | null }[] | null;
}

interface VideoSectionRow {
  course_id: number;
  section_id: number | null;
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
    return { userId: null, courses: [], progress: new Map() };
  }

  const [{ data: activity, error: activityError }, { data: progress, error: progressError }] =
    await Promise.all([
      supabase
        .from("user_course_activity")
        .select("course_id, last_interacted_at")
        .eq("user_id", user.id),
      supabase
        .from("user_video_progress")
        .select("completed_at, resources!inner(course_id, section_id)")
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
    const courseId = row.resources?.[0]?.course_id;
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

  const [{ data: courses, error: coursesError }, { data: videoSections, error: videoSectionsError }] =
    await Promise.all([
      supabase.from("courses").select("*").in("id", courseIds),
      supabase
        .from("resources")
        .select("course_id, section_id")
        .eq("resource_type", "video")
        .in("course_id", courseIds),
    ]);

  if (coursesError || !courses) {
    console.error("Error fetching course details:", coursesError);
    return { userId: user.id, courses: [], progress: new Map() };
  }

  // Count unique sections with videos per course (section-based total)
  const totalSectionsByCourse = new Map<number, Set<number>>();
  for (const row of (videoSections ?? []) as VideoSectionRow[]) {
    if (!row.course_id || row.section_id == null) continue;
    if (!totalSectionsByCourse.has(row.course_id)) totalSectionsByCourse.set(row.course_id, new Set());
    totalSectionsByCourse.get(row.course_id)!.add(row.section_id);
  }

  // Count unique sections with completed videos per course
  const completedSectionsByCourse = new Map<number, Set<number>>();
  for (const row of (progress ?? []) as ProgressRow[]) {
    const courseId = row.resources?.[0]?.course_id;
    const sectionId = row.resources?.[0]?.section_id;
    if (!courseId || sectionId == null) continue;
    if (!completedSectionsByCourse.has(courseId)) completedSectionsByCourse.set(courseId, new Set());
    completedSectionsByCourse.get(courseId)!.add(sectionId);
  }

  if (videoSectionsError) {
    console.error("Error fetching video sections:", videoSectionsError);
  }

  const progressMap = new Map<number, CourseProgress>();
  for (const courseId of courseIds) {
    const total = totalSectionsByCourse.get(courseId)?.size ?? 0;
    if (total > 0) {
      progressMap.set(courseId, {
        completed: completedSectionsByCourse.get(courseId)?.size ?? 0,
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
