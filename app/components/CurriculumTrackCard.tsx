"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left"
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{track.name}</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {track.courses.length} courses · In-app {track.courses.filter((course) => course.localCourseId !== null).length}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {track.isEnrolled && (
            <span className="rounded-xl bg-[#810020] px-2 py-1 text-xs font-medium text-white">
              Enrolled
            </span>
          )}
          <motion.svg
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }}
            className="h-4 w-4 text-zinc-400 dark:text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </motion.svg>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial="collapsed"
            animate="open"
            exit="collapsed"
            variants={{
              open: { opacity: 1, height: "auto" },
              collapsed: { opacity: 0, height: 0 },
            }}
            transition={{ duration: 0.25, ease: [0.04, 0.62, 0.23, 0.98] as const }}
            style={{ overflow: "hidden" }}
          >
            <div className="border-t border-zinc-100 px-5 pb-6 pt-4 dark:border-zinc-800">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{track.description}</p>

              {showEnrollmentControls && (
                <div className="mt-4">
                  <CurriculumEnrollToggle
                    curriculumId={track.id}
                    initialEnrolled={track.isEnrolled}
                  />
                </div>
              )}

              <div className="mt-4 flex flex-col items-center">
                {track.courses.map((course, index) => {
                  const isLocal = course.localCourseId !== null;
                  const href = isLocal ? `/courses/${course.localCourseId}` : course.ocwUrl;
                  return (
                    <div key={`${track.id}-${course.urlPath}`} className="w-full">
                      {index > 0 && (
                        <div className="flex justify-center py-1">
                          <svg className="h-4 w-4 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      )}
                      <Link
                        href={href}
                        target={isLocal ? undefined : "_blank"}
                        rel={isLocal ? undefined : "noopener noreferrer"}
                        className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <div>
                          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{course.courseNumber}</p>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{course.title}</p>
                        </div>
                        <svg className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                  );
                })}
              </div>

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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
