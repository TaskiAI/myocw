import { redirect } from "next/navigation";
import CourseCard from "@/app/components/CourseCard";
import { getMyCourses } from "@/lib/queries/my-courses";

export default async function MyCoursesPage() {
  const { userId, courses, progress } = await getMyCourses();
  if (!userId) redirect("/login");

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl font-bold text-zinc-900">My Courses</h1>

      {courses.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">
            You haven't interacted with any courses yet.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} progress={progress.get(course.id)} />
          ))}
        </div>
      )}
    </main>
  );
}
