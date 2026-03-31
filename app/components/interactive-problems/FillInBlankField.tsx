"use client";

import { useInteractiveProblem } from "./context";
import MathText from "@/app/components/MathText";

interface Props {
  slotIndex: number;
  answer: string;
}

export default function FillInBlankField({ slotIndex, answer }: Props) {
  const { answers, setAnswer, phase } = useInteractiveProblem();
  const value = answers[slotIndex] ?? "";
  const isAnswering = phase === "answering";
  const isCorrect = value.trim().toLowerCase() === answer.trim().toLowerCase();

  if (!isAnswering) {
    return (
      <span className="inline-flex items-baseline gap-1">
        <span
          className={`inline-block rounded border-b-2 px-2 py-0.5 text-sm font-medium ${
            isCorrect
              ? "border-green-500 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300"
              : "border-red-400 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          {value || <span className="italic text-zinc-400">blank</span>}
        </span>
        {!isCorrect && (
          <span className="text-xs text-green-700 dark:text-green-400">{answer}</span>
        )}
      </span>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setAnswer(slotIndex, e.target.value)}
      placeholder="..."
      style={{ width: `${Math.max(answer.length * 0.65, 3)}em` }}
      className="inline-block rounded border border-zinc-300 bg-white px-2 py-0.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
    />
  );
}
