"use client";

import { useInteractiveProblem } from "./context";
import MathText from "@/app/components/MathText";

interface Props {
  slotIndex: number;
  options: string[];
  answer: string;
}

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export default function MultipleChoiceField({ slotIndex, options, answer }: Props) {
  const { answers, setAnswer, phase } = useInteractiveProblem();
  const selected = answers[slotIndex] ?? "";
  const isAnswering = phase === "answering";

  return (
    <div className="my-3 space-y-2">
      {options.map((option, i) => {
        const label = LABELS[i] ?? String(i + 1);
        const isSelected = selected === option;
        const isCorrectOption = option === answer;
        const showResult = !isAnswering;

        let borderClass =
          "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600";
        let bgClass = "bg-white dark:bg-zinc-900";

        if (isSelected && isAnswering) {
          borderClass = "border-[#750014] ring-1 ring-[#750014]";
        }

        if (showResult && isCorrectOption) {
          borderClass = "border-green-500";
          bgClass = "bg-green-50 dark:bg-green-950/30";
        } else if (showResult && isSelected && !isCorrectOption) {
          borderClass = "border-red-400";
          bgClass = "bg-red-50 dark:bg-red-950/30";
        }

        return (
          <button
            key={`${slotIndex}-opt-${i}`}
            type="button"
            onClick={() => isAnswering && setAnswer(slotIndex, option)}
            disabled={!isAnswering}
            className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${borderClass} ${bgClass} disabled:cursor-default`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                isSelected
                  ? "border-[#750014] bg-[#750014] text-white"
                  : "border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
              }`}
            >
              {label}
            </span>
            <div className="pt-0.5 text-zinc-800 dark:text-zinc-200">
              <MathText>{option}</MathText>
            </div>
            {showResult && isCorrectOption && (
              <span className="ml-auto shrink-0 pt-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                ✓
              </span>
            )}
            {showResult && isSelected && !isCorrectOption && (
              <span className="ml-auto shrink-0 pt-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                ✗
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
