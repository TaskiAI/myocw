"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface CourseFiltersProps {
  departments: string[];
  topics: string[];
}

export default function CourseFilters({ departments, topics }: CourseFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeDepartment = searchParams.get("department") ?? "";
  const activeTopic = searchParams.get("topic") ?? "";
  const hasVideos = searchParams.get("videos") === "1";
  const hasPsets = searchParams.get("psets") === "1";
  const available = searchParams.get("available") !== "0";

  const hasActiveFilters = activeDepartment || activeTopic || hasVideos || hasPsets || available;

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    router.push(`/courses?${params.toString()}`);
  }

  function clearFilters() {
    const params = new URLSearchParams();
    const q = searchParams.get("q");
    if (q) params.set("q", q);
    router.push(`/courses?${params.toString()}`);
  }

  const selectClass =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#750014]/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-auto";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <select
        value={activeDepartment}
        onChange={(e) => updateParam("department", e.target.value || null)}
        className={selectClass}
      >
        <option value="">All Departments</option>
        {departments.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      <select
        value={activeTopic}
        onChange={(e) => updateParam("topic", e.target.value || null)}
        className={selectClass}
      >
        <option value="">All Topics</option>
        {topics.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={hasVideos}
          onChange={(e) => updateParam("videos", e.target.checked ? "1" : null)}
          className="accent-[#750014]"
        />
        Lecture Videos
      </label>

      <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={hasPsets}
          onChange={(e) => updateParam("psets", e.target.checked ? "1" : null)}
          className="accent-[#750014]"
        />
        Problem Sets
      </label>

      <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={available}
          onChange={(e) => updateParam("available", e.target.checked ? null : "0")}
          className="accent-[#750014]"
        />
        Available during beta
      </label>

      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="text-sm font-medium text-[#750014] hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
