import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ocw.mit.edu" },
      { protocol: "https", hostname: "archive.org" },
    ],
  },
  serverExternalPackages: ["katex"],
};

export default nextConfig;
