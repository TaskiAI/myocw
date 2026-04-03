"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

const features = [
  {
    title: "2,500+ MIT Courses",
    description:
      "Lectures, problem sets, and exams from MIT OpenCourseWare, with a modern twist.",
  },
  {
    title: "Interactive Problem Sets",
    description:
      "Track your progress with automatic grading, explanations, and feedback.",
  },
  {
    title: "Collaborative Learning",
    description:
      "Ask questions, answer questions. Grow as learners, together",
  },
  {
    title: "96% Smaller Downloads",
    description:
      "Full courses compressed for offline use in your own language. Take MIT anywhere.",
  },
  {
    title: "Full Course Translations",
    description:
      "Automatic machine translation of course content into any language.",
  },
  {
    title: "Curriculum Pathways",
    description:
      "Curated course sequences that mirror actual MIT degree tracks.",
  },
];

function FeatureNode({
  feature,
  index,
}: {
  feature: (typeof features)[number];
  index: number;
}) {
  const isLeft = index % 2 === 0;

  return (
    <div className="relative flex items-center" style={{ minHeight: "180px" }}>
      {/* Dot on the line */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 z-10"
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="w-4 h-4 rounded-full bg-[#750014] ring-4 ring-white dark:ring-zinc-950" />
      </motion.div>

      {/* Content card */}
      <motion.div
        className={`w-[calc(50%-2rem)] ${
          isLeft ? "mr-auto pr-8 text-right" : "ml-auto pl-8 text-left"
        }`}
        initial={{ opacity: 0, x: isLeft ? -30 : 30 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{
          duration: 0.5,
          ease: [0.25, 0.1, 0.25, 1],
        }}
      >
        <h3
          className="text-2xl font-bold text-zinc-900 dark:text-zinc-100"
          style={{
            fontFamily: "var(--font-inter)",
            letterSpacing: "-0.03em",
          }}
        >
          {feature.title}
        </h3>
        <p className="mt-2 text-base text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {feature.description}
        </p>
      </motion.div>
    </div>
  );
}

export default function FeatureTimeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.6", "end 0.8"],
  });

  const lineHeight = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <div ref={containerRef} className="relative py-24 overflow-hidden">
      {/* Silver + crimson panels flanking content */}
      <div
        className="absolute left-0 top-0 bottom-0 bg-[#C0C0C0]"
        style={{ width: "calc((100% - 56rem) / 2)" }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 bg-[#750014]"
        style={{ width: "calc((100% - 56rem) / 2)" }}
      />

      <div className="relative mx-auto max-w-4xl px-6">
        {/* Static track line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-zinc-200 dark:bg-zinc-800" />

        {/* Animated progress line */}
        <motion.div
          className="absolute left-1/2 top-0 w-px -translate-x-1/2 bg-[#750014] origin-top"
          style={{ height: lineHeight }}
        />

        <div className="relative flex flex-col gap-4">
          {features.map((feature, i) => (
            <FeatureNode key={i} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
