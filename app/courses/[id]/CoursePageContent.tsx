"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Course } from "@/lib/types/course";
import type { CourseSection, Problem } from "@/lib/types/course-content";
import type { Resource } from "@/lib/types/course-content";
import { markCourseInteracted } from "@/lib/queries/course-activity";
import { getProblemAttempts } from "@/lib/queries/problem-progress";
import { getVideoProgress } from "@/lib/queries/video-progress";
import CourseHeader from "./CourseHeader";
import CoursePlayer from "./CoursePlayer";
import ScholarSessionPlayer from "./ScholarSessionPlayer";

interface UnitGroup {
  unit: CourseSection;
  sessions: CourseSection[];
}

interface Props {
  course: Course;
  sections: CourseSection[];
  resources: Resource[];
  problems: Problem[];
  canEditContent: boolean;
  hasContent: boolean;
  initialLecture?: number;
}

function ScholarUnitList({
  unitGroups,
  onSessionClick,
  onUnitOverviewClick,
  sortedSections,
  resources,
  completedVideos,
}: {
  unitGroups: UnitGroup[];
  onSessionClick: (sectionIndex: number) => void;
  onUnitOverviewClick: (unitId: number) => void;
  sortedSections: CourseSection[];
  resources: Resource[];
  completedVideos: Set<number>;
}) {
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(() => {
    // Expand first unit by default
    const first = unitGroups[0]?.unit.id;
    return first !== undefined ? new Set([first]) : new Set();
  });

  const toggleUnit = useCallback((unitId: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      return next;
    });
  }, []);

  // Map section ID → index in sortedSections (for click handler)
  const sectionIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    sortedSections.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [sortedSections]);

  // Session completion: a session is complete when its primary video is watched
  const isSessionCompleted = useCallback(
    (session: CourseSection) => {
      const sessionResources = resources.filter((r) => r.section_id === session.id);
      const video = sessionResources.find((r) => r.resource_type === "video");
      return video ? completedVideos.has(video.id) : false;
    },
    [resources, completedVideos]
  );

  // Check which units have an overview resource
  const unitsWithOverview = useMemo(() => {
    const set = new Set<number>();
    for (const group of unitGroups) {
      const unitRes = resources.filter((r) => r.section_id === group.unit.id);
      const hasOverview = unitRes.some(
        (r) =>
          r.resource_type === "reading" &&
          r.ordering === 0 &&
          r.title?.toLowerCase().includes("unit overview") &&
          r.content_text
      );
      if (hasOverview) set.add(group.unit.id);
    }
    return set;
  }, [unitGroups, resources]);

  // Count completed sessions per unit
  const unitCompletionCounts = useMemo(() => {
    const map = new Map<number, { completed: number; total: number }>();
    for (const group of unitGroups) {
      const completed = group.sessions.filter((s) => isSessionCompleted(s)).length;
      map.set(group.unit.id, { completed, total: group.sessions.length });
    }
    return map;
  }, [unitGroups, isSessionCompleted]);

  return (
    <section>
      <div className="mb-8">
        <h2 className="text-3xl font-black tracking-tight text-[#191c1d] dark:text-zinc-100">
          Course Content
        </h2>
        <p className="mt-2 text-[#594141] dark:text-zinc-400">
          {unitGroups.length} units, {unitGroups.reduce((s, g) => s + g.sessions.length, 0)} sessions.
        </p>
      </div>
      <div className="space-y-4">
        {unitGroups.map((group, unitIdx) => {
          const isExpanded = expandedUnits.has(group.unit.id);
          return (
            <div
              key={group.unit.id}
              className="overflow-hidden rounded-xl border border-[#e0bfbf]/20 bg-[#f3f4f5] dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                onClick={() => toggleUnit(group.unit.id)}
                className="group flex w-full items-center justify-between px-6 py-5 text-left transition-colors hover:bg-[#edeef0] dark:hover:bg-zinc-800"
              >
                <span className="flex items-center gap-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#810020] text-sm font-bold text-white">
                    {unitIdx + 1}
                  </span>
                  <span>
                    <span className="block text-lg font-bold tracking-tight text-[#191c1d] dark:text-zinc-100">
                      {group.unit.title}
                    </span>
                    <span className="text-sm text-[#594141] dark:text-zinc-400">
                      {group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""}
                      {(() => {
                        const counts = unitCompletionCounts.get(group.unit.id);
                        if (!counts || counts.completed === 0) return null;
                        return <span className="ml-2 text-green-600 dark:text-green-400">&middot; {counts.completed}/{counts.total} done</span>;
                      })()}
                    </span>
                  </span>
                </span>
                <svg
                  className={`h-5 w-5 text-zinc-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {isExpanded && (
                <div className="border-t border-[#e0bfbf]/10 dark:border-zinc-800">
                  {unitsWithOverview.has(group.unit.id) && (
                    <button
                      onClick={() => onUnitOverviewClick(group.unit.id)}
                      className="group flex w-full items-center gap-4 border-b border-[#e0bfbf]/5 px-6 py-4 text-left transition-colors last:border-b-0 hover:bg-white dark:border-zinc-800/50 dark:hover:bg-zinc-800"
                    >
                      <svg className="h-5 w-5 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                      </svg>
                      <span className="text-sm font-medium text-[#191c1d] transition-colors group-hover:text-[#810020] dark:text-zinc-100 dark:group-hover:text-[#ffb3b5]">
                        Instructor Overview
                      </span>
                      <svg
                        className="ml-auto h-4 w-4 text-zinc-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  )}
                  {group.sessions.map((session, sessionIdx) => {
                    const flatIndex = sectionIndexMap.get(session.id) ?? 0;
                    const completed = isSessionCompleted(session);
                    return (
                      <button
                        key={session.id}
                        onClick={() => onSessionClick(flatIndex)}
                        className="group flex w-full items-center gap-4 border-b border-[#e0bfbf]/5 px-6 py-4 text-left transition-colors last:border-b-0 hover:bg-white dark:border-zinc-800/50 dark:hover:bg-zinc-800"
                      >
                        {completed ? (
                          <svg className="h-5 w-5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        ) : (
                          <span className="font-mono text-sm text-zinc-300 dark:text-zinc-600">
                            {String(sessionIdx + 1).padStart(2, "0")}
                          </span>
                        )}
                        <span className="text-sm font-medium text-[#191c1d] transition-colors group-hover:text-[#810020] dark:text-zinc-100 dark:group-hover:text-[#ffb3b5]">
                          {session.title}
                        </span>
                        <svg
                          className="ml-auto h-4 w-4 text-zinc-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function CoursePageContent({
  course,
  sections,
  resources,
  problems,
  canEditContent,
  hasContent,
  initialLecture,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasSections = sections.length > 0;

  const [playerMode, setPlayerMode] = useState(initialLecture !== undefined);
  const [overrideSession, setOverrideSession] = useState<number | undefined>(undefined);
  const [initialShowUnitOverview, setInitialShowUnitOverview] = useState(false);
  const [completedVideos, setCompletedVideos] = useState<Set<number>>(new Set());
  const [problemStats, setProblemStats] = useState<{
    total: number;
    attempted: number;
    correct: number;
  } | null>(null);

  useEffect(() => {
    void markCourseInteracted(course.id);
  }, [course.id]);

  // Fetch video progress for overview checkmarks
  useEffect(() => {
    getVideoProgress(course.id).then(setCompletedVideos);
  }, [course.id]);

  useEffect(() => {
    if (problems.length === 0) return;
    getProblemAttempts(course.id).then((attempts) => {
      let correct = 0;
      for (const attempt of attempts.values()) {
        if (attempt.self_grade === "correct") correct++;
      }
      setProblemStats({
        total: problems.length,
        attempted: attempts.size,
        correct,
      });
    });
  }, [course.id, problems.length]);

  // Sorted sections for display
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.ordering - b.ordering),
    [sections]
  );

  // Lecture sections for count
  const lectureSections = useMemo(
    () => sortedSections.filter((s) => s.section_type === "lecture"),
    [sortedSections]
  );

  // Leaf topics (non-null parent = leaf topic in hierarchy)
  const leafTopics = useMemo(() => {
    const topics = course.topics ?? [];
    // Prefer leaf topics (those with a parent), fall back to all
    const leaves = topics.filter((t) => t.parent !== null);
    return leaves.length > 0 ? leaves.slice(0, 4) : topics.slice(0, 4);
  }, [course.topics]);

  // Scholar unit groupings
  const isScholar = course.is_scholar ?? false;
  const unitGroups = useMemo<UnitGroup[]>(() => {
    if (!isScholar) return [];
    const units = sortedSections.filter((s) => s.section_type === "unit");
    return units.map((unit) => ({
      unit,
      sessions: sortedSections.filter((s) => s.parent_id === unit.id),
    }));
  }, [isScholar, sortedSections]);

  // Scholar: map section ID → session index (non-unit sections only)
  const scholarSessionIndexById = useMemo(() => {
    if (!isScholar) return new Map<number, number>();
    const map = new Map<number, number>();
    let sessionIdx = 0;
    for (const s of sortedSections) {
      if (s.section_type === "unit") continue;
      map.set(s.id, sessionIdx);
      sessionIdx++;
    }
    return map;
  }, [isScholar, sortedSections]);

  // For Scholar courses, count all sessions (not just lectures)
  const sessionCount = useMemo(() => {
    if (!isScholar) return 0;
    return unitGroups.reduce((sum, g) => sum + g.sessions.length, 0);
  }, [isScholar, unitGroups]);

  // Instructors
  const instructors = useMemo(
    () => course.runs?.[0]?.instructors ?? [],
    [course.runs]
  );

  const handleContinueCourse = useCallback(() => {
    setPlayerMode(true);
  }, []);

  const handleExitPlayer = useCallback(() => {
    setPlayerMode(false);
    setOverrideSession(undefined);
    setInitialShowUnitOverview(false);
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

  const handleSectionClick = useCallback(
    (sectionIndex: number) => {
      // For Scholar: translate flat section index → session-only index
      let paramIndex = sectionIndex;
      if (isScholar) {
        const section = sortedSections[sectionIndex];
        if (section) {
          paramIndex = scholarSessionIndexById.get(section.id) ?? sectionIndex;
        }
      }
      setInitialShowUnitOverview(false);
      setOverrideSession(paramIndex);
      setPlayerMode(true);
      const params = new URLSearchParams(searchParams.toString());
      params.set("lecture", String(paramIndex + 1));
      router.push(`/courses/${course.id}?${params.toString()}`, { scroll: false });
    },
    [course.id, isScholar, router, scholarSessionIndexById, searchParams, sortedSections]
  );

  const handleUnitOverviewClick = useCallback(
    (unitId: number) => {
      // Find the first session in this unit and navigate to it with unit overview showing
      const unit = unitGroups.find((g) => g.unit.id === unitId);
      if (!unit || unit.sessions.length === 0) return;
      const firstSession = unit.sessions[0];
      const sessionIdx = scholarSessionIndexById.get(firstSession.id) ?? 0;
      setInitialShowUnitOverview(true);
      setOverrideSession(sessionIdx);
      setPlayerMode(true);
      const params = new URLSearchParams(searchParams.toString());
      params.set("lecture", String(sessionIdx + 1));
      router.push(`/courses/${course.id}?${params.toString()}`, { scroll: false });
    },
    [course.id, unitGroups, scholarSessionIndexById, router, searchParams]
  );

  if (!hasContent) {
    const subject = encodeURIComponent(`Course Request: ${course.title}`);
    const body = encodeURIComponent(
      `Hi, I'd like to request that the following course be added to myOCW:\n\n` +
      `${course.title}\n` +
      (course.url ? `${course.url}\n` : "") +
      `\nThanks!`
    );

    return (
      <main className="mx-auto max-w-screen-2xl px-6 py-10 md:px-12">
        <CourseHeader course={course} />
        <div className="mt-8 rounded-xl bg-[#f3f4f5] p-8 text-center dark:bg-zinc-900">
          {canEditContent ? (
            <>
              <p className="text-sm text-[#594141] dark:text-zinc-400">
                Course content has not been downloaded yet.
              </p>
              {course.url && (
                <a
                  href={course.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gradient-to-br from-[#810020] to-[#a31f34] mt-4 inline-block rounded-lg px-6 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  View on MIT OCW
                </a>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-[#594141] dark:text-zinc-400">
                This course hasn&apos;t been added yet.
              </p>
              <a
                href={`mailto:ardatasci@nyu.edu?subject=${subject}&body=${body}`}
                className="bg-gradient-to-br from-[#810020] to-[#a31f34] mt-4 inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                Request Course
              </a>
              <p className="mt-3 text-xs text-zinc-400">
                We&apos;ll get this course set up as soon as possible.
              </p>
            </>
          )}
        </div>
      </main>
    );
  }

  if (playerMode) {
    return (
      <main className="px-4 py-4 lg:px-6">
        {isScholar ? (
          <ScholarSessionPlayer
            key={`scholar-${overrideSession ?? initialLecture ?? 0}-${initialShowUnitOverview}`}
            sections={sections}
            resources={resources}
            problems={problems}
            courseId={course.id}
            canEditContent={canEditContent}
            initialSession={overrideSession ?? initialLecture}
            initialShowUnitOverview={initialShowUnitOverview}
            onExitPlayer={handleExitPlayer}
            onSessionChange={handleLectureChange}
          />
        ) : (
          <CoursePlayer
            sections={sections}
            resources={resources}
            problems={problems}
            courseId={course.id}
            canEditContent={canEditContent}
            initialLecture={initialLecture}
            onExitPlayer={handleExitPlayer}
            onLectureChange={handleLectureChange}
            isScholar={isScholar}
          />
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-screen-2xl px-6 py-10 md:px-12">
      <CourseHeader
        course={course}
        showContinueButton={hasSections}
        onContinueCourse={handleContinueCourse}
        problemStats={problemStats}
        lectureCount={isScholar ? sessionCount : lectureSections.length}
      />

      <div className="mt-16 space-y-16">
        {/* What you'll learn — topic cards */}
        {leafTopics.length > 0 && (
          <section>
            <div className="mb-8">
              <h2 className="text-3xl font-black tracking-tight text-[#191c1d] dark:text-zinc-100">
                What you'll learn
              </h2>
              <div className="mt-2 h-1 w-12 bg-[#810020]" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {leafTopics.map((topic, i) => (
                <div
                  key={topic.id}
                  className={`rounded-xl bg-[#f3f4f5] p-6 transition-all hover:bg-white hover:shadow-xl dark:bg-zinc-900 dark:hover:bg-zinc-800 ${
                    i === 0 ? "border-l-4 border-[#810020]" : ""
                  }`}
                >
                  <h4 className="text-lg font-bold text-[#191c1d] dark:text-zinc-100">
                    {topic.name}
                  </h4>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Instructors + Problem Stats */}
        {(instructors.length > 0 || (problemStats && problemStats.total > 0)) && (
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
            {/* Instructors */}
            {instructors.length > 0 && (
              <section>
                <h3 className="mb-6 text-xl font-black uppercase tracking-widest text-[#191c1d] dark:text-zinc-100">
                  Instructors
                </h3>
                <div className="space-y-6">
                  {instructors.map((instructor) => (
                    <div key={instructor.id} className="flex items-center gap-6">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f3f4f5] ring-2 ring-[#810020] ring-offset-4 ring-offset-white dark:bg-zinc-800 dark:ring-offset-zinc-950">
                        <span className="text-xl font-bold text-[#810020]">
                          {instructor.first_name?.[0]}{instructor.last_name?.[0]}
                        </span>
                      </div>
                      <div>
                        <h5 className="text-lg font-bold text-[#191c1d] dark:text-zinc-100">
                          {instructor.full_name}
                        </h5>
                        <p className="text-sm text-[#594141] dark:text-zinc-400">
                          Instructor, MIT
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Problem Set Stats */}
            {problemStats && problemStats.total > 0 && (
              <section className="rounded-2xl bg-[#f3f4f5] p-10 dark:bg-zinc-900">
                <h3 className="mb-6 text-xl font-black uppercase tracking-widest text-[#810020]">
                  Your Progress
                </h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <svg className="mt-0.5 h-6 w-6 text-[#810020]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                    <div>
                      <span className="block font-bold text-[#191c1d] dark:text-zinc-100">
                        {problemStats.attempted} of {problemStats.total} problems attempted
                      </span>
                      <span className="text-sm text-[#594141] dark:text-zinc-400">
                        {Math.round((problemStats.attempted / problemStats.total) * 100)}% completion rate
                      </span>
                    </div>
                  </div>
                  {problemStats.attempted > 0 && (
                    <div className="flex items-start gap-4">
                      <svg className="mt-0.5 h-6 w-6 text-[#00463e]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                      <div>
                        <span className="block font-bold text-[#191c1d] dark:text-zinc-100">
                          {problemStats.correct} correct answers
                        </span>
                        <span className="text-sm text-[#594141] dark:text-zinc-400">
                          {Math.round((problemStats.correct / problemStats.attempted) * 100)}% accuracy
                        </span>
                      </div>
                    </div>
                  )}
                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="h-1 w-full rounded-full bg-[#d6e0f4]">
                      <div
                        className="bg-gradient-to-br from-[#810020] to-[#a31f34] h-1 rounded-full transition-all"
                        style={{
                          width: `${Math.round((problemStats.attempted / problemStats.total) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Course Content — Scholar unit cards or flat section list */}
        {isScholar && unitGroups.length > 0 ? (
          <ScholarUnitList unitGroups={unitGroups} onSessionClick={handleSectionClick} onUnitOverviewClick={handleUnitOverviewClick} sortedSections={sortedSections} resources={resources} completedVideos={completedVideos} />
        ) : sortedSections.length > 0 ? (
          <section>
            <div className="mb-8">
              <h2 className="text-3xl font-black tracking-tight text-[#191c1d] dark:text-zinc-100">
                Course Content
              </h2>
              <p className="mt-2 text-[#594141] dark:text-zinc-400">
                {sortedSections.length} sections covering the full curriculum.
              </p>
            </div>
            <div className="space-y-0">
              {sortedSections.map((section, i) => (
                <button
                  key={section.id}
                  onClick={() => handleSectionClick(i)}
                  className="group flex w-full items-center justify-between border-b border-[#e0bfbf]/10 py-6 text-left transition-colors hover:text-[#810020] dark:border-zinc-800"
                >
                  <span className="flex items-center gap-4">
                    <span className="font-mono text-xl text-zinc-300 dark:text-zinc-600">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-xl font-bold tracking-tight text-[#191c1d] transition-colors group-hover:text-[#810020] dark:text-zinc-100 dark:group-hover:text-[#ffb3b5]">
                      {section.title}
                    </span>
                  </span>
                  <svg
                    className="h-5 w-5 text-zinc-400 transition-transform group-hover:translate-x-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
