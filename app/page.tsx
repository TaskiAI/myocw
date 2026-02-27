import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <div className="flex flex-col items-start gap-6 max-w-2xl">
        <h1 className="text-5xl font-bold text-zinc-900 leading-tight">
          World-class courses,<br />at your own pace.
        </h1>
        <p className="text-lg text-zinc-500">
          Browse 2,500+ MIT courses. Watch lectures, track your progress,
          and learn on your schedule. Completely free.
        </p>
        <p className="text-sm text-zinc-400">
          Not affiliated with MIT. Content is sourced from MIT OpenCourseWare under CC BY-NC-SA 4.0.
        </p>
        <div className="flex items-center gap-4 pt-2">
          <Link
            href="/courses"
            className="rounded-lg bg-[#750014] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5a0010]"
          >
            Browse Courses
          </Link>
        </div>
      </div>
    </main>
  );
}
