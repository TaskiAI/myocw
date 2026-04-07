"use client";

import { useInteractiveProblem } from "./context";
import MathInput from "./MathInput";
import MathText from "@/app/components/MathText";
import { latexAnswersMatch } from "@/lib/math/normalize-latex";

interface Props {
  slotIndex: number;
  answer: string;
}

export default function FillInBlankField({ slotIndex, answer }: Props) {
  const { answers, setAnswer, phase, activeKeyboardMemoryRef } = useInteractiveProblem();
  const value = answers[slotIndex] ?? "";
  const isAnswering = phase === "answering";

  // Check correctness: try LaTeX match first, then plain text
  const isCorrect =
    latexAnswersMatch(value, answer) ||
    value.trim().toLowerCase() === answer.trim().toLowerCase();

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
          {value ? (
            <MathText>{value}</MathText>
          ) : (
            <span className="italic text-zinc-400">blank</span>
          )}
        </span>
        {!isCorrect && (
          <span className="text-xs text-green-700 dark:text-green-400">
            <MathText>{answer}</MathText>
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-block align-middle">
      <MathInput
        value={value}
        onChange={(latex) => setAnswer(slotIndex, latex)}
        onKeyboardMemoryReady={(km) => {
          if (activeKeyboardMemoryRef) {
            activeKeyboardMemoryRef.current = km;
          }
        }}
        placeholder="..."
        className="text-sm"
      />
    </span>
  );
}
