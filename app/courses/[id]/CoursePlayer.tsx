"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { CourseSection } from "@/lib/types/course-content";
import type { Resource, Problem } from "@/lib/types/course-content";
import { getVideoProgress, markVideoCompleted } from "@/lib/queries/video-progress";
import { getProblemAttempts } from "@/lib/queries/problem-progress";
import { getCourseSidebarOrder, saveCourseSidebarOrder } from "@/lib/queries/course-sidebar-order";
import {
  updateSectionTitle as updateCourseSectionTitle,
  updateResourceTitle as updateCourseResourceTitle,
} from "@/lib/actions/update-titles";
import YouTubePlayer from "./YouTubePlayer";
import MarkdownContent from "@/app/components/MarkdownContent";

interface Props {
  sections: CourseSection[];
  resources: Resource[];
  problems: Problem[];
  courseId: number;
  canEditContent?: boolean;
  initialLecture?: number;
  onExitPlayer?: () => void;
  onLectureChange?: (index: number) => void;
  isScholar?: boolean;
}

interface UnitGroup {
  unit: CourseSection;
  sessionIndices: number[]; // indices into visibleSections
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isGenericDownloadedVideoSectionTitle(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return false;
  if (normalized === "download file" || normalized === "download video") return true;
  if (/^video\s+\d+(?:\.\d+)?\s*(?:kb|mb|gb)\b/i.test(normalized)) return true;
  return false;
}

function sidebarSectionTitle(section: CourseSection, flatIndex: number, lectureSectionIndices: number[]): string {
  const normalized = normalizeWhitespace(section.title).toLowerCase();
  if (normalized !== "download file") return section.title;

  if (section.section_type === "lecture") {
    const lecturePos = lectureSectionIndices.indexOf(flatIndex);
    if (lecturePos >= 0) return `Lecture ${lecturePos + 1}`;
    return "Lecture";
  }
  if (section.section_type === "problem_set") return "Problem Set";
  if (section.section_type === "exam") return "Exam";
  if (section.section_type === "recitation") return "Recitation";
  return "Resource";
}

function applyManualSectionOrder(sections: CourseSection[], sectionIds: number[]): CourseSection[] {
  if (sectionIds.length === 0) return sections;

  const byId = new Map<number, CourseSection>(sections.map((section) => [section.id, section]));
  const ordered: CourseSection[] = [];
  const seen = new Set<number>();

  for (const id of sectionIds) {
    const section = byId.get(id);
    if (!section || seen.has(id)) continue;
    ordered.push(section);
    seen.add(id);
  }

  for (const section of sections) {
    if (seen.has(section.id)) continue;
    ordered.push(section);
  }

  return ordered;
}

function areSectionOrdersEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default function CoursePlayer({
  sections,
  resources,
  problems,
  courseId,
  canEditContent = false,
  initialLecture,
  onExitPlayer,
  onLectureChange,
  isScholar = false,
}: Props) {
  const isPlayerMode = !!onExitPlayer;
  const didAutoSelectFromProgress = useRef(false);
  const [manualSectionOrderIds, setManualSectionOrderIds] = useState<number[]>([]);
  const [savedSectionOrderIds, setSavedSectionOrderIds] = useState<number[]>([]);
  const [loadedOrderCourseId, setLoadedOrderCourseId] = useState<number | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [saveOrderMessage, setSaveOrderMessage] = useState<string | null>(null);
  const [isSortingSidebar, setIsSortingSidebar] = useState(false);

  const isOrderLoaded = loadedOrderCourseId === courseId;
  const [editableSections, setEditableSections] = useState<CourseSection[]>(sections);
  const [editableResources, setEditableResources] = useState<Resource[]>(resources);
  const [draftSectionTitle, setDraftSectionTitle] = useState("");
  const [draftResourceTitle, setDraftResourceTitle] = useState("");
  const [isSavingTitles, setIsSavingTitles] = useState(false);
  const [titleSaveMessage, setTitleSaveMessage] = useState<string | null>(null);

  // All sections in flat order (lectures + problem sets + exams interleaved)
  const allSections = useMemo(
    () => [...editableSections].sort((a, b) => a.ordering - b.ordering),
    [editableSections]
  );

  // Group resources by section ID
  const resourcesBySection = useMemo(() => {
    const map = new Map<number | null, Resource[]>();
    for (const r of editableResources) {
      if (!map.has(r.section_id)) map.set(r.section_id, []);
      map.get(r.section_id)!.push(r);
    }
    return map;
  }, [editableResources]);

  // Remove unit container sections and duplicate entries from navigation.
  const defaultVisibleSections = useMemo(
    () =>
      allSections.filter((section) => {
        // Skip unit container sections (Scholar) — they're grouping headers, not playable
        if (section.section_type === "unit") return false;

        if (section.section_type !== "lecture") return true;
        if (!isGenericDownloadedVideoSectionTitle(section.title)) return true;

        const sectionResources = resourcesBySection.get(section.id) ?? [];
        const videos = sectionResources.filter((r) => r.resource_type === "video");
        if (videos.length === 0) return true;
        return videos.some((video) => Boolean(video.youtube_id));
      }),
    [allSections, resourcesBySection]
  );

  useEffect(() => {
    let cancelled = false;

    void getCourseSidebarOrder(courseId).then((sectionIds) => {
      if (cancelled) return;
      setManualSectionOrderIds(sectionIds);
      setSavedSectionOrderIds(sectionIds);
      setLoadedOrderCourseId(courseId);
      setSaveOrderMessage(null);
    });

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const setDraftSidebarOrder = useCallback((sectionIds: number[]) => {
    setManualSectionOrderIds(sectionIds);
    setSaveOrderMessage(null);
  }, []);

  const visibleSections = useMemo(
    () => applyManualSectionOrder(defaultVisibleSections, manualSectionOrderIds),
    [defaultVisibleSections, manualSectionOrderIds]
  );

  // Scholar: group visible sections by their parent unit
  const scholarUnitGroups = useMemo<UnitGroup[]>(() => {
    if (!isScholar) return [];
    const unitSections = allSections.filter((s) => s.section_type === "unit");
    return unitSections.map((unit) => ({
      unit,
      sessionIndices: visibleSections
        .map((s, i) => (s.parent_id === unit.id ? i : -1))
        .filter((i) => i !== -1),
    })).filter((g) => g.sessionIndices.length > 0);
  }, [isScholar, allSections, visibleSections]);

  const currentVisibleOrderIds = useMemo(
    () => visibleSections.map((section) => section.id),
    [visibleSections]
  );

  const savedVisibleOrderIds = useMemo(
    () =>
      applyManualSectionOrder(defaultVisibleSections, savedSectionOrderIds).map(
        (section) => section.id
      ),
    [defaultVisibleSections, savedSectionOrderIds]
  );

  const hasUnsavedSidebarChanges = useMemo(
    () => !areSectionOrdersEqual(currentVisibleOrderIds, savedVisibleOrderIds),
    [currentVisibleOrderIds, savedVisibleOrderIds]
  );

  // Indices of lecture sections in visible order (for prev/next navigation)
  const lectureSectionIndices = useMemo(
    () => visibleSections
      .map((s, i) => (s.section_type === "lecture" ? i : -1))
      .filter((i) => i !== -1),
    [visibleSections]
  );

  // Map resource_id → Problem[] (for problem set sections)
  const problemsByResource = useMemo(() => {
    const map = new Map<number, Problem[]>();
    for (const p of problems) {
      if (!map.has(p.resource_id)) map.set(p.resource_id, []);
      map.get(p.resource_id)!.push(p);
    }
    return map;
  }, [problems]);

  // Map section ID → video resource (for progress tracking — all section types)
  const videoBySection = useMemo(() => {
    const map = new Map<number, Resource>();
    for (const section of visibleSections) {
      const sectionResources = resourcesBySection.get(section.id) ?? [];
      const video = sectionResources.find((r) => r.resource_type === "video");
      if (video) map.set(section.id, video);
    }
    return map;
  }, [visibleSections, resourcesBySection]);

  const problemIdsBySection = useMemo(() => {
    const map = new Map<number, number[]>();

    for (const section of visibleSections) {
      const sectionResources = resourcesBySection.get(section.id) ?? [];
      const problemIds = sectionResources.flatMap((resource) =>
        (problemsByResource.get(resource.id) ?? []).map((problem) => problem.id)
      );

      if (problemIds.length > 0) {
        map.set(section.id, problemIds);
      }
    }

    return map;
  }, [visibleSections, resourcesBySection, problemsByResource]);

  // Convert initialLecture (lecture-only index) to flat index
  const initialFlatIndex = useMemo(() => {
    if (initialLecture === undefined) return 0;
    return lectureSectionIndices[initialLecture] ?? 0;
  }, [initialLecture, lectureSectionIndices]);

  const [activeIndex, setActiveIndex] = useState(initialFlatIndex);
  const [completedVideos, setCompletedVideos] = useState<Set<number>>(new Set());
  const [attemptedProblemIds, setAttemptedProblemIds] = useState<Set<number>>(new Set());
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [manualPdfSelection, setManualPdfSelection] = useState<{
    sectionId: number;
    url: string;
    title: string;
  } | null>(null);
  const [dismissedAutoPdfSections, setDismissedAutoPdfSections] = useState<Set<number>>(new Set());

  const isSectionCompletable = useCallback(
    (section: CourseSection) => {
      return videoBySection.has(section.id) || (problemIdsBySection.get(section.id) ?? []).length > 0;
    },
    [problemIdsBySection, videoBySection]
  );

  const isSectionCompleted = useCallback(
    (
      section: CourseSection,
      videoSet = completedVideos,
      attemptedIds = attemptedProblemIds
    ) => {
      const video = videoBySection.get(section.id);
      const problemIds = problemIdsBySection.get(section.id) ?? [];

      // Nothing completable in this section
      if (!video && problemIds.length === 0) return false;

      // Must complete all present components
      if (video && !videoSet.has(video.id)) return false;
      if (problemIds.length > 0 && !problemIds.every((problemId) => attemptedIds.has(problemId))) return false;

      return true;
    },
    [attemptedProblemIds, completedVideos, problemIdsBySection, videoBySection]
  );

  useEffect(() => {
    setEditableSections(sections);
  }, [sections]);

  useEffect(() => {
    setEditableResources(resources);
  }, [resources]);

  useEffect(() => {
    didAutoSelectFromProgress.current = false;
    setTitleSaveMessage(null);
  }, [courseId]);

  // Fetch progress on mount
  useEffect(() => {
    void Promise.all([getVideoProgress(courseId), getProblemAttempts(courseId)]).then(
      ([videoSet, problemAttempts]) => {
        const attemptedIds = new Set(problemAttempts.keys());
        setCompletedVideos(videoSet);
        setAttemptedProblemIds(attemptedIds);
        setLoadingProgress(false);

        if (isPlayerMode && initialLecture === undefined && !didAutoSelectFromProgress.current) {
          const firstIncomplete = visibleSections.findIndex(
            (section) => !isSectionCompleted(section, videoSet, attemptedIds)
          );
          if (firstIncomplete !== -1) {
            setActiveIndex(firstIncomplete);
            didAutoSelectFromProgress.current = true;
          }
        }
      }
    );
  }, [courseId, initialLecture, isPlayerMode, isSectionCompleted, visibleSections]);

  const currentSection = visibleSections[activeIndex] ?? null;
  const currentResources = currentSection
    ? resourcesBySection.get(currentSection.id) ?? []
    : [];

  const isLecture = currentSection?.section_type === "lecture";
  const videos = currentResources.filter((r) => r.resource_type === "video");
  const notes = currentResources.filter((r) => r.resource_type === "lecture_notes");
  const pdfs = currentResources.filter((r) => r.pdf_path);
  const currentVideo = videos[0] ?? null;
  const primaryEditableResource = isLecture
    ? currentVideo
    : currentResources.find((resource) =>
        ["problem_set", "exam", "recitation"].includes(resource.resource_type)
      ) ?? pdfs[0] ?? currentResources[0] ?? null;
  const isCurrentCompleted = currentVideo ? completedVideos.has(currentVideo.id) : false;
  const firstPdf = pdfs[0];
  const firstPdfUrl = firstPdf?.pdf_path ?? null;
  const firstPdfTitle = firstPdf?.title ?? "PDF";

  let activePdf: { url: string; title: string } | null = null;
  if (currentSection) {
    if (manualPdfSelection?.sectionId === currentSection.id) {
      activePdf = {
        url: manualPdfSelection.url,
        title: manualPdfSelection.title,
      };
    } else if (!isLecture && firstPdfUrl && !dismissedAutoPdfSections.has(currentSection.id)) {
      activePdf = {
        url: firstPdfUrl,
        title: firstPdfTitle,
      };
    }
  }

  // Find prev/next lecture indices (skip non-lecture sections)
  const currentLecturePos = lectureSectionIndices.indexOf(activeIndex);
  const prevLectureIndex = currentLecturePos > 0
    ? lectureSectionIndices[currentLecturePos - 1]
    : undefined;
  const nextLectureIndex = currentLecturePos < lectureSectionIndices.length - 1
    ? lectureSectionIndices[currentLecturePos + 1]
    : undefined;

  const completableSections = visibleSections.filter((section) => isSectionCompletable(section));
  const completedCount = completableSections.filter((section) => isSectionCompleted(section)).length;

  useEffect(() => {
    setDraftSectionTitle(currentSection?.title ?? "");
  }, [currentSection?.id, currentSection?.title]);

  useEffect(() => {
    setDraftResourceTitle(primaryEditableResource?.title ?? "");
  }, [primaryEditableResource?.id, primaryEditableResource?.title]);

  async function handleSaveTitles() {
    if (!canEditContent || !currentSection || isSavingTitles) return;

    const nextSectionTitle = draftSectionTitle.trim();
    const nextResourceTitle = draftResourceTitle.trim();
    const sectionChanged = nextSectionTitle.length > 0 && nextSectionTitle !== currentSection.title;
    const resourceChanged =
      primaryEditableResource &&
      nextResourceTitle.length > 0 &&
      nextResourceTitle !== primaryEditableResource.title;

    if (!sectionChanged && !resourceChanged) {
      setTitleSaveMessage("No title changes to save.");
      return;
    }

    setIsSavingTitles(true);
    setTitleSaveMessage("Saving titles...");

    if (sectionChanged) {
      const savedSection = await updateCourseSectionTitle(currentSection.id, nextSectionTitle);
      if (!savedSection) {
        setIsSavingTitles(false);
        setTitleSaveMessage("Could not save section title.");
        return;
      }

      setEditableSections((currentItems) =>
        currentItems.map((section) =>
          section.id === savedSection.id ? { ...section, title: savedSection.title } : section
        )
      );
    }

    if (resourceChanged && primaryEditableResource) {
      const savedResource = await updateCourseResourceTitle(
        primaryEditableResource.id,
        nextResourceTitle
      );
      if (!savedResource) {
        setIsSavingTitles(false);
        setTitleSaveMessage("Could not save resource title.");
        return;
      }

      setEditableResources((currentItems) =>
        currentItems.map((resource) =>
          resource.id === savedResource.id ? { ...resource, title: savedResource.title } : resource
        )
      );
      setManualPdfSelection((currentSelection) => {
        if (!currentSelection || currentSelection.url !== primaryEditableResource.pdf_path) {
          return currentSelection;
        }

        return {
          ...currentSelection,
          title: savedResource.title,
        };
      });
    }

    setIsSavingTitles(false);
    setTitleSaveMessage("Saved titles.");
  }

  function goTo(flatIndex: number) {
    const section = visibleSections[flatIndex];
    if (!section) return;
    setActiveIndex(flatIndex);
    // Report lecture index for URL param (only for lectures)
    const lecturePos = lectureSectionIndices.indexOf(flatIndex);
    if (lecturePos !== -1) {
      onLectureChange?.(lecturePos);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleVideoEnded() {
    if (!currentVideo || completedVideos.has(currentVideo.id)) return;
    const success = await markVideoCompleted(currentVideo.id);
    if (success) {
      setCompletedVideos((prev) => {
        if (prev.has(currentVideo.id)) return prev;
        const next = new Set(prev);
        next.add(currentVideo.id);
        return next;
      });
    }
  }

  const selectPdf = useCallback((url: string, title: string) => {
    if (!currentSection) return;

    setManualPdfSelection({
      sectionId: currentSection.id,
      url,
      title,
    });

    setDismissedAutoPdfSections((prev) => {
      if (!prev.has(currentSection.id)) return prev;
      const next = new Set(prev);
      next.delete(currentSection.id);
      return next;
    });
  }, [currentSection]);

  const closeActivePdf = useCallback(() => {
    if (!currentSection) return;

    setManualPdfSelection((prev) => {
      if (!prev || prev.sectionId !== currentSection.id) return prev;
      return null;
    });

    if (isLecture) return;

    setDismissedAutoPdfSections((prev) => {
      if (prev.has(currentSection.id)) return prev;
      const next = new Set(prev);
      next.add(currentSection.id);
      return next;
    });
  }, [currentSection, isLecture]);

  const moveSidebarSection = useCallback(
    (sectionId: number, direction: -1 | 1) => {
      const currentIndex = visibleSections.findIndex((section) => section.id === sectionId);
      if (currentIndex === -1) return;

      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= visibleSections.length) return;

      const nextOrderIds = visibleSections.map((section) => section.id);
      const [moved] = nextOrderIds.splice(currentIndex, 1);
      nextOrderIds.splice(targetIndex, 0, moved);

      const activeSectionId = visibleSections[activeIndex]?.id;
      if (activeSectionId) {
        const nextActiveIndex = nextOrderIds.indexOf(activeSectionId);
        if (nextActiveIndex !== -1) {
          setActiveIndex(nextActiveIndex);
        }
      }

      setDraftSidebarOrder(nextOrderIds);
    },
    [activeIndex, setDraftSidebarOrder, visibleSections]
  );

  function resetSidebarOrder() {
    setDraftSidebarOrder([]);
  }

  async function handleSaveSidebarOrder() {
    if (isSavingOrder) return;
    setIsSavingOrder(true);
    setSaveOrderMessage(null);

    const orderToSave = visibleSections.map((section) => section.id);
    const result = await saveCourseSidebarOrder(courseId, orderToSave);

    setIsSavingOrder(false);
    if (!result.ok) {
      setSaveOrderMessage(result.message);
      return;
    }

    setSavedSectionOrderIds(orderToSave);
    setIsSortingSidebar(false);
    setSaveOrderMessage("Saved shared sidebar order.");
  }

  // Icon for section type in sidebar
  function sectionIcon(section: CourseSection, flatIndex: number) {
    const isCompleted = isSectionCompleted(section);

    if (isCompleted) {
      return (
        <svg className="h-4 w-4 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }

    if (section.section_type === "lecture") {
      const lecturePos = lectureSectionIndices.indexOf(flatIndex);
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-400 dark:border-zinc-600 dark:text-zinc-500">
          {lecturePos + 1}
        </span>
      );
    }

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
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Course Overview
        </button>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Content</p>
        <div className="flex items-center gap-2">
          {!loadingProgress && completableSections.length > 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {completedCount}/{completableSections.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsSortingSidebar((prev) => !prev)}
            disabled={!isOrderLoaded || isSavingOrder}
            className="rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
          >
            {isSortingSidebar ? "Done" : "Sort"}
          </button>
          {isSortingSidebar && (
            <button
              type="button"
              onClick={() => {
                void handleSaveSidebarOrder();
              }}
              disabled={!isOrderLoaded || !hasUnsavedSidebarChanges || isSavingOrder}
              className="rounded bg-[#750014] px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#5a0010] disabled:pointer-events-none disabled:opacity-50"
            >
              {isSavingOrder ? "Saving..." : "Save"}
            </button>
          )}
          {isSortingSidebar && (
            <button
              type="button"
              onClick={resetSidebarOrder}
              disabled={isSavingOrder}
              className="rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {!isOrderLoaded && (
        <p className="mb-2 px-3 text-xs text-zinc-500 dark:text-zinc-400">
          Loading shared sidebar order...
        </p>
      )}

      {saveOrderMessage && (
        <p className="mb-2 px-3 text-xs text-zinc-500 dark:text-zinc-400">
          {saveOrderMessage}
        </p>
      )}

      {isSortingSidebar && (
        <p className="mb-2 px-3 text-xs text-zinc-500 dark:text-zinc-400">
          Use arrows to move items up or down.
        </p>
      )}

      {isScholar && scholarUnitGroups.length > 0 ? (
        /* Scholar: unit-grouped sidebar */
        scholarUnitGroups.map((group) => {
          const unitHasActiveSession = group.sessionIndices.includes(activeIndex);
          return (
            <div key={group.unit.id} className="mb-2">
              <p className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${
                unitHasActiveSession ? "text-[#750014]" : "text-zinc-400 dark:text-zinc-500"
              }`}>
                {group.unit.title}
              </p>
              {group.sessionIndices.map((flatIdx, sessionNum) => {
                const section = visibleSections[flatIdx];
                const isActive = activeIndex === flatIdx;
                return (
                  <button
                    key={section.id}
                    onClick={() => goTo(flatIdx)}
                    className={`flex min-w-0 w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-[#750014]/10 font-medium text-[#750014]"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    }`}
                  >
                    {sectionIcon(section, flatIdx)}
                    <span className="min-w-0 truncate">{section.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })
      ) : (
        /* Non-Scholar: flat section list */
        visibleSections.map((section, i) => {
          const isActive = activeIndex === i;
          const displayTitle = sidebarSectionTitle(section, i, lectureSectionIndices);
          return (
            <div key={section.id} className="flex items-center gap-1">
              <button
                onClick={() => goTo(i)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-[#750014]/10 font-medium text-[#750014]"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                }`}
              >
                {sectionIcon(section, i)}
                <span className="min-w-0 truncate">{displayTitle}</span>
              </button>
              {isSortingSidebar && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move ${displayTitle} up`}
                    onClick={() => moveSidebarSection(section.id, -1)}
                    disabled={i === 0}
                    className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${displayTitle} down`}
                    onClick={() => moveSidebarSection(section.id, 1)}
                    disabled={i === visibleSections.length - 1}
                    className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
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
        {canEditContent && currentSection && (
          <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#750014]">
                  Dev editing
                </p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Rename the current section and its primary content title inline.
                </p>
              </div>
              {titleSaveMessage && (
                <p className="text-sm text-zinc-500">{titleSaveMessage}</p>
              )}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Section title</span>
                <input
                  value={draftSectionTitle}
                  onChange={(event) => setDraftSectionTitle(event.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {isLecture ? "Video title" : "Problem set file title"}
                </span>
                <input
                  value={draftResourceTitle}
                  onChange={(event) => setDraftResourceTitle(event.target.value)}
                  disabled={!primaryEditableResource}
                  placeholder={primaryEditableResource ? undefined : "No editable resource title here"}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-600"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  void handleSaveTitles();
                }}
                disabled={isSavingTitles}
                className="rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-60"
              >
                {isSavingTitles ? "Saving..." : "Save titles"}
              </button>
            </div>
          </div>
        )}

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
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
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
                    <button
                      key={note.id}
                      type="button"
                      onClick={() =>
                        note.pdf_path &&
                        selectPdf(
                          note.pdf_path,
                          note.title ?? `Lecture Notes ${i + 1}`
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                    >
                      <svg className="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      {notes.length === 1 ? "Lecture Notes" : `Lecture Notes ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {activePdf && (
              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {activePdf.title}
                  </span>
                  <div className="flex items-center gap-2">
                    <a
                      href={activePdf.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                    >
                      Open in new tab
                    </a>
                    <button
                      type="button"
                      onClick={closeActivePdf}
                      className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <iframe
                  src={activePdf.url}
                  title={activePdf.title}
                  className="h-[70vh] w-full"
                />
              </div>
            )}

            {/* Prev / Next navigation (lectures only) */}
            <div className="mt-8 flex items-center justify-between border-t border-zinc-200 pt-6 dark:border-zinc-700">
              <button
                onClick={() => prevLectureIndex !== undefined && goTo(prevLectureIndex)}
                disabled={prevLectureIndex === undefined}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Previous
              </button>

              <span className="text-sm text-zinc-400 dark:text-zinc-500">
                {currentLecturePos + 1} / {lectureSectionIndices.length}
              </span>

              <button
                onClick={() => nextLectureIndex !== undefined && goTo(nextLectureIndex)}
                disabled={nextLectureIndex === undefined}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Next
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* Non-lecture view (problem set / exam / recitation / notes) */}
        {!isLecture && currentSection && (() => {
          const markdownResources = currentResources.filter((r) => r.content_text);
          const fileResources = currentResources.filter((r) => r.pdf_path && !r.content_text);

          return (
            <>
              <h2 className="mb-4 text-xl font-semibold text-zinc-900">
                {currentSection.title}
              </h2>

              {/* Rendered markdown content */}
              {markdownResources.length > 0 && (
                <div className="space-y-4">
                  {markdownResources.map((resource) => (
                    <div key={resource.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-700 dark:bg-zinc-800">
                        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                          {resource.title}
                        </span>
                        {resource.pdf_path && (
                          <a
                            href={resource.pdf_path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                          >
                            View PDF
                          </a>
                        )}
                      </div>
                      <div className="max-h-[70vh] overflow-auto px-6 py-5">
                        <MarkdownContent>{resource.content_text!}</MarkdownContent>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* PDF fallback for resources without markdown */}
              {fileResources.length > 0 && (
                <ul className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
                  {fileResources.map((resource) => (
                    <li key={resource.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {resource.resource_type === "solution" ? "Solution" :
                         resource.resource_type === "problem_set" ? "Assignment" :
                         resource.resource_type === "exam" ? "Exam" :
                         resource.resource_type === "recitation" ? "Recitation" :
                         "File"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
                        {resource.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => resource.pdf_path && selectPdf(resource.pdf_path, resource.title)}
                        className="shrink-0 rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                      >
                        View PDF
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {markdownResources.length === 0 && fileResources.length === 0 && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No files available for this section.</p>
              )}

              {activePdf && (
                <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      {activePdf.title}
                    </span>
                    <div className="flex items-center gap-2">
                      <a
                        href={activePdf.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                      >
                        Open in new tab
                      </a>
                      <button
                        type="button"
                        onClick={closeActivePdf}
                        className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <iframe
                    src={activePdf.url}
                    title={activePdf.title}
                    className="h-[70vh] w-full"
                  />
                </div>
              )}
            </>
          );
        })()}

        {/* Mobile content nav */}
        <div className="mt-8 lg:hidden">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            All Content
          </p>
          <div className="flex flex-col gap-1">
            {isScholar && scholarUnitGroups.length > 0 ? (
              scholarUnitGroups.map((group) => (
                <div key={group.unit.id} className="mb-2">
                  <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    {group.unit.title}
                  </p>
                  {group.sessionIndices.map((flatIdx) => {
                    const section = visibleSections[flatIdx];
                    return (
                      <button
                        key={section.id}
                        onClick={() => goTo(flatIdx)}
                        className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                          activeIndex === flatIdx
                            ? "bg-[#750014]/10 font-medium text-[#750014]"
                            : "text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        {sectionIcon(section, flatIdx)}
                        <span className="min-w-0 truncate">{section.title}</span>
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              visibleSections.map((section, i) => (
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
                  <span className="min-w-0 truncate">
                    {sidebarSectionTitle(section, i, lectureSectionIndices)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
