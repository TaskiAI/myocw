"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Course } from "@/lib/types/course";
import type { CourseSection } from "@/lib/types/course-content";
import type { Resource } from "@/lib/types/course-content";
import CourseHeader from "./CourseHeader";
import CoursePlayer from "./CoursePlayer";

interface Props {
  course: Course;
  sections: CourseSection[];
  resources: Resource[];
  courseSlug: string;
  hasContent: boolean;
  initialLecture?: number;
}

export default function CoursePageContent({
  course,
  sections,
  resources,
  courseSlug,
  hasContent,
  initialLecture,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasLectures = sections.some((s) => s.section_type === "lecture");

  // Start in player mode if ?lecture= param is present
  const [playerMode, setPlayerMode] = useState(initialLecture !== undefined);

  const handleContinueCourse = useCallback(() => {
    setPlayerMode(true);
  }, []);

  const handleExitPlayer = useCallback(() => {
    setPlayerMode(false);
    // Remove lecture param from URL
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lecture");
    const query = params.toString();
    router.push(`/courses/${course.id}${query ? `?${query}` : ""}`, { scroll: false });
  }, [course.id, router, searchParams]);

  const handleLectureChange = useCallback(
    (lectureIndex: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("lecture", String(lectureIndex + 1));
      router.push(`/courses/${course.id}?${params.toString()}`, { scroll: false });
    },
    [course.id, router, searchParams]
  );

  if (!hasContent) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-10">
        <CourseHeader course={course} />
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">
            Course content has not been downloaded yet.
          </p>
          {course.url && (
            <a
              href={course.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block rounded-lg bg-[#750014] px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010]"
            >
              View on MIT OCW
            </a>
          )}
        </div>
      </main>
    );
  }

  if (playerMode) {
    return (
      <main className="px-4 py-4 lg:px-6">
        <CoursePlayer
          sections={sections}
          resources={resources}
          courseSlug={courseSlug}
          courseId={course.id}
          initialLecture={initialLecture}
          onExitPlayer={handleExitPlayer}
          onLectureChange={handleLectureChange}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <CourseHeader
        course={course}
        showContinueButton={hasLectures}
        onContinueCourse={handleContinueCourse}
      />
      <div className="mt-8">
        <CoursePlayer
          sections={sections}
          resources={resources}
          courseSlug={courseSlug}
          courseId={course.id}
          onLectureChange={handleLectureChange}
        />
      </div>
    </main>
  );
}
