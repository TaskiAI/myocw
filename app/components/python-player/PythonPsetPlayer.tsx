"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { usePyodide } from "./usePyodide";
import { useCodePersistence } from "./useCodePersistence";
import OutputPanel from "./OutputPanel";
import CodingStepCard from "./CodingStepCard";
import type { CodingStep } from "./CodingStepCard";

// CodeMirror accesses document — must skip SSR
const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });

interface Props {
  courseId: number;
  psetId: string;
  templateCodeUrl: string;
  resourceFiles?: { name: string; url: string }[];
  steps?: CodingStep[];
}

export default function PythonPsetPlayer({
  courseId,
  psetId,
  templateCodeUrl,
  resourceFiles,
  steps,
}: Props) {
  // --- Stepped mode ---
  if (steps && steps.length > 0) {
    return (
      <SteppedPlayer
        courseId={courseId}
        psetId={psetId}
        templateCodeUrl={templateCodeUrl}
        steps={steps}
        resourceFiles={resourceFiles}
      />
    );
  }

  // --- Fallback: full-template mode ---
  return (
    <FullTemplatePlayer
      courseId={courseId}
      psetId={psetId}
      templateCodeUrl={templateCodeUrl}
      resourceFiles={resourceFiles}
    />
  );
}

// --- Stepped player: one shared editor, steps swap instructions + tests ---

function SteppedPlayer({
  courseId,
  psetId,
  templateCodeUrl,
  steps,
  resourceFiles,
}: {
  courseId: number;
  psetId: string;
  templateCodeUrl: string;
  steps: CodingStep[];
  resourceFiles?: { name: string; url: string }[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [templateCode, setTemplateCode] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  const activeStep = steps[activeIndex];
  const { status, output, runCode, clearOutput } = usePyodide();
  const { savedCode, saveCode, clearSavedCode } = useCodePersistence(
    courseId,
    psetId
  );

  // Fetch template and initialize code
  useEffect(() => {
    fetch(templateCodeUrl)
      .then((r) => r.text())
      .then((text) => {
        setTemplateCode(text);
        if (!initialized) {
          setCode(savedCode ?? text);
          setInitialized(true);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateCodeUrl]);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      saveCode(newCode);
    },
    [saveCode]
  );

  const handleRunTests = useCallback(() => {
    // Run the full script + this step's test snippet
    const fullCode = `${code}\n\n# --- Tests for: ${activeStep.title} ---\n${activeStep.test_snippet}`;
    runCode(fullCode, resourceFiles);
  }, [runCode, code, activeStep, resourceFiles]);

  const handleReset = useCallback(() => {
    if (!templateCode) return;
    if (!confirm("Reset to original template? Your changes will be lost."))
      return;
    setCode(templateCode);
    clearSavedCode();
    clearOutput();
  }, [templateCode, clearSavedCode, clearOutput]);

  if (!initialized) {
    return (
      <div className="flex h-96 items-center justify-center text-zinc-500">
        Loading problem set...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Nav strip */}
      <div className="flex overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        {steps.map((step, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={step.label}
              type="button"
              onClick={() => setActiveIndex(i)}
              title={`Step ${step.label}: ${step.title}`}
              className={`flex shrink-0 items-center gap-1.5 border-r border-zinc-200 px-3 py-2.5 text-xs font-medium transition-colors last:border-r-0 dark:border-zinc-700 ${
                isActive
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <span
                className={`tabular-nums font-bold ${
                  isActive
                    ? "text-[#750014]"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={`whitespace-nowrap ${
                  isActive
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {step.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Instructions for active step */}
      <CodingStepCard step={activeStep} />

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleRunTests}
          disabled={status === "loading" || status === "running"}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Run Tests
        </button>

        <button
          onClick={handleReset}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Reset
        </button>

        <span className="ml-auto text-xs text-zinc-500">
          {status === "loading" && "Loading Python runtime..."}
          {status === "ready" && "Cmd+Enter to run tests"}
          {status === "running" && "Running..."}
        </span>
      </div>

      {/* Editor + Output split */}
      <div className="flex min-h-0 flex-col gap-2 md:flex-row" style={{ height: "55vh" }}>
        <div className="min-h-0 flex-[3]">
          <CodeEditor
            value={code}
            onChange={handleCodeChange}
            onRun={handleRunTests}
          />
        </div>
        <div className="min-h-0 flex-[2]">
          <OutputPanel output={output} status={status} />
        </div>
      </div>

      {/* Prev / Next */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
          disabled={activeIndex === 0}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Previous
        </button>
        <span className="text-sm text-zinc-400 dark:text-zinc-500">
          {activeIndex + 1} / {steps.length}
        </span>
        <button
          type="button"
          onClick={() => setActiveIndex((i) => Math.min(steps.length - 1, i + 1))}
          disabled={activeIndex === steps.length - 1}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:pointer-events-none dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Next
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// --- Original full-template player ---

function FullTemplatePlayer({
  courseId,
  psetId,
  templateCodeUrl,
  resourceFiles,
}: {
  courseId: number;
  psetId: string;
  templateCodeUrl: string;
  resourceFiles?: { name: string; url: string }[];
}) {
  const [templateCode, setTemplateCode] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  const { status, output, runCode, clearOutput } = usePyodide();
  const { savedCode, saveCode, clearSavedCode } = useCodePersistence(
    courseId,
    psetId
  );

  // Fetch template code
  useEffect(() => {
    fetch(templateCodeUrl)
      .then((r) => r.text())
      .then((text) => {
        setTemplateCode(text);
        // Use saved code if available, otherwise template
        if (!initialized) {
          setCode(savedCode ?? text);
          setInitialized(true);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateCodeUrl]);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      saveCode(newCode);
    },
    [saveCode]
  );

  const handleRun = useCallback(() => {
    runCode(code, resourceFiles);
  }, [runCode, code, resourceFiles]);

  const handleReset = useCallback(() => {
    if (!templateCode) return;
    if (!confirm("Reset to original template? Your changes will be lost."))
      return;
    setCode(templateCode);
    clearSavedCode();
    clearOutput();
  }, [templateCode, clearSavedCode, clearOutput]);

  if (!initialized) {
    return (
      <div className="flex h-96 items-center justify-center text-zinc-500">
        Loading problem set...
      </div>
    );
  }

  return (
    <div className="flex h-[75vh] flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleRun}
          disabled={status === "loading" || status === "running"}
          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          <svg
            className="h-4 w-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          Run
        </button>

        <button
          onClick={handleReset}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Reset
        </button>

        <span className="ml-auto text-xs text-zinc-500">
          {status === "loading" && "Loading Python runtime..."}
          {status === "ready" && "Cmd+Enter to run"}
          {status === "running" && "Running..."}
        </span>
      </div>

      {/* Editor + Output split */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
        {/* Editor */}
        <div className="min-h-0 flex-[3]">
          <CodeEditor
            value={code}
            onChange={handleCodeChange}
            onRun={handleRun}
          />
        </div>

        {/* Output */}
        <div className="min-h-0 flex-[2]">
          <OutputPanel output={output} status={status} />
        </div>
      </div>
    </div>
  );
}
