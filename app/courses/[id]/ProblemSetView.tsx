"use client";

import { useState, useEffect, useCallback } from "react";
import type { Problem, UserProblemAttempt } from "@/lib/types/course-content";
import type { Resource } from "@/lib/types/course-content";
import { getProblemAttempts } from "@/lib/queries/problem-progress";
import ProblemCard from "./ProblemCard";

interface Props {
  problems: Problem[];
  pdfResources: Resource[];
  courseId: number;
}

function pillColor(attempt: UserProblemAttempt | undefined): string {
  if (!attempt) return "bg-zinc-100 text-zinc-600 border-zinc-200";
  switch (attempt.self_grade) {
    case "correct":
      return "bg-green-100 text-green-800 border-green-300";
    case "partially_correct":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "incorrect":
      return "bg-red-100 text-red-800 border-red-300";
    case "unsure":
      return "bg-zinc-200 text-zinc-700 border-zinc-400";
    default:
      return "bg-zinc-100 text-zinc-600 border-zinc-200";
  }
}

export default function ProblemSetView({ problems, pdfResources, courseId }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [attempts, setAttempts] = useState<Map<number, UserProblemAttempt>>(new Map());
  const [showPdf, setShowPdf] = useState(false);
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);

  useEffect(() => {
    getProblemAttempts(courseId).then(setAttempts);
  }, [courseId]);

  const handleAttemptSubmitted = useCallback(
    (problemId: number, attempt: UserProblemAttempt) => {
      setAttempts((prev) => {
        const next = new Map(prev);
        next.set(problemId, attempt);
        return next;
      });
    },
    []
  );

  const activeProblem = problems[activeIndex];
  if (!activeProblem) return null;

  const completedCount = problems.filter((p) => attempts.has(p.id)).length;

  return (
    <div>
      {/* Progress summary */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {completedCount} of {problems.length} attempted
        </p>
      </div>

      {/* Problem nav strip */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {problems.map((problem, i) => {
          const attempt = attempts.get(problem.id);
          const isActive = i === activeIndex;
          return (
            <button
              key={problem.id}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-medium transition-colors ${
                isActive
                  ? "ring-2 ring-[#750014] ring-offset-1"
                  : ""
              } ${pillColor(attempt)}`}
            >
              {problem.problem_label}
            </button>
          );
        })}
      </div>

      {/* Active problem card */}
      <ProblemCard
        key={activeProblem.id}
        problem={activeProblem}
        existingAttempt={attempts.get(activeProblem.id)}
        onAttemptSubmitted={handleAttemptSubmitted}
      />

      {/* Prev / Next */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
          disabled={activeIndex === 0}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Previous
        </button>
        <span className="text-sm text-zinc-400">
          {activeIndex + 1} / {problems.length}
        </span>
        <button
          type="button"
          onClick={() => setActiveIndex((i) => Math.min(problems.length - 1, i + 1))}
          disabled={activeIndex === problems.length - 1}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          Next
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* View Original PDF */}
      {pdfResources.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-4">
          <button
            type="button"
            onClick={() => setShowPdf(!showPdf)}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
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
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
                {pdfResources.map((resource) => (
                  <li key={resource.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                      {resource.resource_type === "solution"
                        ? "Solution"
                        : resource.resource_type === "problem_set"
                        ? "Assignment"
                        : resource.resource_type === "exam"
                        ? "Exam"
                        : "File"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-900">
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
                        className="shrink-0 rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
                      >
                        {activePdfUrl === resource.pdf_path ? "Hide" : "View PDF"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {activePdfUrl && (
                <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                  <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
                    <span className="text-sm font-medium text-zinc-700">PDF Preview</span>
                    <div className="flex items-center gap-2">
                      <a
                        href={activePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
                      >
                        Open in new tab
                      </a>
                      <button
                        type="button"
                        onClick={() => setActivePdfUrl(null)}
                        className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
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
