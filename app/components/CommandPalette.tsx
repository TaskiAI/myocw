"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CURRICULA_TRACKS } from "@/lib/data/curricula";

interface SearchResult {
  id: string;
  type: "course" | "curriculum" | "page";
  title: string;
  subtitle?: string;
  href: string;
}

const QUICK_LINKS: SearchResult[] = [
  { id: "page-courses", type: "page", title: "All Courses", href: "/courses" },
  { id: "page-my-courses", type: "page", title: "My Courses", href: "/my-courses" },
  { id: "page-curricula", type: "page", title: "Curricula", href: "/curricula" },
  { id: "page-account", type: "page", title: "Account", href: "/account" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const supabase = createClient();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  // Global keyboard shortcut + custom event listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Search logic
  useEffect(() => {
    if (!open) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setActiveIndex(0);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const q = query.toLowerCase();
      const allResults: SearchResult[] = [];

      // Courses from Supabase
      try {
        const { data } = await supabase
          .from("courses")
          .select("id, title, departments, url")
          .ilike("title", `%${query}%`)
          .order("views", { ascending: false })
          .limit(5);

        if (data) {
          for (const c of data) {
            const dept =
              Array.isArray(c.departments) && c.departments.length > 0
                ? (c.departments[0] as { name?: string })?.name
                : undefined;
            allResults.push({
              id: `course-${c.id}`,
              type: "course",
              title: c.title,
              subtitle: dept,
              href: `/courses/${c.id}`,
            });
          }
        }
      } catch {
        // ignore search errors
      }

      // Curricula (client-side filter)
      for (const track of CURRICULA_TRACKS) {
        if (
          track.name.toLowerCase().includes(q) ||
          track.description.toLowerCase().includes(q)
        ) {
          allResults.push({
            id: `curriculum-${track.id}`,
            type: "curriculum",
            title: track.name,
            subtitle: track.description,
            href: "/curricula",
          });
        }
      }

      // Quick links
      for (const link of QUICK_LINKS) {
        if (link.title.toLowerCase().includes(q)) {
          allResults.push(link);
        }
      }

      setResults(allResults);
      setActiveIndex(0);
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, supabase]);

  // Keyboard navigation inside palette
  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      navigate(results[activeIndex].href);
    } else if (e.key === "Escape") {
      close();
    }
  }

  if (!open) return null;

  const courseResults = results.filter((r) => r.type === "course");
  const curriculumResults = results.filter((r) => r.type === "curriculum");
  const pageResults = results.filter((r) => r.type === "page");

  // Build flat index mapping for keyboard nav
  let flatIndex = 0;
  function getIndex() {
    return flatIndex++;
  }

  const typeIcon = (type: SearchResult["type"]) => {
    switch (type) {
      case "course":
        return (
          <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        );
      case "curriculum":
        return (
          <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        );
      case "page":
        return (
          <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        );
    }
  };

  function renderSection(label: string, items: SearchResult[]) {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div className="px-3 py-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wider dark:text-zinc-500">
          {label}
        </div>
        {items.map((result) => {
          const idx = getIndex();
          return (
            <button
              key={result.id}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                idx === activeIndex
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => navigate(result.href)}
            >
              {typeIcon(result.type)}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{result.title}</div>
                {result.subtitle && (
                  <div className="truncate text-xs text-zinc-400">
                    {result.subtitle}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-zinc-900/50 pt-[20vh]"
      onClick={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <svg className="h-5 w-5 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search courses, curricula, pages..."
            className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:bg-zinc-800">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-1">
          {query.trim() && results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              No results found
            </div>
          ) : (
            <>
              {renderSection("Courses", courseResults)}
              {renderSection("Curricula", curriculumResults)}
              {renderSection("Pages", pageResults)}
            </>
          )}
          {!query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              Start typing to search...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
