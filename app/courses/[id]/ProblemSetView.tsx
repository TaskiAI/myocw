"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Problem, UserProblemAttempt } from "@/lib/types/course-content";
import type { Resource } from "@/lib/types/course-content";
import { getProblemAttempts } from "@/lib/queries/problem-progress";
import {
  createCourseProblem,
  deleteCourseProblem,
  updateCourseProblem,
} from "@/lib/actions/problem-editor";
import ProblemCard from "./ProblemCard";

interface Props {
  problems: Problem[];
  pdfResources: Resource[];
  courseId: number;
  canEdit?: boolean;
  defaultProblemResourceId?: number | null;
  onProblemAttempted?: (problemId: number) => void;
}

function pillIcon(attempt: UserProblemAttempt | undefined): string | null {
  if (!attempt) return null;
  switch (attempt.self_grade) {
    case "correct":
      return "\u2713"; // ✓
    case "partially_correct":
      return "~";
    case "incorrect":
      return "\u2717"; // ✗
    case "unsure":
      return "?";
    default:
      return null;
  }
}

function sortProblems(items: Problem[]): Problem[] {
  return [...items].sort((left, right) => {
    if (left.ordering !== right.ordering) return left.ordering - right.ordering;
    return left.id - right.id;
  });
}

export default function ProblemSetView({
  problems,
  pdfResources,
  courseId,
  canEdit = false,
  defaultProblemResourceId = null,
  onProblemAttempted,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [attempts, setAttempts] = useState<Map<number, UserProblemAttempt>>(new Map());
  const [showPdf, setShowPdf] = useState(false);
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);
  const [editableProblems, setEditableProblems] = useState<Problem[]>(() => sortProblems(problems));
  const [editingProblemId, setEditingProblemId] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftQuestionText, setDraftQuestionText] = useState("");
  const [draftSolutionText, setDraftSolutionText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isAddingProblem, setIsAddingProblem] = useState(false);
  const [isDeletingProblem, setIsDeletingProblem] = useState(false);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);

  useEffect(() => {
    getProblemAttempts(courseId).then(setAttempts);
  }, [courseId]);

  useEffect(() => {
    setEditableProblems(sortProblems(problems));
  }, [problems]);

  useEffect(() => {
    setActiveIndex((currentIndex) => {
      if (editableProblems.length === 0) return 0;
      return Math.min(currentIndex, editableProblems.length - 1);
    });
  }, [editableProblems.length]);

  const handleAttemptSubmitted = useCallback(
    (problemId: number, attempt: UserProblemAttempt) => {
      setAttempts((prev) => {
        const next = new Map(prev);
        next.set(problemId, attempt);
        return next;
      });
      onProblemAttempted?.(problemId);
    },
    [onProblemAttempted]
  );

  const activeProblem = editableProblems[activeIndex] ?? null;

  const completedCount = editableProblems.filter((problem) => attempts.has(problem.id)).length;
  const fallbackResourceId = useMemo(
    () => activeProblem?.resource_id ?? defaultProblemResourceId ?? null,
    [activeProblem, defaultProblemResourceId]
  );
  const isEditingActiveProblem = editingProblemId === activeProblem?.id;

  function beginEditing(problem: Problem) {
    setEditingProblemId(problem.id);
    setDraftLabel(problem.problem_label);
    setDraftQuestionText(problem.question_text);
    setDraftSolutionText(problem.solution_text ?? "");
    setEditorMessage(null);
  }

  function cancelEditing() {
    setEditingProblemId(null);
    setDraftLabel("");
    setDraftQuestionText("");
    setDraftSolutionText("");
    setEditorMessage(null);
  }

  async function handleSaveProblemEdits() {
    if (!activeProblem || !isEditingActiveProblem || isSavingEdit) return;

    setIsSavingEdit(true);
    setEditorMessage("Saving edits...");

    const savedProblem = await updateCourseProblem(
      activeProblem.id,
      {
        problemLabel: draftLabel,
        questionText: draftQuestionText,
        solutionText: draftSolutionText,
      },
      activeProblem.ordering
    );

    setIsSavingEdit(false);

    if (!savedProblem) {
      setEditorMessage("Could not save edits. Check the dev account session and RLS policy.");
      return;
    }

    setEditableProblems((currentProblems) =>
      sortProblems(
        currentProblems.map((problem) =>
          problem.id === savedProblem.id ? savedProblem : problem
        )
      )
    );
    setEditorMessage("Saved problem changes.");
    setEditingProblemId(null);
  }

  async function handleAddProblem() {
    if (isAddingProblem || fallbackResourceId === null) return;

    setIsAddingProblem(true);
    setEditorMessage("Adding question...");

    const nextOrdering = editableProblems.length
      ? Math.max(...editableProblems.map((problem) => problem.ordering)) + 1
      : 0;

    const createdProblem = await createCourseProblem({
      courseId,
      resourceId: fallbackResourceId,
      problemLabel: `Problem ${editableProblems.length + 1}`,
      questionText: "",
      solutionText: null,
      ordering: nextOrdering,
    });

    setIsAddingProblem(false);

    if (!createdProblem) {
      setEditorMessage("Could not add question. Check the dev account session and RLS policy.");
      return;
    }

    const nextProblems = sortProblems([...editableProblems, createdProblem]);
    const nextIndex = nextProblems.findIndex((problem) => problem.id === createdProblem.id);

    setEditableProblems(nextProblems);
    setActiveIndex(nextIndex >= 0 ? nextIndex : nextProblems.length - 1);
    beginEditing(createdProblem);
    setEditorMessage("New question added. Fill in the prompt and solution, then save.");
  }

  async function handleDeleteProblem() {
    if (!activeProblem || isDeletingProblem) return;

    const confirmed = window.confirm(
      `Delete ${activeProblem.problem_label || `Problem ${activeIndex + 1}`}?`
    );
    if (!confirmed) return;

    setIsDeletingProblem(true);
    setEditorMessage("Deleting question...");

    const deleted = await deleteCourseProblem(activeProblem.id);
    setIsDeletingProblem(false);

    if (!deleted) {
      setEditorMessage("Could not delete question. Check the dev account session and RLS policy.");
      return;
    }

    const nextProblems = editableProblems.filter(
      (problem) => problem.id !== activeProblem.id
    );

    setEditableProblems(nextProblems);
    setActiveIndex((currentIndex) =>
      nextProblems.length === 0
        ? 0
        : Math.max(0, Math.min(currentIndex - 1, nextProblems.length - 1))
    );
    cancelEditing();
    setEditorMessage("Question deleted.");
  }

  if (!activeProblem && !canEdit) return null;

  return (
    <div>
      {/* Progress summary */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {completedCount} of {editableProblems.length} attempted
        </p>
        {canEdit && (
          <div className="flex items-center gap-2">
            {editorMessage && (
              <span className="text-xs text-zinc-500">{editorMessage}</span>
            )}
            <button
              type="button"
              onClick={() => {
                void handleAddProblem();
              }}
              disabled={isAddingProblem || fallbackResourceId === null}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            >
              {isAddingProblem ? "Adding..." : "Add question"}
            </button>
            {activeProblem && !isEditingActiveProblem && (
              <button
                type="button"
                onClick={() => beginEditing(activeProblem)}
                className="rounded-lg bg-[#750014] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#5a0010]"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {!activeProblem && canEdit && (
        <div className="mb-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          No questions yet for this resource. Use “Add question” to create the first one.
        </div>
      )}

      {/* Problem nav strip */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {editableProblems.map((problem, i) => {
          const attempt = attempts.get(problem.id);
          const isActive = i === activeIndex;
          const icon = pillIcon(attempt);
          return (
            <button
              key={problem.id}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={`flex h-8 min-w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white px-2 text-xs font-medium transition-colors whitespace-nowrap dark:border-zinc-700 dark:bg-zinc-900 ${
                isActive ? "ring-2 ring-[#750014] ring-offset-1 dark:ring-offset-zinc-950" : ""
              }`}
            >
              <span className="text-zinc-600 dark:text-zinc-400">{i + 1}</span>
              {icon && (
                <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-500">{icon}</span>
              )}
            </button>
          );
        })}
      </div>

      {canEdit && activeProblem && isEditingActiveProblem && (
        <div className="mb-4 rounded-xl border border-[#750014]/20 bg-[#750014]/5 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Question label</span>
              <input
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
                placeholder={`Problem ${activeIndex + 1}`}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Problem text</span>
              <textarea
                value={draftQuestionText}
                onChange={(event) => setDraftQuestionText(event.target.value)}
                rows={8}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Solution</span>
              <textarea
                value={draftSolutionText}
                onChange={(event) => setDraftSolutionText(event.target.value)}
                rows={8}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleSaveProblemEdits();
              }}
              disabled={isSavingEdit}
              className="rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-60"
            >
              {isSavingEdit ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDeleteProblem();
              }}
              disabled={isDeletingProblem}
              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
            >
              {isDeletingProblem ? "Deleting..." : "Delete question"}
            </button>
          </div>
        </div>
      )}

      {/* Active problem card */}
      {activeProblem && (
        <ProblemCard
          key={`${activeProblem.id}-${attempts.get(activeProblem.id)?.attempted_at ?? "new"}`}
          problem={activeProblem}
          existingAttempt={attempts.get(activeProblem.id)}
          onAttemptSubmitted={handleAttemptSubmitted}
        />
      )}

      {/* Prev / Next */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
          disabled={activeIndex === 0}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Previous
        </button>
        <span className="text-sm text-zinc-400 dark:text-zinc-500">
          {editableProblems.length === 0 ? 0 : activeIndex + 1} / {editableProblems.length}
        </span>
        <button
          type="button"
          onClick={() => setActiveIndex((i) => Math.min(editableProblems.length - 1, i + 1))}
          disabled={editableProblems.length === 0 || activeIndex === editableProblems.length - 1}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Next
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* View Original PDF */}
      {pdfResources.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setShowPdf(!showPdf)}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <svg
              className={`h-4 w-4 transition-transform ${showPdf ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            View Original PDFs
          </button>

          {showPdf && (
            <div className="mt-3">
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
                {pdfResources.map((resource) => (
                  <li key={resource.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {resource.resource_type === "solution"
                        ? "Solution"
                        : resource.resource_type === "problem_set"
                        ? "Assignment"
                        : resource.resource_type === "exam"
                        ? "Exam"
                        : "File"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
                      {resource.title}
                    </span>
                    {resource.pdf_path && (
                      <button
                        type="button"
                        onClick={() =>
                          setActivePdfUrl(
                            activePdfUrl === resource.pdf_path ? null : resource.pdf_path
                          )
                        }
                        className="shrink-0 rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                      >
                        {activePdfUrl === resource.pdf_path ? "Hide" : "View PDF"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {activePdfUrl && (
                <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">PDF Preview</span>
                    <div className="flex items-center gap-2">
                      <a
                        href={activePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                      >
                        Open in new tab
                      </a>
                      <button
                        type="button"
                        onClick={() => setActivePdfUrl(null)}
                        className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <iframe
                    src={activePdfUrl}
                    title="PDF Preview"
                    className="h-[70vh] w-full"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
