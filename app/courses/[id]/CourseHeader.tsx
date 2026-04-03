import Image from "next/image";
import Link from "next/link";
import type { Course } from "@/lib/types/course";
import DownloadButton from "./DownloadButton";

interface Props {
  course: Course;
  showContinueButton?: boolean;
  onContinueCourse?: () => void;
  problemStats?: { total: number; attempted: number; correct: number } | null;
  lectureCount?: number;
  userLanguage?: string | null;
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
  problemStats,
  lectureCount,
  userLanguage,
}: Props) {
  const department = course.departments?.[0]?.name ?? null;
  const run = course.runs?.[0];
  const semester = run ? `${run.semester ?? ""} ${run.year ?? ""}`.trim() : null;
  const levels = course.runs
    ?.flatMap((r) => r.level?.map((l) => l.name) ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);
  const instructors = run?.instructors ?? [];
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
              <DownloadButton courseId={course.id} userLanguage={userLanguage ?? null} />
            </div>

          </div>

          {/* Right column — course image + instructors + progress */}
          <div className="w-full max-w-sm flex-shrink-0 space-y-8">
            {course.image_url && (
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
            )}

            {instructors.length > 0 && (
              <div>
                <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-zinc-400">
                  Instructors
                </h3>
                <div className="space-y-4">
                  {instructors.map((instructor) => (
                    <div key={instructor.id} className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3f4f5] ring-1 ring-[#810020] dark:bg-zinc-800">
                        <span className="text-sm font-bold text-[#810020]">
                          {instructor.first_name?.[0]}{instructor.last_name?.[0]}
                        </span>
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-[#191c1d] dark:text-zinc-100">
                          {instructor.full_name}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {problemStats && problemStats.total > 0 && (
              <div>
                <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-zinc-400">
                  Your Progress
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <svg className="h-5 w-5 text-[#810020]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                    <div>
                      <span className="block text-sm font-semibold text-[#191c1d] dark:text-zinc-100">
                        {problemStats.attempted} / {problemStats.total} problems
                      </span>
                      <span className="text-xs text-[#594141] dark:text-zinc-400">
                        {Math.round((problemStats.attempted / problemStats.total) * 100)}% completion
                      </span>
                    </div>
                  </div>
                  {problemStats.attempted > 0 && (
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5 text-[#00463e]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                      <div>
                        <span className="block text-sm font-semibold text-[#191c1d] dark:text-zinc-100">
                          {problemStats.correct} correct
                        </span>
                        <span className="text-xs text-[#594141] dark:text-zinc-400">
                          {Math.round((problemStats.correct / problemStats.attempted) * 100)}% accuracy
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="h-1 w-full rounded-full bg-[#d6e0f4]">
                    <div
                      className="h-1 rounded-full bg-gradient-to-br from-[#810020] to-[#a31f34] transition-all"
                      style={{
                        width: `${Math.round((problemStats.attempted / problemStats.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Metadata strip */}
      <div className="mt-8 border-t border-[#e0bfbf]/20 pt-8">
        <div className="grid grid-cols-3 gap-8">
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
        </div>
      </div>
    </div>
  );
}
