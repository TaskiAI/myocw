"use client";

import { useState } from "react";
import type { Problem, SelfGrade, UserProblemAttempt } from "@/lib/types/course-content";
import { submitProblemAttempt } from "@/lib/queries/problem-progress";

interface Props {
  problem: Problem;
  existingAttempt?: UserProblemAttempt;
  onAttemptSubmitted: (problemId: number, attempt: UserProblemAttempt) => void;
}

type Phase = "answering" | "reviewing" | "graded";

const GRADE_OPTIONS: { value: SelfGrade; label: string; color: string }[] = [
  { value: "correct", label: "Correct", color: "bg-green-100 text-green-800 border-green-300" },
  { value: "partially_correct", label: "Partially Correct", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { value: "incorrect", label: "Incorrect", color: "bg-red-100 text-red-800 border-red-300" },
  { value: "unsure", label: "Unsure", color: "bg-zinc-100 text-zinc-700 border-zinc-300" },
];

function gradeBadge(grade: SelfGrade) {
  const option = GRADE_OPTIONS.find((o) => o.value === grade);
  if (!option) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${option.color}`}>
      {option.label}
    </span>
  );
}

export default function ProblemCard({ problem, existingAttempt, onAttemptSubmitted }: Props) {
  const [phase, setPhase] = useState<Phase>(existingAttempt ? "graded" : "answering");
  const [answer, setAnswer] = useState(existingAttempt?.answer_text ?? "");
  const [currentGrade, setCurrentGrade] = useState<SelfGrade | null>(existingAttempt?.self_grade ?? null);
  const [submitting, setSubmitting] = useState(false);

  async function handleGrade(grade: SelfGrade) {
    setSubmitting(true);
    const success = await submitProblemAttempt(problem.id, answer, grade);
    setSubmitting(false);

    if (success) {
      setCurrentGrade(grade);
      setPhase("graded");
      onAttemptSubmitted(problem.id, {
        id: 0,
        user_id: "",
        problem_id: problem.id,
        answer_text: answer,
        self_grade: grade,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  function handleTryAgain() {
    setAnswer("");
    setCurrentGrade(null);
    setPhase("answering");
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      {/* Problem header */}
      <div className="border-b border-zinc-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-500">
            Problem {problem.problem_label}
          </h3>
          {phase === "graded" && currentGrade && gradeBadge(currentGrade)}
        </div>
      </div>

      {/* Problem text */}
      <div className="px-6 py-4">
        <div className="prose prose-sm max-w-none text-zinc-800 whitespace-pre-wrap">
          {problem.question_text}
        </div>
      </div>

      {/* Answer area */}
      <div className="border-t border-zinc-100 px-6 py-4">
        {phase === "answering" && (
          <>
            <label className="mb-2 block text-sm font-medium text-zinc-700">
              Your Answer
            </label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer here..."
              rows={5}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014]"
            />
            <button
              type="button"
              onClick={() => setPhase("reviewing")}
              disabled={!answer.trim()}
              className="mt-3 rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Show Solution
            </button>
          </>
        )}

        {phase === "reviewing" && (
          <>
            {/* User's answer (read-only) */}
            <div className="mb-4">
              <p className="mb-1 text-sm font-medium text-zinc-700">Your Answer</p>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap">
                {answer}
              </div>
            </div>

            {/* Solution */}
            {problem.solution_text && (
              <div className="mb-4">
                <p className="mb-1 text-sm font-medium text-green-700">Solution</p>
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap">
                  {problem.solution_text}
                </div>
              </div>
            )}

            {/* Self-grade buttons */}
            <p className="mb-2 text-sm font-medium text-zinc-700">How did you do?</p>
            <div className="flex flex-wrap gap-2">
              {GRADE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleGrade(option.value)}
                  disabled={submitting}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:opacity-80 disabled:opacity-50 ${option.color}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === "graded" && (
          <>
            {/* User's answer (read-only) */}
            <div className="mb-4">
              <p className="mb-1 text-sm font-medium text-zinc-700">Your Answer</p>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap">
                {existingAttempt?.answer_text ?? answer}
              </div>
            </div>

            {/* Solution */}
            {problem.solution_text && (
              <div className="mb-4">
                <p className="mb-1 text-sm font-medium text-green-700">Solution</p>
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap">
                  {problem.solution_text}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleTryAgain}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
