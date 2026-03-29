import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyCourses } from "@/lib/queries/my-courses";
import { getEnrolledCurriculaTracks } from "@/lib/queries/curricula";
import CourseCard from "@/app/components/CourseCard";
import CurriculumTrackCard from "@/app/components/CurriculumTrackCard";

function LandingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <div className="flex flex-col items-start gap-6 max-w-2xl">
        <h1 className="text-5xl font-bold text-zinc-900 leading-tight dark:text-zinc-100">
        Commit to Learning.
        </h1>
        <p className="text-lg text-zinc-500 dark:text-zinc-400">
        See your curiosity through! Watch lectures, interact with the material, and get feedback for your work.
        Free forever.
        </p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Not affiliated with MIT. Content is sourced from MIT OpenCourseWare under CC BY-NC-SA 4.0.
        </p>
        <div className="flex items-center gap-4 pt-2">
          <Link
            href="/courses"
            className="rounded-lg bg-[#750014] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5a0010]"
          >
            Browse Courses
          </Link>
        </div>
      </div>
    </main>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <LandingPage />;

  const [{ courses, progress }, enrolledTracks] = await Promise.all([
    getMyCourses(),
    getEnrolledCurriculaTracks(),
  ]);

  const hasEnrolled = enrolledTracks.length > 0;
  const hasRecent = courses.length > 0;
  const hasActivity = hasEnrolled || hasRecent;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Welcome back</h1>
        {hasRecent && (
          <Link
            href={`/courses/${courses[0].id}`}
            className="rounded-lg bg-[#750014] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5a0010]"
          >
            Continue Learning
          </Link>
        )}
      </div>

      {!hasActivity ? (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-zinc-500 dark:text-zinc-400">You haven&apos;t started any courses yet.</p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <Link
              href="/courses"
              className="rounded-lg bg-[#750014] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5a0010]"
            >
              Browse Courses
            </Link>
            <Link
              href="/curricula"
              className="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Explore Curricula
            </Link>
          </div>
        </div>
      ) : (
        <>
          {hasEnrolled && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Enrolled Curricula</h2>
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

          {hasRecent && (
            <section className="mt-10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Recent Courses</h2>
                <Link
                  href="/my-courses"
                  className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  View all
                </Link>
              </div>
              <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {courses.slice(0, 6).map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    progress={progress.get(course.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
