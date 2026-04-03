"use client";

import { motion } from "framer-motion";

const defaultLines = ["2,500 Courses", "From Anywhere", "In the World"];

export default function HeroHeading({
  lines = defaultLines,
  delayOffset = 0,
  textColor = "black",
}: {
  lines?: string[];
  delayOffset?: number;
  textColor?: string;
}) {
  return (
    <h1
      className="text-left font-bold"
      style={{
        color: textColor,
        fontFamily: "var(--font-inter)",
        fontSize: "110px",
        lineHeight: "104%",
        letterSpacing: "-0.07em",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
        textRendering: "geometricPrecision",
      }}
    >
      {lines.map((line, i) => (
        <motion.span
          key={i}
          className="block"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            ease: [0.25, 0.1, 0.25, 1],
            delay: delayOffset + i * 0.1,
          }}
        >
          {line}
        </motion.span>
      ))}
    </h1>
  );
}
