import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getMyCourses } from "@/lib/queries/my-courses";
import { getEnrolledCurriculaTracks } from "@/lib/queries/curricula";
import CourseCard from "@/app/components/CourseCard";
import CurriculumTrackCard from "@/app/components/CurriculumTrackCard";
import AnimatedCard from "@/app/components/AnimatedCard";
import FadeIn from "@/app/components/FadeIn";
import LandingCTA from "@/app/components/LandingCTA";
import HeroSection from "@/app/components/HeroSection";
import FeatureTimeline from "@/app/components/FeatureTimeline";
import Link from "next/link";

function LandingPage() {
  return (
    <main>
      <HeroSection />
      <FeatureTimeline />
      <LandingCTA />
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
      <FadeIn className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Welcome back</h1>
        {hasRecent && (
          <Link
            href={`/courses/${courses[0].id}`}
            className="rounded-lg bg-[#750014] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5a0010]"
          >
            Continue Learning
          </Link>
        )}
      </FadeIn>

      {!hasActivity ? (
        <FadeIn delay={0.1} className="mt-8 rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
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
              Explore Pathways
            </Link>
          </div>
        </FadeIn>
      ) : (
        <>
          {hasEnrolled && (
            <FadeIn delay={0.1} className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Enrolled Pathways</h2>
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

          {hasRecent && (
            <FadeIn delay={hasEnrolled ? 0.2 : 0.1} className="mt-10">
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
                {courses.slice(0, 6).map((course, i) => (
                  <AnimatedCard key={course.id} index={i}>
                    <CourseCard
                      course={course}
                      progress={progress.get(course.id)}
                    />
                  </AnimatedCard>
                ))}
              </div>
            </FadeIn>
          )}
        </>
      )}
    </main>
  );
}
