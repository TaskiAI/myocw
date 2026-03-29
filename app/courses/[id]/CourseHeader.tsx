import Image from "next/image";
import Link from "next/link";
import type { Course } from "@/lib/types/course";

interface Props {
  course: Course;
  showContinueButton?: boolean;
  onContinueCourse?: () => void;
  problemStats?: { total: number; attempted: number; correct: number } | null;
  lectureCount?: number;
}

function formatCourseReadableId(readableId: string): string {
  const [base, rawTerm] = readableId.split("+");
  const cleanBase = (base ?? readableId).replace(/_/g, " ").trim();
  if (!rawTerm) return cleanBase;

  const termMatch = rawTerm.trim().match(/^([a-zA-Z]+)[_\-]?(\d{4})$/);
  if (!termMatch) return `${cleanBase}, ${rawTerm.replace(/_/g, " ").trim()}`;

  const [, termName, year] = termMatch;
  const normalizedTerm = termName.charAt(0).toUpperCase() + termName.slice(1).toLowerCase();
  return `${cleanBase}, ${normalizedTerm} ${year}`;
}

export default function CourseHeader({
  course,
  showContinueButton,
  onContinueCourse,
  lectureCount,
}: Props) {
  const department = course.departments?.[0]?.name ?? null;
  const run = course.runs?.[0];
  const semester = run ? `${run.semester ?? ""} ${run.year ?? ""}`.trim() : null;
  const levels = course.runs
    ?.flatMap((r) => r.level?.map((l) => l.name) ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);
  const instructors = run?.instructors?.map((i) => i.full_name) ?? [];
  const displayCourseNumber = formatCourseReadableId(course.readable_id);

  return (
    <div>
      <Link
        href="/courses"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        All Courses
      </Link>

      <section className="relative w-full overflow-hidden">
        <div className="flex flex-col gap-12 md:flex-row md:items-start">
          {/* Left column */}
          <div className="flex-1 space-y-8">
            <div className="space-y-4">
              {department && (
                <span className="text-xs font-bold uppercase tracking-widest text-[#810020]">
                  {department}
                </span>
              )}
              <h1 className="text-4xl font-black leading-tight tracking-tighter text-[#191c1d] dark:text-zinc-100 md:text-5xl lg:text-6xl">
                {course.title}
              </h1>
              {course.description && (
                <div
                  className="course-description max-w-2xl text-lg leading-relaxed text-[#594141] dark:text-zinc-400"
                  dangerouslySetInnerHTML={{ __html: course.description }}
                />
              )}
            </div>

            {/* CTA buttons */}
            <div className="flex flex-wrap gap-4">
              {showContinueButton && onContinueCourse && (
                <button
                  onClick={onContinueCourse}
                  className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[#810020] to-[#a31f34] px-8 py-4 font-bold text-white transition-opacity hover:opacity-90"
                >
                  Resume Course
                  <svg
                    className="h-5 w-5 transition-transform group-hover:translate-x-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              )}
              {course.url && (
                <a
                  href={course.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-lg bg-[#e7e8e9] px-8 py-4 font-bold text-[#191c1d] transition-colors hover:bg-[#e1e3e4] dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                >
                  View on MIT OCW
                </a>
              )}
            </div>

            {/* Metadata strip */}
            <div className="grid grid-cols-3 gap-8 border-t border-[#e0bfbf]/20 pt-8">
              {levels.length > 0 && (
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Level
                  </span>
                  <span className="text-lg font-semibold text-[#191c1d] dark:text-zinc-100">
                    {levels.join(", ")}
                  </span>
                </div>
              )}
              {semester && (
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Semester
                  </span>
                  <span className="text-lg font-semibold text-[#191c1d] dark:text-zinc-100">
                    {semester}
                  </span>
                </div>
              )}
              {typeof lectureCount === "number" && lectureCount > 0 && (
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Lectures
                  </span>
                  <span className="text-lg font-semibold text-[#191c1d] dark:text-zinc-100">
                    {lectureCount}
                  </span>
                </div>
              )}
              {instructors.length > 0 && (
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Instructors
                  </span>
                  <span className="text-lg font-semibold text-[#191c1d] dark:text-zinc-100">
                    {instructors.length}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right column — course image */}
          {course.image_url && (
            <div className="w-full max-w-sm flex-shrink-0">
              <div className="group relative aspect-square w-full overflow-hidden rounded-2xl shadow-2xl">
                <Image
                  src={course.image_url}
                  alt={course.image_alt ?? course.title}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  priority
                />
                <div className="absolute inset-0 bg-[#810020]/10 mix-blend-multiply" />
                {(semester || displayCourseNumber) && (
                  <div className="absolute bottom-6 left-6 right-6 rounded-xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
                    <span className="text-sm font-medium text-white">
                      {[semester, displayCourseNumber].filter(Boolean).join(" \u2022 ")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
