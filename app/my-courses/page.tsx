import { redirect } from "next/navigation";
import CourseCard from "@/app/components/CourseCard";
import { getMyCourses } from "@/lib/queries/my-courses";
import { getEnrolledCurriculaTracks } from "@/lib/queries/curricula";
import CurriculumTrackCard from "@/app/components/CurriculumTrackCard";
import AnimatedCard from "@/app/components/AnimatedCard";
import FadeIn from "@/app/components/FadeIn";

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
      <FadeIn>
        <h1 className="text-4xl font-black tracking-tighter text-[#191c1d] dark:text-zinc-100 md:text-5xl">My Courses</h1>
      </FadeIn>

      {!hasEnrolled && !hasRecent ? (
        <FadeIn delay={0.1} className="mt-6 rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            You are not enrolled in any pathways yet and have no recent course activity.
          </p>
        </FadeIn>
      ) : (
        <>
          {hasEnrolled && (
            <FadeIn delay={0.1} className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Enrolled</h2>
              <div className="mt-4 space-y-4">
                {enrolledTracks.map((track, i) => (
                  <AnimatedCard key={track.id} index={i}>
                    <CurriculumTrackCard
                      track={track}
                      showEnrollmentControls
                    />
                  </AnimatedCard>
                ))}
              </div>
            </FadeIn>
          )}

          <FadeIn delay={hasEnrolled ? 0.2 : 0.1} className="mt-10">
            <h2 className="text-lg font-semibold text-zinc-900">Recent Courses</h2>

            {!hasRecent ? (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No recent course activity yet.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((course, i) => (
                  <AnimatedCard key={course.id} index={i}>
                    <CourseCard
                      course={course}
                      progress={progress.get(course.id)}
                    />
                  </AnimatedCard>
                ))}
              </div>
            )}
          </FadeIn>
        </>
      )}
    </main>
  );
}
