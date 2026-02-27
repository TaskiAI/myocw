"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import type { CourseSection } from "@/lib/types/course-content";
import type { Resource } from "@/lib/types/course-content";
import { getVideoProgress, markVideoCompleted } from "@/lib/queries/video-progress";
import YouTubePlayer from "./YouTubePlayer";

interface Props {
  sections: CourseSection[];
  resources: Resource[];
  courseSlug: string;
  courseId: number;
  initialLecture?: number;
  onExitPlayer?: () => void;
  onLectureChange?: (index: number) => void;
}

export default function CoursePlayer({
  sections,
  resources,
  courseSlug,
  courseId,
  initialLecture,
  onExitPlayer,
  onLectureChange,
}: Props) {
  const isPlayerMode = !!onExitPlayer;

  // All sections in flat order (lectures + problem sets + exams interleaved)
  const allSections = useMemo(
    () => [...sections].sort((a, b) => a.ordering - b.ordering),
    [sections]
  );

  // Indices of sections that have videos (for prev/next navigation)
  const lectureSectionIndices = useMemo(
    () => allSections
      .map((s, i) => (s.section_type === "lecture" ? i : -1))
      .filter((i) => i !== -1),
    [allSections]
  );

  // Group resources by section ID
  const resourcesBySection = useMemo(() => {
    const map = new Map<number | null, Resource[]>();
    for (const r of resources) {
      if (!map.has(r.section_id)) map.set(r.section_id, []);
      map.get(r.section_id)!.push(r);
    }
    return map;
  }, [resources]);

  // Map section ID → video resource (for progress tracking)
  const videoBySection = useMemo(() => {
    const map = new Map<number, Resource>();
    for (const section of allSections) {
      if (section.section_type !== "lecture") continue;
      const sectionResources = resourcesBySection.get(section.id) ?? [];
      const video = sectionResources.find((r) => r.resource_type === "video");
      if (video) map.set(section.id, video);
    }
    return map;
  }, [allSections, resourcesBySection]);

  // Convert initialLecture (lecture-only index) to flat index
  const initialFlatIndex = useMemo(() => {
    if (initialLecture === undefined) return 0;
    return lectureSectionIndices[initialLecture] ?? 0;
  }, [initialLecture, lectureSectionIndices]);

  const [activeIndex, setActiveIndex] = useState(initialFlatIndex);
  const [completedVideos, setCompletedVideos] = useState<Set<number>>(new Set());
  const [loadingProgress, setLoadingProgress] = useState(true);

  // Fetch progress on mount
  useEffect(() => {
    getVideoProgress(courseId).then((set) => {
      setCompletedVideos(set);
      setLoadingProgress(false);

      // If in player mode with no initialLecture, find first incomplete lecture
      if (isPlayerMode && initialLecture === undefined) {
        const firstIncomplete = lectureSectionIndices.find((flatIdx) => {
          const section = allSections[flatIdx];
          const video = videoBySection.get(section.id);
          return video && !set.has(video.id);
        });
        if (firstIncomplete !== undefined) {
          setActiveIndex(firstIncomplete);
        }
      }
    });
  }, [courseId, isPlayerMode, initialLecture, allSections, lectureSectionIndices, videoBySection]);

  const currentSection = allSections[activeIndex] ?? null;
  const currentResources = currentSection
    ? resourcesBySection.get(currentSection.id) ?? []
    : [];

  const isLecture = currentSection?.section_type === "lecture";
  const videos = currentResources.filter((r) => r.resource_type === "video");
  const notes = currentResources.filter((r) => r.resource_type === "lecture_notes");
  const pdfs = currentResources.filter((r) => r.pdf_path);
  const currentVideo = videos[0] ?? null;
  const isCurrentCompleted = currentVideo ? completedVideos.has(currentVideo.id) : false;

  // Find prev/next lecture indices (skip non-lecture sections)
  const currentLecturePos = lectureSectionIndices.indexOf(activeIndex);
  const prevLectureIndex = currentLecturePos > 0
    ? lectureSectionIndices[currentLecturePos - 1]
    : undefined;
  const nextLectureIndex = currentLecturePos < lectureSectionIndices.length - 1
    ? lectureSectionIndices[currentLecturePos + 1]
    : undefined;

  const completedCount = lectureSectionIndices.filter((flatIdx) => {
    const section = allSections[flatIdx];
    const video = videoBySection.get(section.id);
    return video && completedVideos.has(video.id);
  }).length;

  function goTo(flatIndex: number) {
    setActiveIndex(flatIndex);
    // Report lecture index for URL param (only for lectures)
    const lecturePos = lectureSectionIndices.indexOf(flatIndex);
    if (lecturePos !== -1) {
      onLectureChange?.(lecturePos);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const handleVideoEnded = useCallback(async () => {
    if (!currentVideo || completedVideos.has(currentVideo.id)) return;
    const success = await markVideoCompleted(currentVideo.id);
    if (success) {
      setCompletedVideos((prev) => new Set(prev).add(currentVideo.id));
    }
  }, [currentVideo, completedVideos]);

  // Icon for section type in sidebar
  function sectionIcon(section: CourseSection, flatIndex: number) {
    if (section.section_type === "lecture") {
      const video = videoBySection.get(section.id);
      const isCompleted = video ? completedVideos.has(video.id) : false;
      if (isCompleted) {
        return (
          <svg className="h-4 w-4 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      }
      const lecturePos = lectureSectionIndices.indexOf(flatIndex);
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-400">
          {lecturePos + 1}
        </span>
      );
    }
    // Non-lecture icon (document)
    return (
      <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    );
  }

  // Sidebar content
  const sidebarContent = (
    <nav className="flex flex-col gap-0.5 pb-8">
      {/* Exit button in player mode */}
      {isPlayerMode && (
        <button
          onClick={onExitPlayer}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Course Overview
        </button>
      )}

      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Content
        </p>
        {!loadingProgress && completedCount > 0 && (
          <span className="text-xs text-zinc-400">
            {completedCount}/{lectureSectionIndices.length}
          </span>
        )}
      </div>

      {allSections.map((section, i) => {
        const isActive = activeIndex === i;
        return (
          <button
            key={section.id}
            onClick={() => goTo(i)}
            className={`flex items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors ${
              isActive
                ? "bg-[#750014]/10 font-medium text-[#750014]"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {sectionIcon(section, i)}
            <span className="min-w-0 truncate">{section.title}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="flex gap-8">
      {/* Sidebar */}
      <aside
        className={`sticky top-20 hidden h-fit shrink-0 overflow-y-auto lg:block ${
          isPlayerMode ? "w-56" : "w-64"
        }`}
        style={{ maxHeight: "calc(100vh - 6rem)" }}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        {/* Lecture view (has video) */}
        {isLecture && currentSection && (
          <>
            {/* Video */}
            {videos.length > 0 && (
              <>
                {videos[0].youtube_id ? (
                  <YouTubePlayer
                    key={videos[0].youtube_id}
                    youtubeId={videos[0].youtube_id}
                    title={videos[0].title}
                    onVideoEnded={handleVideoEnded}
                  />
                ) : videos[0].archive_url ? (
                  <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black">
                    <div className="relative aspect-video w-full">
                      <video
                        key={videos[0].archive_url}
                        src={videos[0].archive_url}
                        controls
                        className="absolute inset-0 h-full w-full"
                      >
                        <track kind="captions" />
                      </video>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {/* Lecture title + completion badge */}
            <div className="mt-4">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-xl font-semibold text-zinc-900">
                  {currentSection.title}
                </h2>
                {isCurrentCompleted && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Completed
                  </span>
                )}
              </div>

              {/* Lecture notes */}
              {notes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {notes.map((note, i) => (
                    <a
                      key={note.id}
                      href={note.pdf_path!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                    >
                      <svg className="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      {notes.length === 1 ? "Lecture Notes" : `Lecture Notes ${i + 1}`}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Prev / Next navigation (lectures only) */}
            <div className="mt-8 flex items-center justify-between border-t border-zinc-200 pt-6">
              <button
                onClick={() => prevLectureIndex !== undefined && goTo(prevLectureIndex)}
                disabled={prevLectureIndex === undefined}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Previous
              </button>

              <span className="text-sm text-zinc-400">
                {currentLecturePos + 1} / {lectureSectionIndices.length}
              </span>

              <button
                onClick={() => nextLectureIndex !== undefined && goTo(nextLectureIndex)}
                disabled={nextLectureIndex === undefined}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30"
              >
                Next
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* Non-lecture view (problem set / exam / recitation) */}
        {!isLecture && currentSection && (
          <>
            <h2 className="mb-4 text-xl font-semibold text-zinc-900">
              {currentSection.title}
            </h2>
            {pdfs.length > 0 ? (
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
                {pdfs.map((resource) => (
                  <li key={resource.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                      {resource.resource_type === "solution" ? "Solution" :
                       resource.resource_type === "problem_set" ? "Assignment" :
                       resource.resource_type === "exam" ? "Exam" :
                       resource.resource_type === "recitation" ? "Recitation" :
                       "File"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-900">
                      {resource.title}
                    </span>
                    {resource.pdf_path && (
                      <a
                        href={resource.pdf_path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
                      >
                        PDF
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No files available for this section.</p>
            )}
          </>
        )}

        {/* Mobile content nav */}
        <div className="mt-8 lg:hidden">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            All Content
          </p>
          <div className="flex flex-col gap-1">
            {allSections.map((section, i) => (
              <button
                key={section.id}
                onClick={() => goTo(i)}
                className={`flex items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                  activeIndex === i
                    ? "bg-[#750014]/10 font-medium text-[#750014]"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {sectionIcon(section, i)}
                <span className="min-w-0 truncate">{section.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
