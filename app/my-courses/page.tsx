import { redirect } from "next/navigation";
import CourseCard from "@/app/components/CourseCard";
import { getMyCourses } from "@/lib/queries/my-courses";
import { getEnrolledCurriculaTracks } from "@/lib/queries/curricula";
import CurriculumTrackCard from "@/app/components/CurriculumTrackCard";

export default async function MyCoursesPage() {
  const [{ userId, courses, progress }, enrolledTracks] = await Promise.all([
    getMyCourses(),
    getEnrolledCurriculaTracks(),
  ]);

  if (!userId) redirect("/login");

  const hasEnrolled = enrolledTracks.length > 0;
  const hasRecent = courses.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">My Courses</h1>

      {!hasEnrolled && !hasRecent ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            You are not enrolled in any curricula yet and have no recent course activity.
          </p>
        </div>
      ) : (
        <>
          {hasEnrolled && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Enrolled</h2>
              <div className="mt-4 space-y-4">
                {enrolledTracks.map((track) => (
                  <CurriculumTrackCard
                    key={track.id}
                    track={track}
                    showEnrollmentControls
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-zinc-900">Recent Courses</h2>

            {!hasRecent ? (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No recent course activity yet.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    progress={progress.get(course.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
