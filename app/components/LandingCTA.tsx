"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";

const images = [
  { src: "/cambridge_1.jpg", alt: "Cambridge 1" },
  { src: "/cambridge_2.jpeg", alt: "Cambridge 2" },
  { src: "/cambridge_3.jpg", alt: "Cambridge 3" },
  { src: "/cambridge_4.webp", alt: "Cambridge 4" },
  { src: "/cambridge_6.jpg", alt: "Cambridge 6" },
];

// Staggered layout: images cascade down with slight overlap, fits ~100vh
const positions = [
  { top: 0, left: 40, width: 240, height: 160 },
  { top: 130, left: -15, width: 220, height: 250 },
  { top: 340, left: 70, width: 210, height: 180 },
  { top: 480, left: -5, width: 200, height: 165 },
  { top: 610, left: 55, width: 230, height: 180 },
];

function ScrollImage({
  img,
  position,
  index,
  scrollYProgress,
}: {
  img: (typeof images)[number];
  position: (typeof positions)[number];
  index: number;
  scrollYProgress: ReturnType<typeof useScroll>["scrollYProgress"];
}) {
  const fromLeft = index % 2 === 0;
  const x = useTransform(scrollYProgress, [0, 1], [0, fromLeft ? -25 : 25]);

  return (
    <motion.div
      className="absolute overflow-hidden"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        height: position.height,
        x,
      }}
      initial={{
        opacity: 0,
        scale: 0.85,
      }}
      whileInView={{
        opacity: 1,
        scale: 1,
      }}
      viewport={{ once: true, margin: "0px" }}
      transition={{
        duration: 0.6,
        ease: [0.25, 0.1, 0.25, 1],
        delay: index * 0.12,
      }}
    >
      <Image src={img.src} alt={img.alt} fill className="object-cover" />
    </motion.div>
  );
}

export default function LandingCTA() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  return (
    <section ref={sectionRef} className="relative bg-white overflow-hidden">
      <div className="relative mx-auto max-w-7xl h-[calc(100vh-5rem)]">
        {/* Staggered image column on the left */}
        <div className="relative w-1/2 h-full">
          {images.map((img, i) => (
            <ScrollImage
              key={i}
              img={img}
              position={positions[i]}
              index={i}
              scrollYProgress={scrollYProgress}
            />
          ))}
        </div>

        {/* Text on the right, vertically centered */}
        <div className="absolute top-0 right-0 w-1/2 h-full flex flex-col justify-center items-start pl-16 pr-12">
          <div
            style={{
              fontFamily: "var(--font-inter)",
              fontSize: "64px",
              lineHeight: "110%",
              letterSpacing: "-0.05em",
              WebkitFontSmoothing: "antialiased",
              textRendering: "geometricPrecision",
            }}
          >
            {["As beautiful as it is,"].map((line, i) => (
              <motion.span
                key={`a-${i}`}
                className="block font-bold text-black"
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{
                  duration: 0.5,
                  ease: [0.25, 0.1, 0.25, 1],
                  delay: i * 0.1,
                }}
              >
                {line}
              </motion.span>
            ))}
            <div className="mt-4">
              {[
                <>You don&apos;t have to</>,
                <>be <span className="text-[#750014]">here</span> to learn</>,
                <>from here.</>,
              ].map((line, i) => (
                <motion.span
                  key={`b-${i}`}
                  className="block font-bold text-black"
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{
                    duration: 0.5,
                    ease: [0.25, 0.1, 0.25, 1],
                    delay: 0.25 + i * 0.1,
                  }}
                >
                  {line}
                </motion.span>
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.7 }}
            className="mt-10"
          >
            <Link
              href="/courses"
              className="inline-flex items-center bg-black text-white px-10 py-5 text-lg font-semibold transition-colors hover:bg-zinc-800"
            >
              Start Learning
            </Link>
          </motion.div>
        </div>
      </div>

      <motion.p
        className="py-8 text-center text-xs text-zinc-400"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        Not affiliated with MIT. Content sourced from MIT OpenCourseWare under CC BY-NC-SA 4.0.
      </motion.p>
    </section>
  );
}
