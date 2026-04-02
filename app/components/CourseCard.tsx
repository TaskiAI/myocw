import Image from "next/image";
import Link from "next/link";
import type { Course } from "@/lib/types/course";
import type { CourseProgress } from "@/lib/queries/my-courses";

export default function CourseCard({
  course,
  progress,
  priority,
}: {
  course: Course;
  progress?: CourseProgress;
  priority?: boolean;
}) {
  const department = course.departments?.[0]?.name ?? null;

  const levels = course.runs
    ?.flatMap((r) => r.level?.map((l) => l.name) ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);
  const level = levels?.[0] ?? null;

  return (
    <Link
      href={`/courses/${course.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-[shadow,transform] duration-200 hover:shadow-md hover:scale-[1.02] dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="relative aspect-[16/9] w-full bg-[#750014]">
        {course.image_url ? (
          <Image
            src={course.image_url}
            alt={course.image_alt ?? course.title}
            fill
            priority={priority}
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 384px"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4">
            <span className="text-center text-sm font-semibold text-white/80">
              {course.readable_id}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900 group-hover:text-[#750014] dark:text-zinc-100">
          {course.title}
        </h3>

        <div className="mt-auto flex flex-col gap-1.5">
          {department && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{department}</p>
          )}

          <div className="flex items-center gap-2">
            {level && (
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {level}
              </span>
            )}
          </div>

          {(course.has_lecture_videos || course.has_problem_sets) && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {[
                course.has_lecture_videos && "Lecture Videos",
                course.has_problem_sets && "Problem Sets",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}

          {progress && progress.total > 0 && (() => {
            const pct = Math.round((progress.completed / progress.total) * 100);
            return (
              <div className="mt-1 flex flex-col gap-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-[#750014] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {pct}% completed
                  <span className="text-zinc-400 dark:text-zinc-500"> · {progress.completed}/{progress.total} sections</span>
                </p>
              </div>
            );
          })()}
        </div>
      </div>
    </Link>
  );
}
