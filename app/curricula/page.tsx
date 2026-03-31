import { getCurriculaTracks } from "@/lib/queries/curricula";
import CurriculumTrackCard from "@/app/components/CurriculumTrackCard";
import AnimatedCard from "@/app/components/AnimatedCard";
import FadeIn from "@/app/components/FadeIn";

export default async function CurriculaPage() {
  const tracks = await getCurriculaTracks();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <FadeIn>
        <h1 className="text-4xl font-black tracking-tighter text-[#191c1d] dark:text-zinc-100 md:text-5xl">Learning Pathways</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Structured MIT-inspired paths. Expand a track to review its ordered course slug
          and enroll.
        </p>
      </FadeIn>

      <div className="mt-8 space-y-4">
        {tracks.map((track, i) => (
          <AnimatedCard key={track.id} index={i}>
            <CurriculumTrackCard
              track={track}
              showEnrollmentControls
            />
          </AnimatedCard>
        ))}
      </div>
    </main>
  );
}
