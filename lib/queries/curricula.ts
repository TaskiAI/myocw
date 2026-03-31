import { CURRICULA_TRACKS } from "@/lib/data/curricula";
import { createClient } from "@/lib/supabase/server";

interface CourseMatchRow {
  id: number;
  url: string | null;
}

interface CurriculumEnrollmentRow {
  curriculum_id: string;
  enrolled_at: string | null;
}

export interface CurriculumCourse {
  courseNumber: string;
  title: string;
  urlPath: string;
  ocwUrl: string;
  localCourseId: number | null;
}

export interface CurriculumTrack {
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
  sourceCollectionId: string;
  capturedAt: string;
  isEnrolled: boolean;
  enrolledAt: string | null;
  courses: CurriculumCourse[];
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "").toLowerCase();
}

export async function getCurriculaTracks(): Promise<CurriculumTrack[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allOcwUrls = CURRICULA_TRACKS.flatMap((track) =>
    track.courses.map((course) => `https://ocw.mit.edu${course.urlPath}/`)
  );

  const { data: courseRows, error: courseError } = await supabase
    .from("courses")
    .select("id,url")
    .in("url", allOcwUrls);

  if (courseError) {
    console.error("Error resolving curricula courses:", courseError);
  }

  const localIdByPath = new Map<string, number>();
  for (const row of ((courseRows as CourseMatchRow[] | null) ?? [])) {
    if (!row.url) continue;
    try {
      const parsed = new URL(row.url);
      localIdByPath.set(normalizePath(parsed.pathname), row.id);
    } catch {
      continue;
    }
  }

  const enrollmentByCurriculumId = new Map<string, string | null>();

  if (user) {
    const { data: enrollments, error: enrollmentError } = await supabase
      .from("user_curriculum_enrollments")
      .select("curriculum_id,enrolled_at")
      .eq("user_id", user.id);

    if (enrollmentError) {
      console.error("Error resolving curriculum enrollments:", enrollmentError);
    } else {
      for (const row of (enrollments ?? []) as CurriculumEnrollmentRow[]) {
        enrollmentByCurriculumId.set(row.curriculum_id, row.enrolled_at ?? null);
      }
    }
  }

  // Temporary: only surface downloaded course(s) to reduce clutter
  const AVAILABLE_COURSE_IDS = new Set([4794]);

  return CURRICULA_TRACKS.map((track) => ({
    id: track.id,
    name: track.name,
    description: track.description,
    sourceUrl: track.sourceUrl,
    sourceCollectionId: track.sourceCollectionId,
    capturedAt: track.capturedAt,
    isEnrolled: enrollmentByCurriculumId.has(track.id),
    enrolledAt: enrollmentByCurriculumId.get(track.id) ?? null,
    courses: track.courses
      .filter((course) => {
        const key = normalizePath(course.urlPath);
        const localId = localIdByPath.get(key);
        return localId != null && AVAILABLE_COURSE_IDS.has(localId);
      })
      .map((course) => {
        const key = normalizePath(course.urlPath);
        return {
          courseNumber: course.courseNumber,
          title: course.title,
          urlPath: course.urlPath,
          ocwUrl: `https://ocw.mit.edu${course.urlPath}/`,
          localCourseId: localIdByPath.get(key) ?? null,
        };
      }),
  })).filter((track) => track.courses.length > 0);
}

export async function getEnrolledCurriculaTracks(): Promise<CurriculumTrack[]> {
  const tracks = await getCurriculaTracks();

  return tracks
    .filter((track) => track.isEnrolled)
    .sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""));
}
