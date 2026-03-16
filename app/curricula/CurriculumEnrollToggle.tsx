"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  enrollInCurriculum,
  unenrollFromCurriculum,
} from "@/lib/queries/curriculum-enrollments";

export default function CurriculumEnrollToggle({
  curriculumId,
  initialEnrolled,
}: {
  curriculumId: string;
  initialEnrolled: boolean;
}) {
  const [isEnrolled, setIsEnrolled] = useState(initialEnrolled);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    if (isSaving) return;

    const previous = isEnrolled;
    const next = !previous;
    setIsEnrolled(next);
    setIsSaving(true);

    const ok = next
      ? await enrollInCurriculum(curriculumId)
      : await unenrollFromCurriculum(curriculumId);

    if (!ok) {
      setIsEnrolled(previous);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {isEnrolled && (
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
          Enrolled
        </span>
      )}
      <button
        type="button"
        onClick={handleToggle}
        disabled={isSaving}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isEnrolled
            ? "border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
            : "bg-[#750014] text-white hover:bg-[#5a0010]"
        }`}
      >
        {isSaving ? "Saving..." : isEnrolled ? "Unenroll" : "Enroll"}
      </button>
    </div>
  );
}
