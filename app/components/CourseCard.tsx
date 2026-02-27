import Image from "next/image";
import Link from "next/link";
import type { Course } from "@/lib/types/course";

export default function CourseCard({ course }: { course: Course }) {
  const department = course.departments?.[0]?.name ?? null;

  const levels = course.runs
    ?.flatMap((r) => r.level?.map((l) => l.name) ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);
  const level = levels?.[0] ?? null;

  return (
    <Link
      href={`/courses/${course.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[16/9] w-full bg-[#750014]">
        {course.image_url ? (
          <Image
            src={course.image_url}
            alt={course.image_alt ?? course.title}
            fill
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
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900 group-hover:text-[#750014]">
          {course.title}
        </h3>

        <div className="mt-auto flex flex-col gap-1.5">
          {department && (
            <p className="text-xs text-zinc-500">{department}</p>
          )}

          <div className="flex items-center gap-2">
            {level && (
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                {level}
              </span>
            )}
          </div>

          {(course.has_lecture_videos || course.has_problem_sets) && (
            <p className="text-xs text-zinc-400">
              {[
                course.has_lecture_videos && "Lecture Videos",
                course.has_problem_sets && "Problem Sets",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
