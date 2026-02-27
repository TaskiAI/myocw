import Image from "next/image";
import Link from "next/link";
import type { Course } from "@/lib/types/course";

interface Props {
  course: Course;
  showContinueButton?: boolean;
  onContinueCourse?: () => void;
}

export default function CourseHeader({ course, showContinueButton, onContinueCourse }: Props) {
  const department = course.departments?.[0]?.name ?? null;
  const run = course.runs?.[0];
  const semester = run ? `${run.semester ?? ""} ${run.year ?? ""}`.trim() : null;
  const levels = course.runs
    ?.flatMap((r) => r.level?.map((l) => l.name) ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);
  const instructors = run?.instructors?.map((i) => i.full_name) ?? [];

  return (
    <div>
      <Link
        href="/courses"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        All Courses
      </Link>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {course.image_url && (
          <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl md:w-72">
            <Image
              src={course.image_url}
              alt={course.image_alt ?? course.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 288px"
              priority
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-[#750014]">{course.readable_id}</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {course.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            {department && <span>{department}</span>}
            {department && semester && <span>·</span>}
            {semester && <span>{semester}</span>}
          </div>

          {levels.length > 0 && (
            <div className="flex gap-2">
              {levels.map((level) => (
                <span
                  key={level}
                  className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600"
                >
                  {level}
                </span>
              ))}
            </div>
          )}

          {instructors.length > 0 && (
            <p className="text-sm text-zinc-500">
              {instructors.join(", ")}
            </p>
          )}

          {course.description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
              {course.description}
            </p>
          )}

          {showContinueButton && onContinueCourse && (
            <button
              onClick={onContinueCourse}
              className="mt-4 inline-flex w-fit items-center gap-2 rounded-lg bg-[#750014] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5a0010]"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Continue Course
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
