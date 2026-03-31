"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const ease = [0.25, 0.1, 0.25, 1] as const;

export default function LandingHero() {
  return (
    <div className="flex flex-col items-start gap-4 max-w-2xl">
      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.15, ease }}
        className="text-lg text-zinc-500 dark:text-zinc-400"
      >
        Watch lectures, work through problem sets, and track your progress — all from MIT OpenCourseWare.
        Free forever.
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.25, ease }}
        className="text-sm text-zinc-400 dark:text-zinc-500"
      >
        Not affiliated with MIT. Content is sourced from MIT OpenCourseWare under CC BY-NC-SA 4.0.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.35, ease }}
        className="flex items-center gap-4 pt-2"
      >
        <Link
          href="/courses"
          className="rounded-lg bg-[#750014] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5a0010]"
        >
          Browse Courses
        </Link>
        <Link
          href="/curricula"
          className="rounded-lg border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Explore Pathways
        </Link>
      </motion.div>
    </div>
  );
}
