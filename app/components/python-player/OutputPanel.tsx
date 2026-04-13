"use client";

import { useEffect, useRef } from "react";
import type { OutputLine, PyodideStatus } from "./usePyodide";

interface Props {
  output: OutputLine[];
  status: PyodideStatus;
}

export default function OutputPanel({ output, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output.length]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-zinc-950 dark:border-zinc-700">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <span className="text-xs font-medium text-zinc-400">Output</span>
        <StatusDot status={status} />
      </div>

      {/* Terminal output */}
      <pre className="flex-1 overflow-auto p-3 font-mono text-sm leading-relaxed">
        {output.length === 0 && status === "ready" && (
          <span className="text-zinc-600">
            Press Run or Cmd+Enter to execute your code.
          </span>
        )}
        {output.length === 0 && status === "loading" && (
          <span className="text-zinc-600">Loading Python runtime...</span>
        )}
        {output.map((line, i) => (
          <div
            key={i}
            className={
              line.stream === "stderr" ? "text-red-400" : "text-zinc-200"
            }
          >
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </pre>
    </div>
  );
}

function StatusDot({ status }: { status: PyodideStatus }) {
  if (status === "loading") {
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-500">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
        Loading Python...
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-400">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        Running...
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="flex items-center gap-1 text-xs text-green-500">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
        Ready
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
        Error
      </span>
    );
  }
  return null;
}
