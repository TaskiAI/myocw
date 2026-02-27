import type { Resource } from "@/lib/types/course-content";

const TYPE_ICONS: Record<string, string> = {
  problem_set: "Assignment",
  exam: "Exam",
  solution: "Solution",
  lecture_notes: "Notes",
  reading: "Reading",
  other: "File",
};

export default function ResourceList({
  resources,
  courseSlug,
}: {
  resources: Resource[];
  courseSlug: string;
}) {
  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
      {resources.map((resource) => (
        <li key={resource.id} className="flex items-center gap-3 px-4 py-3">
          <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
            {TYPE_ICONS[resource.resource_type] ?? "File"}
          </span>

          <span className="min-w-0 flex-1 truncate text-sm text-zinc-900">
            {resource.title}
          </span>

          {resource.pdf_path && (
            <a
              href={resource.pdf_path}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
            >
              PDF
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
