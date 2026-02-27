export default function CoursesLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 h-8 w-32 rounded bg-zinc-100" />

      <div className="mb-6 flex flex-col gap-4">
        <div className="h-10 w-full rounded-lg bg-zinc-100" />
        <div className="flex gap-3">
          <div className="h-10 w-40 rounded-lg bg-zinc-100" />
          <div className="h-10 w-40 rounded-lg bg-zinc-100" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
          >
            <div className="aspect-[16/9] w-full bg-zinc-100" />
            <div className="flex flex-col gap-2 p-4">
              <div className="h-4 w-3/4 rounded bg-zinc-100" />
              <div className="h-4 w-1/2 rounded bg-zinc-100" />
              <div className="h-3 w-1/3 rounded bg-zinc-100" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
