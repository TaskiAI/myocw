"use client";

import { useInteractiveProblem } from "./context";
import MathText from "@/app/components/MathText";

interface Props {
  slotIndex: number;
  prompt: string;
  answer: string;
}

export default function FreeResponseField({ slotIndex, prompt, answer }: Props) {
  const { answers, setAnswer, phase } = useInteractiveProblem();
  const value = answers[slotIndex] ?? "";
  const isAnswering = phase === "answering";

  return (
    <div className="my-3">
      {prompt && (
        <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <MathText>{prompt}</MathText>
        </div>
      )}

      {isAnswering ? (
        <textarea
          value={value}
          onChange={(e) => setAnswer(slotIndex, e.target.value)}
          placeholder="Type your answer here..."
          rows={4}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-1 focus:ring-[#750014] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {value || <span className="italic text-zinc-400">No answer provided</span>}
          </div>
          {answer && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 dark:border-green-900/50 dark:bg-green-950/30">
              <p className="mb-1 text-xs font-medium text-green-700 dark:text-green-400">Solution</p>
              <div className="text-sm text-zinc-800 dark:text-zinc-300">
                <MathText>{answer}</MathText>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
