import Link from "next/link";
import type { CurriculumTrack } from "@/lib/queries/curricula";
import CurriculumEnrollToggle from "@/app/curricula/CurriculumEnrollToggle";

export default function CurriculumTrackCard({
  track,
  showEnrollmentControls = false,
}: {
  track: CurriculumTrack;
  showEnrollmentControls?: boolean;
}) {
  return (
    <details className="rounded-2xl border border-zinc-200 bg-white p-5 open:pb-6 dark:border-zinc-700 dark:bg-zinc-900">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{track.name}</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {track.courses.length} courses · In-app {track.courses.filter((course) => course.localCourseId !== null).length}
          </p>
        </div>
        {track.isEnrolled && (
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
            Enrolled
          </span>
        )}
      </summary>

      <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{track.description}</p>

        {showEnrollmentControls && (
          <div className="mt-4">
            <CurriculumEnrollToggle
              curriculumId={track.id}
              initialEnrolled={track.isEnrolled}
            />
          </div>
        )}

        <ol className="mt-4 space-y-2">
          {track.courses.map((course, index) => {
            const isLocal = course.localCourseId !== null;
            const href = isLocal ? `/courses/${course.localCourseId}` : course.ocwUrl;
            return (
              <li
                key={`${track.id}-${course.urlPath}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
              >
                <div>
                  <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Step {index + 1}</p>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{course.courseNumber}</p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{course.title}</p>
                </div>
                <Link
                  href={href}
                  target={isLocal ? undefined : "_blank"}
                  rel={isLocal ? undefined : "noopener noreferrer"}
                  className="shrink-0 text-xs font-medium text-[#750014] hover:text-[#5a0010]"
                >
                  {isLocal ? "Open" : "MIT OCW"}
                </Link>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Source:{" "}
          <Link
            href={track.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-800"
          >
            {track.sourceUrl}
          </Link>
        </p>
      </div>
    </details>
  );
}
