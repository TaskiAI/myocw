import { getCurriculaTracks } from "@/lib/queries/curricula";
import CurriculumTrackCard from "@/app/components/CurriculumTrackCard";

export default async function CurriculaPage() {
  const tracks = await getCurriculaTracks();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Curricula</h1>
      <p className="mt-2 max-w-3xl text-sm text-zinc-600">
        Structured MIT-inspired paths. Expand a track to review its ordered course slug
        and enroll.
      </p>

      <div className="mt-8 space-y-4">
        {tracks.map((track) => (
          <CurriculumTrackCard
            key={track.id}
            track={track}
            showEnrollmentControls
          />
        ))}
      </div>
    </main>
  );
}
