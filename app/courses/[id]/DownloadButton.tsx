"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  courseId: number;
  userLanguage: string | null;
}

const DownloadIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

export default function DownloadButton({ courseId, userLanguage }: Props) {
  const [open, setOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const showDropdown = userLanguage && userLanguage !== "English" && userLanguage !== "Other";

  async function handleTranslatedDownload() {
    if (!userLanguage) return;
    setOpen(false);
    setTranslating(true);
    setProgress(null);

    try {
      // Trigger translation
      const res = await fetch(`/api/courses/${courseId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: userLanguage }),
      });

      if (!res.ok) {
        throw new Error("Translation request failed");
      }

      // Read streaming progress
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.status === "error") {
                throw new Error(data.error);
              }
              setProgress({ done: data.done, total: data.total });
            } catch (e) {
              if (e instanceof Error && e.message !== "Translation request failed") {
                // JSON parse error, skip
              }
            }
          }
        }
      }

      // Translation complete — trigger download
      window.location.href = `/api/courses/${courseId}/download?lang=${encodeURIComponent(userLanguage)}`;
    } catch (err) {
      console.error("Translation failed:", err);
    } finally {
      setTranslating(false);
      setProgress(null);
    }
  }

  // Simple button for English / no language set
  if (!showDropdown) {
    return (
      <a
        href={`/api/courses/${courseId}/download`}
        className="inline-flex items-center gap-2 rounded-lg bg-[#1a56db] px-8 py-4 font-bold text-white transition-colors hover:bg-[#1648c7] dark:bg-[#1a56db] dark:hover:bg-[#1648c7]"
      >
        {DownloadIcon}
        Download Course
      </a>
    );
  }

  // Translating state
  if (translating) {
    const pct = progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
    return (
      <div className="inline-flex items-center gap-3 rounded-lg bg-[#1a56db] px-8 py-4 font-bold text-white">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
        </svg>
        {progress && progress.total > 0
          ? `Translating... ${pct}%`
          : "Preparing translation..."}
      </div>
    );
  }

  // Dropdown for non-English users
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#1a56db] px-8 py-4 font-bold text-white transition-colors hover:bg-[#1648c7] dark:bg-[#1a56db] dark:hover:bg-[#1648c7]"
      >
        {DownloadIcon}
        Download Course
        <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <a
            href={`/api/courses/${courseId}/download`}
            className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
            onClick={() => setOpen(false)}
          >
            {DownloadIcon}
            Download in English
          </a>
          <button
            onClick={handleTranslatedDownload}
            className="flex w-full items-center gap-3 border-t border-zinc-100 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
            </svg>
            Download in {userLanguage}
          </button>
        </div>
      )}
    </div>
  );
}
