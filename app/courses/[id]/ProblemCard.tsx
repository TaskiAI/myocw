"use client";

import { useState, useCallback, useMemo, type ReactNode } from "react";
import type { Problem, SelfGrade, UserProblemAttempt } from "@/lib/types/course-content";
import { submitProblemAttempt } from "@/lib/queries/problem-progress";
import MathText from "@/app/components/MathText";
import {
  tokenizeInteractiveComponents,
  hasInteractiveTags,
} from "@/app/components/interactive-problems/parse-tags";
import type { ComponentSlot } from "@/app/components/interactive-problems/parse-tags";
import { InteractiveProblemProvider } from "@/app/components/interactive-problems/context";
import FillInBlankField from "@/app/components/interactive-problems/FillInBlankField";
import MultipleChoiceField from "@/app/components/interactive-problems/MultipleChoiceField";
import FreeResponseField from "@/app/components/interactive-problems/FreeResponseField";

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
const MATH_CONTENT_CLASS =
  "prose prose-sm max-w-none text-zinc-800 whitespace-pre-wrap break-words dark:text-zinc-300";

function gradeBadge(grade: SelfGrade) {
  const option = GRADE_OPTIONS.find((o) => o.value === grade);
  if (!option) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${option.color}`}>
      {option.label}
    </span>
  );
}

function parseExistingAnswers(
  answerText: string | undefined,
  isInteractive: boolean
): Record<number, string> {
  if (!answerText || !isInteractive) return {};
  try {
    const parsed = JSON.parse(answerText);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // Not JSON — legacy single-answer format
  }
  return {};
}

function SolutionBlock({ problem }: { problem: Problem }) {
  const [showExplanation, setShowExplanation] = useState(false);

  if (!problem.solution_text && !problem.explanation_text) {
    return (
      <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
        sorry, solutions are not available at this point
      </div>
    );
  }

  return (
    <div className="mb-4">
      {problem.solution_text && (
        <>
          <p className="mb-1 text-sm font-medium text-green-700">Solution</p>
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <div className={MATH_CONTENT_CLASS}>
              <MathText>{problem.solution_text}</MathText>
            </div>
          </div>
        </>
      )}
      {problem.explanation_text && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowExplanation((v) => !v)}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
          >
            {showExplanation ? "Hide Explanation" : "Show Explanation"}
          </button>
          {showExplanation && (
            <div className="mt-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950">
              <div className={MATH_CONTENT_CLASS}>
                <MathText>{problem.explanation_text}</MathText>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProblemCard({ problem, existingAttempt, onAttemptSubmitted }: Props) {
  const isInteractive = useMemo(
    () => hasInteractiveTags(problem.question_text),
    [problem.question_text]
  );

  const { cleaned, slots } = useMemo(() => {
    if (!isInteractive) return { cleaned: problem.question_text, slots: [] as ComponentSlot[] };
    return tokenizeInteractiveComponents(problem.question_text);
  }, [problem.question_text, isInteractive]);

  const [phase, setPhase] = useState<Phase>(existingAttempt ? "graded" : "answering");

  // Classic mode: single answer string
  const [answer, setAnswer] = useState(existingAttempt?.answer_text ?? "");

  // Interactive mode: per-slot answers
  const [interactiveAnswers, setInteractiveAnswers] = useState<Record<number, string>>(() =>
    parseExistingAnswers(existingAttempt?.answer_text, isInteractive)
  );

  const [currentGrade, setCurrentGrade] = useState<SelfGrade | null>(existingAttempt?.self_grade ?? null);
  const [submitting, setSubmitting] = useState(false);

  const setSlotAnswer = useCallback((slotIndex: number, value: string) => {
    setInteractiveAnswers((prev) => ({ ...prev, [slotIndex]: value }));
  }, []);

  const hasAnyAnswer = isInteractive
    ? Object.values(interactiveAnswers).some((v) => v.trim())
    : answer.trim().length > 0;

  const answerPayload = isInteractive
    ? JSON.stringify(interactiveAnswers)
    : answer;

  const renderComponent = useCallback(
    (slotIndex: number, key: string): ReactNode => {
      const slot = slots[slotIndex];
      if (!slot) return null;

      switch (slot.type) {
        case "FillInBlank":
          return <FillInBlankField key={key} slotIndex={slotIndex} answer={slot.answer} />;
        case "MultipleChoice":
          return (
            <MultipleChoiceField
              key={key}
              slotIndex={slotIndex}
              options={slot.options ?? []}
              answer={slot.answer}
            />
          );
        case "FreeResponse":
          return (
            <FreeResponseField
              key={key}
              slotIndex={slotIndex}
              prompt={slot.prompt ?? ""}
              answer={slot.answer}
            />
          );
        default:
          return null;
      }
    },
    [slots]
  );

  async function handleGrade(grade: SelfGrade) {
    setSubmitting(true);
    const success = await submitProblemAttempt(problem.id, answerPayload, grade);
    setSubmitting(false);

    if (success) {
      setCurrentGrade(grade);
      setPhase("graded");
      onAttemptSubmitted(problem.id, {
        id: 0,
        user_id: "",
        problem_id: problem.id,
        answer_text: answerPayload,
        self_grade: grade,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  function handleTryAgain() {
    if (isInteractive) {
      setInteractiveAnswers({});
    } else {
      setAnswer("");
    }
    setCurrentGrade(null);
    setPhase("answering");
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* Problem header */}
      <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            Problem {problem.problem_label}
          </h3>
          {phase === "graded" && currentGrade && gradeBadge(currentGrade)}
        </div>
      </div>

      {/* Problem text */}
      <div className="px-6 py-4">
        <div className={MATH_CONTENT_CLASS}>
          {isInteractive ? (
            <InteractiveProblemProvider
              slots={slots}
              answers={interactiveAnswers}
              setAnswer={setSlotAnswer}
              phase={phase}
            >
              <MathText
                componentSlots={slots}
                renderComponent={renderComponent}
              >
                {cleaned}
              </MathText>
            </InteractiveProblemProvider>
          ) : (
            <MathText>{problem.question_text}</MathText>
          )}
        </div>
      </div>

      {/* Answer area */}
      <div className="border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
        {phase === "answering" && (
          <>
            {/* Classic textarea — only for non-interactive problems */}
            {!isInteractive && (
              <>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Your Answer
                </label>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer here..."
                  rows={5}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </>
            )}
            <button
              type="button"
              onClick={() => setPhase("reviewing")}
              disabled={!hasAnyAnswer}
              className="mt-3 rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Show Solution
            </button>
          </>
        )}

        {phase === "reviewing" && (
          <>
            {/* Classic answer display — only for non-interactive */}
            {!isInteractive && (
              <div className="mb-4">
                <p className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Your Answer</p>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {answer}
                </div>
              </div>
            )}

            {/* Solution + explanation */}
            {(problem.solution_text || !isInteractive) && <SolutionBlock problem={problem} />}

            {/* Self-grade buttons */}
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">How did you do?</p>
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
            {/* Classic answer display — only for non-interactive */}
            {!isInteractive && (
              <div className="mb-4">
                <p className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Your Answer</p>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {existingAttempt?.answer_text ?? answer}
                </div>
              </div>
            )}

            {/* Solution + explanation */}
            {(problem.solution_text || !isInteractive) && <SolutionBlock problem={problem} />}

            <button
              type="button"
              onClick={handleTryAgain}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
