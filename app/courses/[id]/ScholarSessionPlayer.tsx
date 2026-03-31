"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { CourseSection, Resource, Problem } from "@/lib/types/course-content";
import { getVideoProgress, markVideoCompleted } from "@/lib/queries/video-progress";
import {
  updateSectionTitle as updateCourseSectionTitle,
  updateResourceTitle as updateCourseResourceTitle,
  updateResourceContentText,
} from "@/lib/actions/update-titles";
import YouTubePlayer from "./YouTubePlayer";
import ProblemSetView from "./ProblemSetView";
import MarkdownContent from "@/app/components/MarkdownContent";

interface Props {
  sections: CourseSection[];
  resources: Resource[];
  problems: Problem[];
  courseId: number;
  canEditContent?: boolean;
  initialSession?: number; // 0-indexed session index
  initialShowUnitOverview?: boolean;
  onExitPlayer?: () => void;
  onSessionChange?: (index: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Resource-type icon                                                  */
/* ------------------------------------------------------------------ */

function ResourceIcon({ resource, completed }: { resource: Resource; completed: boolean }) {
  if (completed) {
    return (
      <svg className="h-4 w-4 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  switch (resource.resource_type) {
    case "video":
      return (
        <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      );
    case "recitation":
      return (
        <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
        </svg>
      );
    case "problem_set":
    case "exam":
      return (
        <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      );
    case "solution":
      return (
        <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    default:
      return (
        <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------------ */
/*  Resource type label                                                */
/* ------------------------------------------------------------------ */

function resourceTypeLabel(type: string): string {
  switch (type) {
    case "video": return "Lecture";
    case "recitation": return "Recitation";
    case "lecture_notes": return "Notes";
    case "reading": return "Reading";
    case "problem_set": return "Problems";
    case "solution": return "Solutions";
    case "exam": return "Exam";
    default: return "Resource";
  }
}

/* ------------------------------------------------------------------ */
/*  Strip OCW boilerplate lines from markdown content                   */
/* ------------------------------------------------------------------ */

const OCW_BOILERPLATE_PATTERNS = [
  /citing these materials/i,
  /terms of use/i,
  /ocw\.mit\.edu\/terms/i,
  /^MIT OpenCourseWare\s*(https?:\/\/)?ocw\.mit\.edu\s*$/i,
  /^\d+\.\d+\S*\s+.+\s+(Fall|Spring|Summer|January)\s+\d{4}\s*$/i,
];

function stripOcwBoilerplate(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return !OCW_BOILERPLATE_PATTERNS.some((p) => p.test(trimmed));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  ScholarSessionPlayer                                               */
/* ------------------------------------------------------------------ */

export default function ScholarSessionPlayer({
  sections,
  resources,
  problems,
  courseId,
  canEditContent = false,
  initialSession = 0,
  initialShowUnitOverview: initialShowOverview = false,
  onExitPlayer,
  onSessionChange,
}: Props) {
  const [editableSections, setEditableSections] = useState<CourseSection[]>(sections);
  const [editableResources, setEditableResources] = useState<Resource[]>(resources);
  const [draftSessionTitle, setDraftSessionTitle] = useState("");
  const [draftResourceTitle, setDraftResourceTitle] = useState("");
  const [editingContentText, setEditingContentText] = useState(false);
  const [draftContentText, setDraftContentText] = useState("");
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [isSavingTitles, setIsSavingTitles] = useState(false);
  const [titleSaveMessage, setTitleSaveMessage] = useState<string | null>(null);

  useEffect(() => { setEditableSections(sections); }, [sections]);
  useEffect(() => { setEditableResources(resources); }, [resources]);

  // All sections sorted by ordering
  const allSections = useMemo(
    () => [...editableSections].sort((a, b) => a.ordering - b.ordering),
    [editableSections]
  );

  // Sessions = non-unit leaf sections (playable content)
  const sessions = useMemo(
    () => allSections.filter((s) => s.section_type !== "unit"),
    [allSections]
  );

  // Resources grouped by section, sorted by ordering
  const resourcesBySection = useMemo(() => {
    const map = new Map<number, Resource[]>();
    for (const r of editableResources) {
      if (r.section_id == null) continue;
      if (!map.has(r.section_id)) map.set(r.section_id, []);
      map.get(r.section_id)!.push(r);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.ordering - b.ordering);
    }
    return map;
  }, [editableResources]);

  // Unit groups for sidebar TOC
  const unitGroups = useMemo(() => {
    const units = allSections.filter((s) => s.section_type === "unit");
    return units.map((unit) => ({
      unit,
      sessions: sessions.filter((s) => s.parent_id === unit.id),
    }));
  }, [allSections, sessions]);

  // Map session.id → global index in sessions array
  const sessionToGlobalIdx = useMemo(
    () => new Map(sessions.map((s, i) => [s.id, i])),
    [sessions]
  );

  /* --- State --- */
  const [sessionIdx, setSessionIdx] = useState(initialSession);
  const [resourceIdx, setResourceIdx] = useState(0);
  const [showUnitOverview, setShowUnitOverview] = useState(initialShowOverview);
  const [showSolution, setShowSolution] = useState(false);
  const [completedVideos, setCompletedVideos] = useState<Set<number>>(new Set());
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeSessionRef = useRef<HTMLButtonElement>(null);

  /* --- Derived --- */
  const currentSession = sessions[sessionIdx] ?? null;

  const sessionResources = useMemo(() => {
    if (!currentSession) return [];
    return resourcesBySection.get(currentSession.id) ?? [];
  }, [currentSession, resourcesBySection]);

  // Extract session overview (reading at ordering 0 titled "Session Overview")
  const sessionOverview = useMemo(() => {
    if (!currentSession) return null;
    const allRes = resourcesBySection.get(currentSession.id) ?? [];
    return allRes.find(
      (r) =>
        r.resource_type === "reading" &&
        r.ordering === 0 &&
        r.title?.toLowerCase().includes("session overview") &&
        r.content_text
    ) ?? null;
  }, [currentSession, resourcesBySection]);

  // Map each problem_set resource to its solution
  const solutionByProblemSet = useMemo(() => {
    const map = new Map<number, Resource>();
    for (let i = 0; i < sessionResources.length; i++) {
      const r = sessionResources[i];
      if (r.resource_type !== "problem_set") continue;
      const next = sessionResources[i + 1];
      if (next?.resource_type === "solution") {
        map.set(r.id, next);
      }
    }
    return map;
  }, [sessionResources]);

  const solutionIds = useMemo(
    () => new Set([...solutionByProblemSet.values()].map((r) => r.id)),
    [solutionByProblemSet]
  );

  const navigableResources = useMemo(
    () => sessionResources.filter((r) => !solutionIds.has(r.id)),
    [sessionResources, solutionIds]
  );

  const activeResource = navigableResources[resourceIdx] ?? null;
  const activeSolution = activeResource ? solutionByProblemSet.get(activeResource.id) ?? null : null;

  const parentUnit = useMemo(() => {
    if (!currentSession?.parent_id) return null;
    return allSections.find((s) => s.id === currentSession.parent_id) ?? null;
  }, [currentSession, allSections]);

  const unitOverviewResource = useMemo(() => {
    if (!parentUnit) return null;
    const unitRes = resourcesBySection.get(parentUnit.id) ?? [];
    return unitRes.find(
      (r) =>
        r.resource_type === "reading" &&
        r.ordering === 0 &&
        r.title?.toLowerCase().includes("unit overview") &&
        r.content_text
    ) ?? null;
  }, [parentUnit, resourcesBySection]);

  const unitSessions = useMemo(() => {
    if (!parentUnit) return [];
    return sessions.filter((s) => s.parent_id === parentUnit.id);
  }, [parentUnit, sessions]);

  const isLastResource = resourceIdx >= navigableResources.length - 1;
  const isFirstSession = sessionIdx === 0;
  const isLastSession = sessionIdx >= sessions.length - 1;
  const prevSession = !isFirstSession ? sessions[sessionIdx - 1] : null;
  const nextSession = !isLastSession ? sessions[sessionIdx + 1] : null;
  const prevSessionUnit = prevSession
    ? allSections.find((s) => s.id === prevSession.parent_id)
    : null;
  const nextSessionUnit = nextSession
    ? allSections.find((s) => s.id === nextSession.parent_id)
    : null;

  /* --- Effects --- */

  useEffect(() => {
    void getVideoProgress(courseId).then((videoSet) => {
      setCompletedVideos(videoSet);
      setProgressLoaded(true);
    });
  }, [courseId]);

  useEffect(() => {
    setResourceIdx(0);
    setShowSolution(false);
  }, [sessionIdx]);

  useEffect(() => {
    setShowSolution(false);
    setEditingContentText(false);
  }, [resourceIdx]);

  // Auto-expand current unit in sidebar
  useEffect(() => {
    if (parentUnit) {
      setExpandedUnits((prev) => {
        if (prev.has(parentUnit.id)) return prev;
        const next = new Set(prev);
        next.add(parentUnit.id);
        return next;
      });
    }
  }, [parentUnit]);

  // Scroll active session into view in sidebar
  useEffect(() => {
    activeSessionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sessionIdx]);

  // Close mobile drawer on session change
  useEffect(() => {
    setSidebarOpen(false);
  }, [sessionIdx]);

  // Check if a session is completed (has at least one completed resource)
  const isSessionCompleted = useCallback(
    (session: CourseSection) => {
      if (!progressLoaded) return false;
      const res = resourcesBySection.get(session.id) ?? [];
      const video = res.find((r) => r.resource_type === "video");
      return video ? completedVideos.has(video.id) : false;
    },
    [progressLoaded, resourcesBySection, completedVideos]
  );

  // Mark a document resource as completed
  const markDocumentCompleted = useCallback(
    (resource: Resource) => {
      if (resource.resource_type !== "reading" && resource.resource_type !== "lecture_notes") return;
      void markVideoCompleted(resource.id).then((success) => {
        if (success) {
          setCompletedVideos((prev) => {
            if (prev.has(resource.id)) return prev;
            const next = new Set(prev);
            next.add(resource.id);
            return next;
          });
        }
      });
    },
    []
  );

  /* --- Navigation --- */

  const goToSession = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= sessions.length) return;
      const current = navigableResources[resourceIdx];
      if (current) markDocumentCompleted(current);
      if (sessionOverview) markDocumentCompleted(sessionOverview);
      const currentParentId = sessions[sessionIdx]?.parent_id;
      const targetParentId = sessions[idx]?.parent_id;
      if (targetParentId && currentParentId !== targetParentId) {
        setShowUnitOverview(true);
      } else {
        setShowUnitOverview(false);
      }
      setSessionIdx(idx);
      onSessionChange?.(idx);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [sessions, sessionIdx, onSessionChange, navigableResources, resourceIdx, markDocumentCompleted, sessionOverview]
  );

  const goToNextSession = useCallback(() => {
    const nextIdx = sessionIdx + 1;
    if (nextIdx >= sessions.length) return;
    const current = navigableResources[resourceIdx];
    if (current) markDocumentCompleted(current);
    if (sessionOverview) markDocumentCompleted(sessionOverview);
    const currentParentId = sessions[sessionIdx]?.parent_id;
    const targetParentId = sessions[nextIdx]?.parent_id;
    if (targetParentId && targetParentId !== currentParentId) {
      setShowUnitOverview(true);
    }
    setSessionIdx(nextIdx);
    setResourceIdx(0);
    onSessionChange?.(nextIdx);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [sessions, sessionIdx, onSessionChange, navigableResources, resourceIdx, markDocumentCompleted, sessionOverview]);

  const goToPrevSession = useCallback(() => {
    const prevIdx = sessionIdx - 1;
    if (prevIdx < 0) return;
    const current = navigableResources[resourceIdx];
    if (current) markDocumentCompleted(current);
    if (sessionOverview) markDocumentCompleted(sessionOverview);
    const currentParentId = sessions[sessionIdx]?.parent_id;
    const targetParentId = sessions[prevIdx]?.parent_id;
    if (targetParentId && targetParentId !== currentParentId) {
      setShowUnitOverview(true);
    }
    setSessionIdx(prevIdx);
    setResourceIdx(0);
    onSessionChange?.(prevIdx);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [sessions, sessionIdx, onSessionChange, navigableResources, resourceIdx, markDocumentCompleted, sessionOverview]);

  const dismissUnitOverview = useCallback(() => {
    setShowUnitOverview(false);
  }, []);

  const goToSessionFromOverview = useCallback(
    (idx: number) => {
      setShowUnitOverview(false);
      if (idx < 0 || idx >= sessions.length) return;
      setSessionIdx(idx);
      onSessionChange?.(idx);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [sessions.length, onSessionChange]
  );

  const goToResource = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= navigableResources.length) return;
      const current = navigableResources[resourceIdx];
      if (current) markDocumentCompleted(current);
      setResourceIdx(idx);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [navigableResources, resourceIdx, markDocumentCompleted]
  );

  /* --- Video completion --- */

  const handleVideoEnded = useCallback(async () => {
    if (!activeResource) return;
    if (!activeResource.youtube_id && !activeResource.archive_url) return;
    if (completedVideos.has(activeResource.id)) return;

    const success = await markVideoCompleted(activeResource.id);
    if (success) {
      setCompletedVideos((prev) => {
        const next = new Set(prev);
        next.add(activeResource.id);
        return next;
      });
    }
  }, [activeResource, completedVideos]);

  const isResourceCompleted = useCallback(
    (resource: Resource) => completedVideos.has(resource.id),
    [completedVideos]
  );

  /* --- Title editing --- */

  useEffect(() => {
    setDraftSessionTitle(currentSession?.title ?? "");
  }, [currentSession?.id, currentSession?.title]);

  useEffect(() => {
    setDraftResourceTitle(activeResource?.title ?? "");
  }, [activeResource?.id, activeResource?.title]);

  useEffect(() => {
    setTitleSaveMessage(null);
  }, [courseId]);

  async function handleSaveTitles() {
    if (!canEditContent || !currentSession || isSavingTitles) return;
    const nextSessionTitle = draftSessionTitle.trim();
    const nextResourceTitle = draftResourceTitle.trim();
    const sessionChanged = nextSessionTitle.length > 0 && nextSessionTitle !== currentSession.title;
    const resourceChanged =
      activeResource &&
      nextResourceTitle.length > 0 &&
      nextResourceTitle !== activeResource.title;

    if (!sessionChanged && !resourceChanged) {
      setTitleSaveMessage("No title changes to save.");
      return;
    }

    setIsSavingTitles(true);
    setTitleSaveMessage("Saving titles...");

    if (sessionChanged) {
      const savedSection = await updateCourseSectionTitle(currentSession.id, nextSessionTitle);
      if (!savedSection) {
        setIsSavingTitles(false);
        setTitleSaveMessage("Could not save session title.");
        return;
      }
      setEditableSections((items) =>
        items.map((s) => (s.id === savedSection.id ? { ...s, title: savedSection.title } : s))
      );
    }

    if (resourceChanged && activeResource) {
      const savedResource = await updateCourseResourceTitle(activeResource.id, nextResourceTitle);
      if (!savedResource) {
        setIsSavingTitles(false);
        setTitleSaveMessage("Could not save resource title.");
        return;
      }
      setEditableResources((items) =>
        items.map((r) => (r.id === savedResource.id ? { ...r, title: savedResource.title } : r))
      );
    }

    setIsSavingTitles(false);
    setTitleSaveMessage("Saved titles.");
  }

  /* --- Sidebar toggle --- */

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

  /* --- Unit completion stats --- */

  const unitCompletionCount = useCallback(
    (unitSessions: CourseSection[]) => {
      if (!progressLoaded) return 0;
      return unitSessions.filter((s) => isSessionCompleted(s)).length;
    },
    [progressLoaded, isSessionCompleted]
  );

  /* --- Render the active resource --- */

  function renderActiveResource() {
    if (!activeResource) {
      return (
        <div className="rounded-xl bg-zinc-50 p-8 text-center dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No content available for this session.
          </p>
        </div>
      );
    }

    if (activeResource.youtube_id) {
      return (
        <div className="w-[60%]">
          <h2 className="mb-4 text-2xl font-light tracking-tight text-zinc-900 dark:text-zinc-100">
            {activeResource.title}
          </h2>
          <YouTubePlayer
            key={activeResource.youtube_id}
            youtubeId={activeResource.youtube_id}
            title={activeResource.title}
            onVideoEnded={handleVideoEnded}
          />
          {completedVideos.has(activeResource.id) && (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Completed
            </span>
          )}
        </div>
      );
    }

    if (activeResource.archive_url) {
      return (
        <div className="w-[60%]">
          <h2 className="mb-4 text-2xl font-light tracking-tight text-zinc-900 dark:text-zinc-100">
            {activeResource.title}
          </h2>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-700">
            <div className="relative aspect-video w-full">
              <video
                key={activeResource.archive_url}
                src={activeResource.archive_url}
                controls
                className="absolute inset-0 h-full w-full"
              >
                <track kind="captions" />
              </video>
            </div>
          </div>
          {completedVideos.has(activeResource.id) && (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Completed
            </span>
          )}
        </div>
      );
    }

    // Show ProblemSetView for problem_set resources that have interactive problems
    // (otherwise fall through to content_text rendering which uses MarkdownContent/rehype-katex)
    if (activeResource.resource_type === "problem_set") {
      const resourceProblems = problems.filter((p) => p.resource_id === activeResource.id);
      const hasInteractive = resourceProblems.some((p) =>
        /<(FillInBlank|MultipleChoice|FreeResponse)\s/.test(p.question_text)
      );
      if (hasInteractive && resourceProblems.length > 0) {
        const pdfResources = [activeResource, ...(activeSolution ? [activeSolution] : [])].filter(
          (r) => r.pdf_path
        );
        return (
          <ProblemSetView
            problems={resourceProblems}
            pdfResources={pdfResources}
            courseId={courseId}
            canEdit={canEditContent}
            defaultProblemResourceId={activeResource.id}
          />
        );
      }
    }

    if (activeResource.content_text) {
      return (
        <div>
          <div className="mb-6 flex items-center justify-end">
            {canEditContent && (
              <button
                onClick={() => {
                  if (editingContentText) {
                    setEditingContentText(false);
                  } else {
                    setDraftContentText(activeResource.content_text!);
                    setEditingContentText(true);
                  }
                }}
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
              >
                {editingContentText ? "Preview" : "Edit"}
              </button>
            )}
          </div>
          {editingContentText ? (
            <div>
              <textarea
                value={draftContentText}
                onChange={(e) => setDraftContentText(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 font-mono text-sm leading-relaxed text-zinc-900 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014]"
                rows={30}
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={async () => {
                    setIsSavingContent(true);
                    const ok = await updateResourceContentText(activeResource.id, draftContentText);
                    setIsSavingContent(false);
                    if (ok) {
                      activeResource.content_text = draftContentText;
                      setEditingContentText(false);
                    }
                  }}
                  disabled={isSavingContent}
                  className="rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-60"
                >
                  {isSavingContent ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditingContentText(false)}
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[75%]">
              <MarkdownContent>
                {stripOcwBoilerplate(activeResource.content_text)}
              </MarkdownContent>
            </div>
          )}
        </div>
      );
    }

    if (activeResource.pdf_path) {
      const displayingResource = showSolution && activeSolution?.pdf_path ? activeSolution : activeResource;
      return (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {displayingResource.title}
            </span>
            <div className="flex items-center gap-2">
              {activeSolution?.pdf_path && (
                <button
                  onClick={() => setShowSolution((prev) => !prev)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    showSolution
                      ? "bg-[#750014] text-white hover:bg-[#5a0010]"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                  }`}
                >
                  {showSolution ? "Back to Problems" : "View Solutions"}
                </button>
              )}
              <a
                href={displayingResource.pdf_path!}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              >
                Open in new tab
              </a>
            </div>
          </div>
          <iframe
            src={displayingResource.pdf_path!}
            title={displayingResource.title}
            className="aspect-[4/3] w-full max-h-[70vh]"
          />
        </div>
      );
    }

    return (
      <div className="rounded-xl bg-zinc-50 p-8 text-center dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No viewable content for this resource.
        </p>
      </div>
    );
  }

  /* --- Render unit overview --- */

  function renderUnitOverview() {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-black tracking-tight text-[#191c1d] dark:text-zinc-100">
            {parentUnit?.title}
          </h1>
        </div>

        {unitOverviewResource?.content_text && (
          <div className="mb-8 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {stripOcwBoilerplate(unitOverviewResource.content_text).split("\n\n").map((paragraph, i) => (
              <p key={i} className={i > 0 ? "mt-3" : ""}>
                {paragraph}
              </p>
            ))}
          </div>
        )}

        <div>
          <h3 className="text-sm font-bold text-[#191c1d] dark:text-zinc-100">
            Sessions in this unit
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            {unitSessions.length} session{unitSessions.length !== 1 ? "s" : ""}
          </p>
          <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
            {unitSessions.map((session, i) => {
              const globalIdx = sessions.indexOf(session);
              return (
                <button
                  key={session.id}
                  onClick={() => goToSessionFromOverview(globalIdx)}
                  className="group flex w-full items-center gap-4 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <span className="font-mono text-sm text-zinc-300 dark:text-zinc-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
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
        </div>

        <button
          onClick={dismissUnitOverview}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#810020] to-[#a31f34] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          Continue to Session
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    );
  }

  /* --- Sidebar content (shared between desktop + mobile drawer) --- */

  function renderSidebarContent() {
    return (
      <div className="flex h-full flex-col">
        {/* Back to overview */}
        {onExitPlayer && (
          <button
            onClick={onExitPlayer}
            className="mb-2 flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Course Overview
          </button>
        )}

        {/* Current unit header or standalone section header */}
        {parentUnit ? (
          <div className="px-4 pb-2">
            {unitOverviewResource ? (
              <button
                onClick={() => setShowUnitOverview(true)}
                className="text-left text-xs font-bold uppercase tracking-wider text-[#810020]/60 transition-colors hover:text-[#810020]"
              >
                {parentUnit.title}
              </button>
            ) : (
              <span className="text-xs font-bold uppercase tracking-wider text-[#810020]/60">
                {parentUnit.title}
              </span>
            )}
            {progressLoaded && (
              <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                {unitCompletionCount(unitSessions)}/{unitSessions.length} completed
              </p>
            )}
          </div>
        ) : currentSession && (
          <div className="px-4 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#810020]/60">
              {currentSession.title}
            </span>
          </div>
        )}

        <div className="mx-4 mb-2 h-px bg-zinc-200 dark:bg-zinc-700" />

        {/* Sessions in current unit */}
        <nav className="flex-1 overflow-y-auto pb-4">
          {/* Show navigable resources when viewing a standalone section (no parent unit) */}
          {!parentUnit && navigableResources.length > 0 ? (
            <>
              {navigableResources.map((res, idx) => {
                const isActive = idx === resourceIdx;
                return (
                  <button
                    key={res.id}
                    onClick={() => setResourceIdx(idx)}
                    className={`flex w-full items-center gap-2 py-2 pl-4 pr-4 text-left text-[13px] transition-colors ${
                      isActive
                        ? "border-l-2 border-[#750014] bg-[#750014]/5 font-medium text-[#750014]"
                        : "border-l-2 border-transparent text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100"
                    }`}
                  >
                    {res.resource_type === "video" ? (
                      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                      </svg>
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{res.title}</span>
                  </button>
                );
              })}
              {navigableResources.length > 1 && (
                <div className="mx-4 mt-3 flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <button
                    onClick={() => setResourceIdx((i) => Math.max(0, i - 1))}
                    disabled={resourceIdx === 0}
                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {resourceIdx + 1} / {navigableResources.length}
                  </span>
                  <button
                    onClick={() => setResourceIdx((i) => Math.min(navigableResources.length - 1, i + 1))}
                    disabled={isLastResource}
                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {unitSessions.map((session) => {
                const globalIdx = sessionToGlobalIdx.get(session.id) ?? 0;
                const isActive = globalIdx === sessionIdx && !showUnitOverview;
                const completed = isSessionCompleted(session);
                return (
                  <button
                    key={session.id}
                    ref={isActive ? activeSessionRef : undefined}
                    onClick={() => goToSession(globalIdx)}
                    className={`flex w-full items-center gap-2 py-2 pl-4 pr-4 text-left text-[13px] transition-colors ${
                      isActive
                        ? "border-l-2 border-[#750014] bg-[#750014]/5 font-medium text-[#750014]"
                        : "border-l-2 border-transparent text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100"
                    }`}
                  >
                    {completed ? (
                      <svg className="h-3.5 w-3.5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{session.title}</span>
                  </button>
                );
              })}
              {sessions.length > 1 && (
                <div className="mx-4 mt-3 flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <button
                    onClick={() => goToSession(sessionIdx - 1)}
                    disabled={sessionIdx === 0}
                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {sessionIdx + 1} / {sessions.length}
                  </span>
                  <button
                    onClick={() => goToSession(sessionIdx + 1)}
                    disabled={sessionIdx >= sessions.length - 1}
                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
        </nav>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="flex">
      {/* ---- Desktop sidebar ---- */}
      <aside
        className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white pt-4 lg:block dark:border-zinc-700 dark:bg-zinc-950"
      >
        {renderSidebarContent()}
      </aside>

      {/* ---- Mobile sidebar drawer ---- */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-white pt-4 shadow-xl dark:bg-zinc-950">
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Navigation</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* ---- Main area ---- */}
      <div className="min-w-0 flex-1">
        {/* Horizontal resource tab bar */}
        {!showUnitOverview && (
          <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/95">
            {/* Session title + mobile menu button */}
            <div className="flex items-center gap-3 px-4 pt-3 lg:px-8">
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 lg:hidden dark:hover:bg-zinc-800"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
              <span className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {currentSession?.title}
              </span>
            </div>

            {/* Chevron-shaped resource tabs */}
            <div className="flex overflow-x-auto px-4 py-2 lg:px-8" style={{ scrollbarWidth: "none" }}>
              {navigableResources.map((resource, i) => {
                const isActive = i === resourceIdx;
                const completed = isResourceCompleted(resource);
                const isFirst = i === 0;
                const isLast = i === navigableResources.length - 1;
                // Chevron arrow shape: flat left edge on first, pointed on rest; pointed right on all but last
                const clipFirst = "polygon(0% 0%, calc(100% - 14px) 0%, 100% 50%, calc(100% - 14px) 100%, 0% 100%)";
                const clipMiddle = "polygon(0% 0%, calc(100% - 14px) 0%, 100% 50%, calc(100% - 14px) 100%, 0% 100%, 14px 50%)";
                const clipLast = "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 14px 50%)";
                const clipOnly = "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)";
                const clip = navigableResources.length === 1
                  ? clipOnly
                  : isFirst
                    ? clipFirst
                    : isLast
                      ? clipLast
                      : clipMiddle;
                return (
                  <button
                    key={resource.id}
                    onClick={() => goToResource(i)}
                    className={`relative inline-flex shrink-0 items-center gap-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900"
                        : completed
                          ? "bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-600"
                          : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                    }`}
                    style={{
                      clipPath: clip,
                      paddingLeft: isFirst ? "16px" : "24px",
                      paddingRight: isLast ? "16px" : "24px",
                      paddingTop: "12px",
                      paddingBottom: "12px",
                      marginLeft: i > 0 ? "-14px" : undefined,
                    }}
                  >
                    <ResourceIcon resource={resource} completed={!isActive && completed} />
                    <div className="flex flex-col items-start leading-tight">
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${isActive ? "text-zinc-300 dark:text-zinc-500" : "text-zinc-400 dark:text-zinc-500"}`}>
                        {resourceTypeLabel(resource.resource_type)}
                      </span>
                      <span>{resource.title}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="px-4 py-6 lg:px-8">
          {showUnitOverview ? (
            renderUnitOverview()
          ) : (
            <>
              {canEditContent && currentSession && (
                <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#750014]">
                        Dev editing
                      </p>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Rename the current session and its active resource title inline.
                      </p>
                    </div>
                    {titleSaveMessage && (
                      <p className="text-sm text-zinc-500">{titleSaveMessage}</p>
                    )}
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Session title</span>
                      <input
                        value={draftSessionTitle}
                        onChange={(e) => setDraftSessionTitle(e.target.value)}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Resource title</span>
                      <input
                        value={draftResourceTitle}
                        onChange={(e) => setDraftResourceTitle(e.target.value)}
                        disabled={!activeResource}
                        placeholder={activeResource ? undefined : "No active resource"}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-600"
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => { void handleSaveTitles(); }}
                      disabled={isSavingTitles}
                      className="rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-60"
                    >
                      {isSavingTitles ? "Saving..." : "Save titles"}
                    </button>
                  </div>
                </div>
              )}

              {activeResource && (activeResource.youtube_id || activeResource.archive_url) ? (
                <div className="flex gap-6">
                  {renderActiveResource()}
                  <div className="flex flex-1 flex-col pt-1">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Interactive Questions
                    </h3>
                    <div className="mt-3 border-t border-zinc-200 dark:border-zinc-700" />
                    <p className="mt-3 text-sm text-zinc-400 dark:text-zinc-500">Coming soon</p>
                  </div>
                </div>
              ) : (
                renderActiveResource()
              )}

              {/* Prev / Next navigation */}
              {navigableResources.length > 1 || prevSession || nextSession ? (
                <div className="mt-8 flex items-stretch gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-700">
                  {/* Left: prev resource, or prev session if at first resource */}
                  {resourceIdx > 0 ? (
                    <button
                      onClick={() => goToResource(resourceIdx - 1)}
                      className="group flex flex-1 items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-left transition-all duration-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50 active:scale-[0.98] dark:border-blue-800 dark:bg-blue-950/30 dark:hover:border-blue-700 dark:hover:shadow-blue-900/30"
                    >
                      <div className="flex items-center gap-3">
                        <svg className="h-4 w-4 shrink-0 text-blue-700 transition-transform duration-200 group-hover:-translate-x-1 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                        <span className="max-w-[200px] truncate text-sm font-semibold text-blue-800 dark:text-blue-300">
                          {navigableResources[resourceIdx - 1].title}
                        </span>
                      </div>
                    </button>
                  ) : prevSession ? (
                    <button
                      onClick={goToPrevSession}
                      className="group flex flex-1 items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-left transition-all duration-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50 active:scale-[0.98] dark:border-blue-800 dark:bg-blue-950/30 dark:hover:border-blue-700 dark:hover:shadow-blue-900/30"
                    >
                      <div className="flex items-center gap-3">
                        <svg className="h-4 w-4 shrink-0 text-blue-700 transition-transform duration-200 group-hover:-translate-x-1 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                        <span className="max-w-[200px] truncate text-sm font-semibold text-blue-800 dark:text-blue-300">
                          {prevSession.title}
                        </span>
                      </div>
                    </button>
                  ) : <div className="flex-1" />}

                  {/* Right: next resource, or next session if at last resource, or "Course complete" */}
                  {resourceIdx < navigableResources.length - 1 ? (
                    <button
                      onClick={() => goToResource(resourceIdx + 1)}
                      className="group flex flex-1 items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-left transition-all duration-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50 active:scale-[0.98] dark:border-blue-800 dark:bg-blue-950/30 dark:hover:border-blue-700 dark:hover:shadow-blue-900/30"
                    >
                      <span className="max-w-[200px] truncate text-sm font-semibold text-blue-800 dark:text-blue-300">
                        {navigableResources[resourceIdx + 1].title}
                      </span>
                      <svg className="h-4 w-4 shrink-0 text-blue-700 transition-transform duration-200 group-hover:translate-x-1 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  ) : nextSession ? (
                    <button
                      onClick={goToNextSession}
                      className="group flex flex-1 items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-left transition-all duration-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50 active:scale-[0.98] dark:border-blue-800 dark:bg-blue-950/30 dark:hover:border-blue-700 dark:hover:shadow-blue-900/30"
                    >
                      <span className="max-w-[200px] truncate text-sm font-semibold text-blue-800 dark:text-blue-300">
                        {nextSession.title}
                      </span>
                      <svg className="h-4 w-4 shrink-0 text-blue-700 transition-transform duration-200 group-hover:translate-x-1 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  ) : (
                    <div className="flex flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                      <span className="text-sm font-medium text-zinc-400 dark:text-zinc-500">
                        Course complete
                      </span>
                    </div>
                  )}
                </div>
              ) : null}


            </>
          )}
        </div>
      </div>
    </div>
  );
}
