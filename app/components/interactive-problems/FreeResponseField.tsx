"use client";

import { useInteractiveProblem } from "./context";
import MathInput from "./MathInput";
import MathText from "@/app/components/MathText";

interface Props {
  slotIndex: number;
  prompt: string;
  answer: string;
}

export default function FreeResponseField({ slotIndex, prompt, answer }: Props) {
  const { answers, setAnswer, phase, activeKeyboardMemoryRef } = useInteractiveProblem();
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
        <MathInput
          value={value}
          onChange={(latex) => setAnswer(slotIndex, latex)}
          onKeyboardMemoryReady={(km) => {
            if (activeKeyboardMemoryRef) {
              activeKeyboardMemoryRef.current = km;
            }
          }}
          placeholder="Type your answer here..."
          fullWidth
        />
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {value ? (
              <MathText>{value}</MathText>
            ) : (
              <span className="italic text-zinc-400">No answer provided</span>
            )}
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
