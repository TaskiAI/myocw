"use client";

import MarkdownContent from "@/app/components/MarkdownContent";

export interface CodingStep {
  label: string;
  title: string;
  instructions: string;
  test_snippet: string;
}

interface Props {
  step: CodingStep;
}

export default function CodingStepCard({ step }: Props) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <MarkdownContent>{step.instructions}</MarkdownContent>
    </div>
  );
}
