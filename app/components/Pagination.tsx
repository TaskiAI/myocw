"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
}

export default function Pagination({ currentPage, totalPages }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page === 1) {
      params.delete("page");
    } else {
      params.set("page", String(page));
    }
    router.push(`/courses?${params.toString()}`);
  }

  // Show up to 5 page numbers centered around current page
  let start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4);

  const pages: number[] = [];
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Previous
      </button>

      {pages.map((page) => (
        <button
          key={page}
          onClick={() => goToPage(page)}
          className={`min-w-[2.25rem] rounded-lg px-3 py-2 text-sm font-medium ${
            page === currentPage
              ? "bg-[#750014] text-white"
              : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          {page}
        </button>
      ))}

      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Next
      </button>
    </div>
  );
}
