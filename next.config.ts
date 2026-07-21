import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Never serve dynamic pages from the client-side router cache: without
    // this, navigating back to /conversations could briefly show a stale
    // RSC payload from before a just-created conversation existed.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
