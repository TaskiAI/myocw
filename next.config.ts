import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ocw.mit.edu" },
      { protocol: "https", hostname: "archive.org" },
    ],
  },
  outputFileTracingIncludes: {
    "/api/courses/\\[id\\]/download": [
      "./node_modules/katex/dist/katex.min.css",
      "./node_modules/katex/dist/fonts/**/*",
    ],
  },
};

export default nextConfig;
