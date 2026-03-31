import { Suspense } from "react";
import { getCourses, getFilterOptions } from "@/lib/queries/courses";
import CourseCard from "@/app/components/CourseCard";
import CourseSearch from "@/app/components/CourseSearch";
import CourseFilters from "@/app/components/CourseFilters";
import Pagination from "@/app/components/Pagination";
import AnimatedCard from "@/app/components/AnimatedCard";
import FadeIn from "@/app/components/FadeIn";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoursesPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : undefined;
  const department = typeof params.department === "string" ? params.department : undefined;
  const topic = typeof params.topic === "string" ? params.topic : undefined;
  const videos = params.videos === "1";
  const psets = params.psets === "1";
  const available = params.available !== "0";
  const page = typeof params.page === "string" ? parseInt(params.page, 10) || 1 : 1;

  const [{ courses, totalPages, currentPage }, filterOptions] = await Promise.all([
    getCourses({ q, department, topic, videos, psets, available, page }),
    getFilterOptions(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <FadeIn>
        <h1 className="mb-6 text-4xl font-black tracking-tighter text-[#191c1d] dark:text-zinc-100 md:text-5xl">
          Courses
        </h1>
      </FadeIn>

      <FadeIn delay={0.05} className="mb-6 flex flex-col gap-4">
        <Suspense>
          <CourseSearch />
        </Suspense>
        <Suspense>
          <CourseFilters
            departments={filterOptions.departments}
            topics={filterOptions.topics}
          />
        </Suspense>
      </FadeIn>

      {courses.length === 0 ? (
        <FadeIn delay={0.1} className="py-20 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No courses found matching your filters.</p>
        </FadeIn>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course, i) => (
              <AnimatedCard key={course.id} index={i}>
                <CourseCard course={course} />
              </AnimatedCard>
            ))}
          </div>

          <div className="mt-8">
            <Suspense>
              <Pagination currentPage={currentPage} totalPages={totalPages} />
            </Suspense>
          </div>
        </>
      )}
    </main>
  );
}
