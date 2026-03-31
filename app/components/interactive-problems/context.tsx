"use client";

import { createContext, useContext } from "react";
import type { ComponentSlot } from "./parse-tags";

export type Phase = "answering" | "reviewing" | "graded";

export interface InteractiveProblemContextValue {
  slots: ComponentSlot[];
  answers: Record<number, string>;
  setAnswer: (slotIndex: number, value: string) => void;
  phase: Phase;
}

const InteractiveProblemContext =
  createContext<InteractiveProblemContextValue | null>(null);

export function InteractiveProblemProvider({
  children,
  ...value
}: InteractiveProblemContextValue & { children: React.ReactNode }) {
  return (
    <InteractiveProblemContext.Provider value={value}>
      {children}
    </InteractiveProblemContext.Provider>
  );
}

export function useInteractiveProblem() {
  const ctx = useContext(InteractiveProblemContext);
  if (!ctx) throw new Error("useInteractiveProblem must be inside InteractiveProblemProvider");
  return ctx;
}
