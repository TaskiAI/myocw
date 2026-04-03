"use client";

import { motion } from "framer-motion";
import HeroHeading from "./HeroHeading";

// Timeline:
// 0.0s  — text #1 cascades (2 lines × 0.1s stagger + 0.5s = done ~0.6s)
// 0.7s  — crimson panel expands (0.45s = done ~1.15s)
// 1.25s — text #2 cascades (2 lines × 0.1s + 0.5s = done ~1.85s)
// 1.95s — silver panel expands (0.45s = done ~2.4s)
// 2.5s  — "Completely Yours" cascades

export default function HeroSection() {
  return (
    <div className="relative w-full h-[calc(100vh-5rem)]">
      {/* Crimson panel: right half, expands from center to right edge */}
      <motion.div
        className="absolute top-0 bottom-0"
        style={{ left: "50%", backgroundColor: "#750014" }}
        initial={{ width: 0 }}
        animate={{ width: "50%" }}
        transition={{
          duration: 0.45,
          ease: [0.25, 0.1, 0.25, 1],
          delay: 0.7,
        }}
      />
      {/* Silver panel: bottom-left (III quadrant), expands from center to left edge */}
      <motion.div
        className="absolute bottom-0"
        style={{ right: "50%", height: "50%", backgroundColor: "#C0C0C0" }}
        initial={{ width: 0 }}
        animate={{ width: "50%" }}
        transition={{
          duration: 0.45,
          ease: [0.25, 0.1, 0.25, 1],
          delay: 1.95,
        }}
      />
      {/* Left column */}
      <div className="absolute top-0 left-0 w-1/2 h-full flex flex-col">
        <div className="p-12 flex items-start justify-start h-1/2">
          <HeroHeading lines={["2,500 Courses", "from MIT"]} />
        </div>
        <div className="p-12 flex items-end justify-start h-1/2">
          <HeroHeading
            lines={["Completely", "Yours"]}
            delayOffset={2.5}
          />
        </div>
      </div>
      {/* Right column: text centered vertically across full height */}
      <div className="absolute top-0 right-0 w-1/2 h-full p-12 flex items-center justify-end text-right">
        <HeroHeading
          lines={["Anywhere in", "the World"]}
          delayOffset={1.25}
          textColor="white"
        />
      </div>
    </div>
  );
}
