import { Suspense } from "react";
import { getCourses, getFilterOptions } from "@/lib/queries/courses";
import CourseCard from "@/app/components/CourseCard";
import CourseSearch from "@/app/components/CourseSearch";
import CourseFilters from "@/app/components/CourseFilters";
import Pagination from "@/app/components/Pagination";

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
  const page = typeof params.page === "string" ? parseInt(params.page, 10) || 1 : 1;

  const [{ courses, totalPages, currentPage }, filterOptions] = await Promise.all([
    getCourses({ q, department, topic, videos, psets, page }),
    getFilterOptions(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-zinc-900">
        Courses
      </h1>

      <div className="mb-6 flex flex-col gap-4">
        <Suspense>
          <CourseSearch />
        </Suspense>
        <Suspense>
          <CourseFilters
            departments={filterOptions.departments}
            topics={filterOptions.topics}
          />
        </Suspense>
      </div>

      {courses.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm text-zinc-500">No courses found matching your filters.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
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
